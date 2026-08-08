/**
 * E14-002 — development-only LLM critic harness.
 *
 * The statistical gates in `audit-ai-behavior-gates.ts` answer "does the action
 * mix stay inside its bands". They cannot answer "does this hand *read* as
 * something a person would do", which is the complaint the 2026-07-25 review
 * actually made. This harness plays hands headlessly, picks out the ones worth
 * a second opinion, renders them as hand histories, and asks a critic to label
 * them.
 *
 * Three constraints shape every design choice here, and none of them is
 * negotiable:
 *
 * 1. **The shipped game never gains network access.** This lives in `scripts/`,
 *    which no production entrypoint can reach -- the production-composition
 *    audit walks the import graph from `src/main.tsx` and the Electron
 *    entrypoints, so a file here is excluded by construction rather than by a
 *    rule someone has to remember. `critic-harness.test.ts` asserts that.
 *
 * 2. **No hidden-card information is ever sent.** A hand history is built from
 *    a *spectator* view: `createInformationSet` with hole cards then stripped
 *    outright, so not even one seat's cards survive. `assertNoHiddenCards`
 *    re-checks the finished record and throws rather than returning a warning,
 *    and every path that could reach a critic goes through it.
 *
 * 3. **This is never a release gate and never a source of truth.** It returns
 *    qualitative labels alongside the numbers, and `CriticReport` carries that
 *    statement in the data rather than only in a comment. Nothing here is wired
 *    into `run-release-verification.mjs`, deliberately.
 *
 * The default critic is offline and heuristic, so the harness is runnable with
 * no endpoint, no key, and no egress. A real model is opt-in through
 * `httpCritic()`, which the CLI only constructs when an endpoint is passed
 * explicitly.
 */

import {
  advanceTournamentSessionClock,
  applyTournamentSessionAction,
  beginTournamentSessionHand,
  chooseTournamentSessionPolicyAction,
  createSessionOpponents,
  createTournamentSession,
  progressTournamentSessionHand,
  type TournamentSession,
} from "../src/modes/tournamentSession";
import { createInformationSet } from "../src/engine/tournament";
import { nextToAct } from "../src/engine/betting";
import type { Card, Street } from "../src/types/poker";

const POLICY = { simulations: 60, temperature: 0.48 } as const;
const MAX_ACTIONS_PER_HAND = 4_000;
/**
 * Nominal time a six-handed hand takes, matching the pacing and exploitability
 * harnesses. Advancing it is what lets the sample span blind levels rather than
 * sitting forever at the opening stack depth.
 */
const MS_PER_HAND = 75_000;

/**
 * The labels the criterion names. A critic must answer with one of these; a
 * free-text reply is recorded but not counted, so a chatty model cannot quietly
 * invent a category.
 */
export const CRITIC_LABELS = [
  "implausible-aggression",
  "passive-missed-value",
  "unjustified-raise",
  "strange-all-in",
  "repeated-action-pattern",
  "human-plausible",
] as const;

export type CriticLabel = (typeof CRITIC_LABELS)[number];

/** One public action, exactly as a railbird would have seen it. */
export interface PublicHistoryAction {
  street: Street;
  playerId: string;
  seat: number;
  type: string;
  amount?: number;
  potBefore: number;
  stackBefore: number;
}

/**
 * A hand as it can be shown to anyone at all.
 *
 * Note what is absent: there is no `holeCards` field, on any player, at any
 * point. `board` is present because community cards are public by definition --
 * that is the line this type draws, and `assertNoHiddenCards` enforces it.
 */
export interface PublicHandHistory {
  handId: string;
  eventId: string;
  mode: "normal" | "rational";
  seed: string;
  handNumber: number;
  bigBlind: number;
  buttonSeat: number;
  players: Array<{
    id: string;
    seat: number;
    startingStack: number;
    finalStatus: string;
  }>;
  board: Card[];
  finalPot: number;
  actions: PublicHistoryAction[];
}

export interface SampledHand {
  history: PublicHandHistory;
  /** Why this hand was picked: the reason a critic is being asked about it. */
  reason: "suspicious" | "representative";
  /** The specific signals that made it suspicious, empty for representative. */
  signals: string[];
}

export interface CriticVerdict {
  handId: string;
  label: CriticLabel;
  /** The critic's own words, kept verbatim and never parsed for meaning. */
  note: string;
  /** Which critic produced this, so an offline run is never mistaken for a model run. */
  critic: string;
}

export interface CriticClient {
  name: string;
  label(hand: SampledHand): Promise<CriticVerdict>;
}

export interface CriticReport {
  /**
   * Stated in the data, not only in prose: a consumer that renders this report
   * cannot present it as a verdict without also carrying the disclaimer.
   */
  status: "qualitative-signal-only";
  disclaimer: string;
  critic: string;
  handsPlayed: number;
  sampled: number;
  verdicts: CriticVerdict[];
  labelCounts: Record<CriticLabel, number>;
}

const DISCLAIMER =
  "Qualitative signal only. These labels sit alongside the statistical gates " +
  "in audit-ai-behavior-gates.ts and never override them. This harness is not " +
  "a release gate and its output is not a source of truth.";

/**
 * Throws if anything card-shaped survives outside `board`.
 *
 * This is deliberately a structural walk rather than a string search: a search
 * for rank names matches ordinary text (a player called "Jack"), and a search
 * for the key `holeCards` misses a card array stored under any other name.
 * Walking the object and asking "is this a card?" catches both.
 */
export function assertNoHiddenCards(history: PublicHandHistory): void {
  const isCard = (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    "rank" in value &&
    "suit" in value;

  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (typeof value !== "object" || value === null) return;
    if (isCard(value)) {
      throw new Error(
        `Public hand history carries a card outside the board at ${path}. ` +
          "Hidden-card information must never leave this process.",
      );
    }
    for (const [key, entry] of Object.entries(value)) {
      walk(entry, `${path}.${key}`);
    }
  };

  for (const [key, value] of Object.entries(history)) {
    // The board is public by definition and is the one place cards belong.
    if (key === "board") continue;
    walk(value, key);
  }
}

interface HandRecorder {
  history: PublicHandHistory;
  raiseChains: number[];
}

/**
 * Plays `hands` hands and returns every one as a public history.
 *
 * The recorder reads hand state through `createInformationSet` and then drops
 * hole cards entirely, so the only cards that ever reach a history object are
 * board cards. There is no code path here that touches `hand.holeCards`.
 */
export function playPublicHands(options: {
  hands: number;
  mode: "normal" | "rational";
  seed?: string;
  eventId?: string;
}): { histories: PublicHandHistory[]; chains: number[][] } {
  const seed = options.seed ?? "critic-harness";
  const eventId = options.eventId ?? "local-qualifier";
  const opponents = createSessionOpponents(seed, eventId, options.mode);
  let session: TournamentSession = createTournamentSession({
    eventId,
    hero: { id: "hero", name: "Player", rating: 1_000 },
    mode: options.mode,
    seed,
    opponents,
  });

  const histories: PublicHandHistory[] = [];
  const chains: number[][] = [];
  let handNumber = 0;

  while (session.status === "playing" && histories.length < options.hands) {
    session = beginTournamentSessionHand(session);
    handNumber += 1;
    const opening = session.activeHand;
    if (!opening) break;

    // A spectator view: any seated id gives the same public fields, and hole
    // cards are stripped immediately so the viewer's own cards never survive.
    const spectator = createInformationSet(opening.information, "hero");
    const recorder: HandRecorder = {
      history: {
        handId: opening.handId,
        eventId,
        mode: options.mode,
        seed,
        handNumber,
        bigBlind: session.tournament.structure.levels[
          session.tournament.levelIndex
        ]?.bigBlind ?? 0,
        buttonSeat: spectator.buttonSeat,
        players: spectator.players.map((player) => ({
          id: player.id,
          seat: player.seat,
          startingStack: player.stack,
          finalStatus: player.status,
        })),
        board: [],
        finalPot: 0,
        actions: [],
      },
      raiseChains: [],
    };

    let chain = 0;
    let street = opening.street;
    let actions = 0;

    while (session.activeHand && actions < MAX_ACTIONS_PER_HAND) {
      const hand = session.activeHand;
      if (hand.street !== street) {
        if (chain > 0) recorder.raiseChains.push(chain);
        chain = 0;
        street = hand.street;
      }
      if (hand.betting.complete) {
        if (chain > 0) recorder.raiseChains.push(chain);
        chain = 0;
        session = progressTournamentSessionHand(session);
        street = session.activeHand?.street ?? street;
        continue;
      }
      const actor = nextToAct(hand.betting);
      if (!actor) {
        session = progressTournamentSessionHand(session);
        street = session.activeHand?.street ?? street;
        continue;
      }

      const view = createInformationSet(hand.information, actor);
      const seat = view.players.find((player) => player.id === actor);
      const stateBefore = hand.betting.players.find(
        (player) => player.id === actor,
      );
      const decision = chooseTournamentSessionPolicyAction(session, actor, POLICY);
      const command = decision.command;

      recorder.history.actions.push({
        street: hand.street,
        playerId: actor,
        seat: seat?.seat ?? -1,
        type: command.type,
        ...(command.to === undefined ? {} : { amount: command.to }),
        potBefore: view.pot,
        stackBefore: stateBefore?.stack ?? 0,
      });

      if (
        command.type === "bet" ||
        command.type === "raise" ||
        command.type === "all-in"
      ) {
        chain += 1;
      } else {
        if (chain > 0) recorder.raiseChains.push(chain);
        chain = 0;
      }

      // Board is read from the redacted view, so it can only ever hold
      // community cards.
      if (view.board.length > recorder.history.board.length) {
        recorder.history.board = view.board.map((card) => ({ ...card }));
      }
      recorder.history.finalPot = Math.max(
        recorder.history.finalPot,
        view.pot,
      );

      session = applyTournamentSessionAction(session, actor, command);
      actions += 1;

      if (session.activeHand?.betting.complete) {
        if (chain > 0) recorder.raiseChains.push(chain);
        chain = 0;
        session = progressTournamentSessionHand(session);
        street = session.activeHand?.street ?? street;
      }
    }

    if (chain > 0) recorder.raiseChains.push(chain);
    assertNoHiddenCards(recorder.history);
    histories.push(recorder.history);
    chains.push(recorder.raiseChains);
    // Without this the level never escalates -- blind levels run on wall time
    // and a headless run has none -- so every sampled hand sits at the opening
    // 300 BB depth. That is the one depth where nothing is ever short, and
    // short stacks are exactly where "strange all-in" is worth asking about.
    session = advanceTournamentSessionClock(session, MS_PER_HAND);
  }

  return { histories, chains };
}

/**
 * Picks the hands worth asking about.
 *
 * Suspicious first -- a critic's time is better spent on the outliers than on
 * a random walk -- but representative hands are always included too, because a
 * table that only ever gets asked about its worst moments produces a report
 * that looks damning regardless of how it plays.
 */
export function sampleHands(
  histories: readonly PublicHandHistory[],
  chains: readonly number[][],
  limit: number,
): SampledHand[] {
  const scored = histories.map((history, index) => {
    const signals: string[] = [];
    const maxChain = Math.max(0, ...(chains[index] ?? []));
    if (maxChain >= 4) signals.push(`raise chain of ${maxChain}`);

    const allIns = history.actions.filter(
      (action) => action.type === "all-in",
    );
    if (allIns.length >= 2) signals.push(`${allIns.length} all-ins`);
    const preflopAllIn = allIns.find((action) => action.street === "preflop");
    if (preflopAllIn) signals.push("preflop all-in");

    // Postflop only. A preflop open faces a pot of nothing but the blinds, so
    // a perfectly standard 2.5 BB raise is already several times the pot --
    // measuring it that way flags the most ordinary action in poker.
    const oversized = history.actions.find(
      (action) =>
        action.street !== "preflop" &&
        (action.type === "raise" || action.type === "bet") &&
        action.amount !== undefined &&
        action.potBefore > 0 &&
        action.amount / action.potBefore > 3,
    );
    if (oversized) signals.push("postflop raise over 3x pot");

    // The same player taking the same action three times running is the
    // "repeated action pattern" the criterion asks about.
    const runs = new Map<string, number>();
    let repeated = false;
    for (const action of history.actions) {
      const key = `${action.playerId}:${action.type}`;
      const next = (runs.get(key) ?? 0) + 1;
      runs.set(key, next);
      if (next >= 4) repeated = true;
    }
    if (repeated) signals.push("repeated identical action");

    return { history, signals };
  });

  // Representative hands are taken at a fixed stride rather than at random, so
  // a run is reproducible from its arguments alone. Their share of the budget
  // is *reserved* before suspicious hands are filled in: taking suspicious
  // first and truncating at the end crowds them out entirely whenever
  // suspicion is common, which is exactly the run where an unbiased
  // comparison matters most.
  const representativeBudget = Math.max(1, Math.floor(limit / 4));
  const clean = scored.filter((entry) => entry.signals.length === 0);
  const stride = Math.max(1, Math.floor(clean.length / representativeBudget));
  const representative = clean
    .filter((_, index) => index % stride === 0)
    .slice(0, representativeBudget)
    .map(
      (entry): SampledHand => ({
        history: entry.history,
        reason: "representative",
        signals: [],
      }),
    );

  const suspicious = scored
    .filter((entry) => entry.signals.length > 0)
    .slice(0, Math.max(0, limit - representative.length))
    .map(
      (entry): SampledHand => ({
        history: entry.history,
        reason: "suspicious",
        signals: entry.signals,
      }),
    );

  return [...suspicious, ...representative];
}

/** Renders a hand as the text a critic actually reads. */
export function renderHandHistory(hand: SampledHand): string {
  const { history } = hand;
  const lines: string[] = [];
  lines.push(
    `Hand ${history.handNumber} (${history.mode} policy), big blind ${history.bigBlind}, button seat ${history.buttonSeat}.`,
  );
  for (const player of history.players) {
    lines.push(`  seat ${player.seat}: ${player.id}, stack ${player.startingStack}`);
  }
  let street: Street | undefined;
  for (const action of history.actions) {
    if (action.street !== street) {
      street = action.street;
      lines.push(`${street}:`);
    }
    const amount = action.amount === undefined ? "" : ` to ${action.amount}`;
    lines.push(
      `  ${action.playerId} ${action.type}${amount} (pot ${action.potBefore}, stack ${action.stackBefore})`,
    );
  }
  if (history.board.length) {
    lines.push(
      `board: ${history.board.map((card) => `${card.rank}${card.suit[0]}`).join(" ")}`,
    );
  }
  lines.push(`final pot ${history.finalPot}`);
  if (hand.signals.length) lines.push(`flagged: ${hand.signals.join(", ")}`);
  return lines.join("\n");
}

/**
 * The default critic: offline, deterministic, and honest about being a
 * heuristic.
 *
 * Its value is not that it judges well -- it does not -- but that the harness
 * runs end to end with no endpoint, so the redaction, sampling, and reporting
 * paths are all exercised by the test suite on a machine with no network.
 */
export const heuristicCritic: CriticClient = {
  name: "offline-heuristic",
  async label(hand) {
    const { history, signals } = hand;
    const aggressive = history.actions.filter(
      (action) =>
        action.type === "raise" ||
        action.type === "bet" ||
        action.type === "all-in",
    ).length;
    const passive = history.actions.filter(
      (action) => action.type === "check" || action.type === "call",
    ).length;

    let label: CriticLabel = "human-plausible";
    if (signals.some((signal) => signal.startsWith("raise chain"))) {
      label = "implausible-aggression";
    } else if (signals.includes("preflop all-in")) {
      label = "strange-all-in";
    } else if (signals.includes("postflop raise over 3x pot")) {
      label = "unjustified-raise";
    } else if (signals.includes("repeated identical action")) {
      label = "repeated-action-pattern";
    } else if (aggressive === 0 && passive > 6) {
      label = "passive-missed-value";
    }

    return {
      handId: history.handId,
      label,
      note: `heuristic: ${aggressive} aggressive / ${passive} passive actions`,
      critic: "offline-heuristic",
    };
  },
};

/**
 * An opt-in critic that posts to a model endpoint.
 *
 * Constructed only when an endpoint is passed explicitly -- there is no default
 * URL and no environment fallback, so no run reaches the network by accident.
 * The redaction check runs again immediately before the request: by then the
 * history has passed through sampling and rendering, and this is the last point
 * at which it can still be stopped.
 */
export function httpCritic(options: {
  endpoint: string;
  model: string;
  fetchImpl?: typeof fetch;
}): CriticClient {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    name: `http:${options.model}`,
    async label(hand) {
      assertNoHiddenCards(hand.history);
      const response = await doFetch(options.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          labels: CRITIC_LABELS,
          hand: renderHandHistory(hand),
        }),
      });
      if (!response.ok) {
        throw new Error(
          `Critic endpoint returned ${response.status} ${response.statusText}`,
        );
      }
      const payload = (await response.json()) as {
        label?: string;
        note?: string;
      };
      const label = CRITIC_LABELS.includes(payload.label as CriticLabel)
        ? (payload.label as CriticLabel)
        : "human-plausible";
      return {
        handId: hand.history.handId,
        label,
        note: payload.note ?? "",
        critic: `http:${options.model}`,
      };
    },
  };
}

export async function runCriticHarness(options: {
  hands: number;
  mode: "normal" | "rational";
  sample?: number;
  seed?: string;
  eventId?: string;
  critic?: CriticClient;
}): Promise<CriticReport> {
  const critic = options.critic ?? heuristicCritic;
  const { histories, chains } = playPublicHands(options);
  const sampled = sampleHands(histories, chains, options.sample ?? 12);

  const labelCounts = Object.fromEntries(
    CRITIC_LABELS.map((label) => [label, 0]),
  ) as Record<CriticLabel, number>;

  const verdicts: CriticVerdict[] = [];
  for (const hand of sampled) {
    // Belt and braces: the check that matters is the one immediately before
    // the hand leaves this process.
    assertNoHiddenCards(hand.history);
    const verdict = await critic.label(hand);
    verdicts.push(verdict);
    labelCounts[verdict.label] += 1;
  }

  return {
    status: "qualitative-signal-only",
    disclaimer: DISCLAIMER,
    critic: critic.name,
    handsPlayed: histories.length,
    sampled: sampled.length,
    verdicts,
    labelCounts,
  };
}
