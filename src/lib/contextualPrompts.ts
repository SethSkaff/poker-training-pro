import { formatMessage } from "./localeMessages";
import type { TrainingScenario } from "../types/poker";

export type ContextualPromptId =
  | "all-in"
  | "side-pot"
  | "minimum-raise"
  | "blind-increase"
  | "elimination"
  | "qualification"
  | "elo-change"
  | "short-stack"
  | "decision-mistake";

export interface ContextualPrompt {
  id: ContextualPromptId;
  title: string;
  message: string;
}

export interface ContextualPromptState {
  enabled: boolean;
  seen: ContextualPromptId[];
}

export const CONTEXTUAL_PROMPTS: Record<
  ContextualPromptId,
  ContextualPrompt
> = {
  "all-in": {
    id: "all-in",
    title: formatMessage("prompts.allIn.title"),
    message: formatMessage("prompts.allIn.message"),
  },
  "side-pot": {
    id: "side-pot",
    title: formatMessage("prompts.sidePot.title"),
    message: formatMessage("prompts.sidePot.message"),
  },
  "minimum-raise": {
    id: "minimum-raise",
    title: formatMessage("prompts.minimumRaise.title"),
    message: formatMessage("prompts.minimumRaise.message"),
  },
  "blind-increase": {
    id: "blind-increase",
    title: formatMessage("prompts.blindIncrease.title"),
    message: formatMessage("prompts.blindIncrease.message"),
  },
  elimination: {
    id: "elimination",
    title: formatMessage("prompts.elimination.title"),
    message: formatMessage("prompts.elimination.message"),
  },
  qualification: {
    id: "qualification",
    title: formatMessage("prompts.qualification.title"),
    message: formatMessage("prompts.qualification.message"),
  },
  "elo-change": {
    id: "elo-change",
    title: formatMessage("prompts.eloChange.title"),
    message: formatMessage("prompts.eloChange.message"),
  },
  "short-stack": {
    id: "short-stack",
    title: formatMessage("prompts.shortStack.title"),
    message: formatMessage("prompts.shortStack.message"),
  },
  "decision-mistake": {
    id: "decision-mistake",
    title: formatMessage("prompts.decisionMistake.title"),
    message: formatMessage("prompts.decisionMistake.message"),
  },
};

const PROMPT_KEY = "poker-training-pro:contextual-prompts:v1";
const IDS = Object.keys(CONTEXTUAL_PROMPTS) as ContextualPromptId[];

/**
 * Priority order used when several first-occurrence events land at once. The
 * rarer, more consequential table events surface ahead of the standing
 * pressure reminders so a player is never shown a generic tip while a side pot
 * or elimination just happened.
 */
export const CONTEXTUAL_PROMPT_ORDER: ContextualPromptId[] = [
  "all-in",
  "side-pot",
  "minimum-raise",
  "blind-increase",
  "elimination",
  "qualification",
  "elo-change",
  "short-stack",
  "decision-mistake",
];

/*
  Tips are **off by default** (E27-010).

  They fired for ordinary poker events -- blinds going up, stacks getting
  shorter in big blinds, waiting before acting -- so routine play arrived as
  paragraphs of commentary in the corner of a table that was meanwhile showing
  none of it. A player who wants the commentary can switch it on in the pause
  menu; a player who does not should never have had to.

  Critical state still reaches the player without this: the blind level is in
  the HUD, and level changes announce through the table's live region.
*/
export function defaultContextualPromptState(): ContextualPromptState {
  return { enabled: false, seen: [] };
}

export function loadContextualPromptState(): ContextualPromptState {
  if (typeof localStorage === "undefined") {
    return defaultContextualPromptState();
  }
  try {
    const value = JSON.parse(localStorage.getItem(PROMPT_KEY) ?? "{}") as {
      enabled?: unknown;
      seen?: unknown;
    };
    return {
      // Absent means off, so an existing save that never expressed a
      // preference gets the new default rather than inheriting the old one.
      enabled: value.enabled === true,
      seen: Array.isArray(value.seen)
        ? value.seen.filter(
            (id): id is ContextualPromptId =>
              typeof id === "string" &&
              IDS.includes(id as ContextualPromptId),
          )
        : [],
    };
  } catch {
    return defaultContextualPromptState();
  }
}

export function saveContextualPromptState(state: ContextualPromptState) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PROMPT_KEY, JSON.stringify(state));
  } catch {
    // Coaching remains usable for the current table if storage is unavailable.
  }
}

/**
 * Clears the seen history and re-enables coaching so every first-occurrence
 * prompt can appear again. Backs the "Replay contextual tips" control.
 */
export function resetContextualPromptState(): ContextualPromptState {
  /*
    Explicitly enabled, not the default. Tips are off by default (E27-010), but
    "Replay contextual tips" is a player asking for them: honouring that request
    by handing back the off-by-default state would make the control do nothing.
  */
  return { enabled: true, seen: [] };
}

/**
 * Whether a prompt teaches a rule or flags a situation.
 *
 * The original design suppressed every prompt forever after one dismissal,
 * which is right for a rule ("this is what a side pot is" needs saying once)
 * and wrong for a situation. "You are short-stacked" and "the blinds just went
 * up" are actionable *every* time they happen, and a player who dismissed them
 * in their first session never saw them again — the advice was silently
 * switched off precisely when it started to matter.
 */
export const PROMPT_RECURRENCE: Record<
  ContextualPromptId,
  "rule" | "situation"
> = {
  // Rules of the game: true once, then known.
  "all-in": "rule",
  "side-pot": "rule",
  "minimum-raise": "rule",
  // Situations: recur because the circumstance recurs.
  "blind-increase": "situation",
  elimination: "situation",
  qualification: "situation",
  "elo-change": "situation",
  "short-stack": "situation",
  "decision-mistake": "situation",
};

export function nextContextualPrompt(
  state: ContextualPromptState,
  occurrences: readonly ContextualPromptId[],
  /**
   * Prompts already shown during this sitting. Situational prompts re-arm
   * between sessions; passing this keeps them from repeating within one.
   */
  shownThisSession: readonly ContextualPromptId[] = [],
): ContextualPrompt | undefined {
  if (!state.enabled) return undefined;
  const id = occurrences.find((candidate) => {
    if (shownThisSession.includes(candidate)) return false;
    // A rule stays dismissed for good; a situation only for this session.
    return PROMPT_RECURRENCE[candidate] === "situation"
      ? true
      : !state.seen.includes(candidate);
  });
  return id ? CONTEXTUAL_PROMPTS[id] : undefined;
}

export function markContextualPromptSeen(
  state: ContextualPromptState,
  id: ContextualPromptId,
): ContextualPromptState {
  return state.seen.includes(id)
    ? state
    : { ...state, seen: [...state.seen, id] };
}

/**
 * Signals gathered from the live table. Every field is optional so the same
 * detector serves Training scenarios (scenario-only) and full tournaments
 * (scenario plus tournament transition context). The consumer captures the
 * numeric baselines it needs; this function stays pure and deterministic.
 */
export interface ContextualPromptSignals {
  scenario: TrainingScenario;
  actionHistory?: readonly string[];
  /** True once a legal raise is offered, i.e. the minimum-raise rule applies. */
  minimumRaiseAvailable?: boolean;
  /** Big blind of the opening tournament level, for detecting an increase. */
  openingBigBlind?: number;
  /** Big blind currently in force. */
  currentBigBlind?: number;
  /** Total entrants in the tournament. */
  fieldSize?: number;
  /** Tournament-wide survivors, used for elimination/qualification prompts. */
  tournamentPlayersRemaining?: number;
  /** Finishing places that qualify or cash. */
  qualifyingPlaces?: number;
  /** Combined Elo captured when the table was entered. */
  eloBaseline?: number;
  /** Combined Elo right now. */
  eloCurrent?: number;
}

export function detectContextualPromptOccurrences(
  signals: ContextualPromptSignals,
): ContextualPromptId[] {
  const {
    scenario,
    actionHistory = [],
    minimumRaiseAvailable,
    openingBigBlind,
    currentBigBlind,
    fieldSize,
    tournamentPlayersRemaining,
    qualifyingPlaces,
    eloBaseline,
    eloCurrent,
  } = signals;

  const occurrences: ContextualPromptId[] = [];
  const allInPlayers = scenario.players.filter(
    (player) => player.status === "all-in",
  );
  const copy = [
    scenario.prompt,
    scenario.title,
    ...scenario.tags,
    ...actionHistory,
  ]
    .join(" ")
    .toLowerCase();

  if (allInPlayers.length > 0 || copy.includes("all-in")) {
    occurrences.push("all-in");
  }
  if (
    copy.includes("side pot") ||
    copy.includes("side-pot") ||
    (allInPlayers.length >= 2 &&
      new Set(allInPlayers.map((player) => player.bet)).size > 1)
  ) {
    occurrences.push("side-pot");
  }
  if (
    minimumRaiseAvailable === true ||
    copy.includes("minimum raise") ||
    copy.includes("min raise") ||
    copy.includes("min-raise")
  ) {
    occurrences.push("minimum-raise");
  }
  if (
    typeof openingBigBlind === "number" &&
    typeof currentBigBlind === "number" &&
    currentBigBlind > openingBigBlind
  ) {
    occurrences.push("blind-increase");
  }
  if (
    typeof fieldSize === "number" &&
    typeof tournamentPlayersRemaining === "number" &&
    tournamentPlayersRemaining < fieldSize
  ) {
    occurrences.push("elimination");
  }
  if (
    typeof qualifyingPlaces === "number" &&
    qualifyingPlaces > 0 &&
    typeof tournamentPlayersRemaining === "number" &&
    tournamentPlayersRemaining > 0 &&
    tournamentPlayersRemaining <= qualifyingPlaces
  ) {
    occurrences.push("qualification");
  }
  if (
    typeof eloBaseline === "number" &&
    typeof eloCurrent === "number" &&
    eloCurrent !== eloBaseline
  ) {
    occurrences.push("elo-change");
  }

  const hero = scenario.players.find(
    (player) => player.seat === scenario.heroSeat,
  );
  if (
    hero &&
    scenario.blinds[1] > 0 &&
    (hero.stack + hero.bet) / scenario.blinds[1] <= 10
  ) {
    occurrences.push("short-stack");
  }

  return occurrences.sort(
    (a, b) =>
      CONTEXTUAL_PROMPT_ORDER.indexOf(a) - CONTEXTUAL_PROMPT_ORDER.indexOf(b),
  );
}
