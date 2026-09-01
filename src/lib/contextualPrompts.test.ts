import { describe, expect, it } from "vitest";
import type { SeatPlayer, TrainingScenario } from "../types/poker";
import {
  CONTEXTUAL_PROMPTS,
  CONTEXTUAL_PROMPT_ORDER,
  defaultContextualPromptState,
  detectContextualPromptOccurrences,
  markContextualPromptSeen,
  nextContextualPrompt,
  resetContextualPromptState,
  type ContextualPromptId,
  type ContextualPromptSignals,
  PROMPT_RECURRENCE,
  type ContextualPromptState,
} from "./contextualPrompts";

function seat(overrides: Partial<SeatPlayer> = {}): SeatPlayer {
  return {
    id: overrides.id ?? "p",
    name: overrides.name ?? "Player",
    stack: overrides.stack ?? 5_000,
    seat: overrides.seat ?? 0,
    status: overrides.status ?? "active",
    bet: overrides.bet ?? 0,
  };
}

function scenario(overrides: Partial<TrainingScenario> = {}): TrainingScenario {
  return {
    id: "s1",
    title: "Practice spot",
    difficulty: 3,
    street: "flop",
    blinds: [100, 200],
    heroSeat: 0,
    buttonSeat: 1,
    pot: 1_200,
    amountToCall: 0,
    minimumRaise: 400,
    heroCards: [
      { rank: "A", suit: "hearts" },
      { rank: "K", suit: "hearts" },
    ],
    board: [],
    players: [seat({ id: "hero", seat: 0, stack: 5_000 })],
    prompt: "A neutral spot.",
    recommendedAction: "check",
    actionReason: "Neutral.",
    mathQuestion: {
      topic: "pot-odds",
      prompt: "?",
      unit: "%",
      correctValue: 0.25,
      tolerance: 0.02,
      explanation: "n/a",
    },
    tags: [],
    ...overrides,
  };
}

const baseSignals = (
  overrides: Partial<ContextualPromptSignals> = {},
): ContextualPromptSignals => ({
  scenario: scenario(),
  ...overrides,
});

describe("contextual prompt catalogue", () => {
  it("defines every required first-occurrence event", () => {
    const required: ContextualPromptId[] = [
      "all-in",
      "side-pot",
      "minimum-raise",
      "blind-increase",
      "elimination",
      "qualification",
      "elo-change",
    ];
    for (const id of required) {
      expect(CONTEXTUAL_PROMPTS[id]).toBeDefined();
      expect(CONTEXTUAL_PROMPTS[id].title.length).toBeGreaterThan(0);
      expect(CONTEXTUAL_PROMPTS[id].message.length).toBeGreaterThan(0);
    }
  });
});

describe("detectContextualPromptOccurrences", () => {
  it("detects an all-in from player status", () => {
    const signals = baseSignals({
      scenario: scenario({
        players: [
          seat({ id: "hero", seat: 0 }),
          seat({ id: "v", seat: 1, status: "all-in", bet: 3_000 }),
        ],
      }),
    });
    expect(detectContextualPromptOccurrences(signals)).toContain("all-in");
  });

  it("detects a side pot when two all-ins commit different amounts", () => {
    const signals = baseSignals({
      scenario: scenario({
        players: [
          seat({ id: "hero", seat: 0, status: "all-in", bet: 1_000 }),
          seat({ id: "v", seat: 1, status: "all-in", bet: 3_000 }),
        ],
      }),
    });
    const occ = detectContextualPromptOccurrences(signals);
    expect(occ).toContain("side-pot");
    expect(occ).toContain("all-in");
  });

  it("detects a minimum raise when a raise becomes legal", () => {
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ minimumRaiseAvailable: true }),
      ),
    ).toContain("minimum-raise");
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ minimumRaiseAvailable: false }),
      ),
    ).not.toContain("minimum-raise");
  });

  it("detects a blind increase only above the opening level", () => {
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ openingBigBlind: 200, currentBigBlind: 300 }),
      ),
    ).toContain("blind-increase");
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ openingBigBlind: 200, currentBigBlind: 200 }),
      ),
    ).not.toContain("blind-increase");
  });

  it("detects an elimination when fewer players remain than entered", () => {
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ fieldSize: 6, tournamentPlayersRemaining: 5 }),
      ),
    ).toContain("elimination");
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ fieldSize: 6, tournamentPlayersRemaining: 6 }),
      ),
    ).not.toContain("elimination");
  });

  it("detects qualification when the field reaches the paying places", () => {
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ tournamentPlayersRemaining: 2, qualifyingPlaces: 2 }),
      ),
    ).toContain("qualification");
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ tournamentPlayersRemaining: 3, qualifyingPlaces: 2 }),
      ),
    ).not.toContain("qualification");
  });

  it("detects an Elo change against the captured baseline", () => {
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ eloBaseline: 2_400, eloCurrent: 2_412 }),
      ),
    ).toContain("elo-change");
    expect(
      detectContextualPromptOccurrences(
        baseSignals({ eloBaseline: 2_400, eloCurrent: 2_400 }),
      ),
    ).not.toContain("elo-change");
  });

  it("returns occurrences in stable priority order", () => {
    const signals = baseSignals({
      scenario: scenario({
        players: [
          seat({ id: "hero", seat: 0, status: "all-in", bet: 1_000, stack: 0 }),
          seat({ id: "v", seat: 1, status: "all-in", bet: 3_000 }),
        ],
      }),
      minimumRaiseAvailable: true,
      openingBigBlind: 200,
      currentBigBlind: 400,
      fieldSize: 6,
      tournamentPlayersRemaining: 2,
      qualifyingPlaces: 2,
      eloBaseline: 2_400,
      eloCurrent: 2_410,
    });
    const occ = detectContextualPromptOccurrences(signals);
    const sorted = [...occ].sort(
      (a, b) =>
        CONTEXTUAL_PROMPT_ORDER.indexOf(a) - CONTEXTUAL_PROMPT_ORDER.indexOf(b),
    );
    expect(occ).toEqual(sorted);
    expect(occ[0]).toBe("all-in");
  });
});

describe("first-occurrence, dismiss, and replay", () => {
  it("offers only the first unseen prompt for the current occurrences", () => {
    // Prompts are off by default now (E27-010); these tests exercise the
    // prompt mechanics, so they opt in explicitly.
    const state = { ...defaultContextualPromptState(), enabled: true };
    const prompt = nextContextualPrompt(state, ["all-in", "side-pot"]);
    expect(prompt?.id).toBe("all-in");
  });

  it("does not repeat a dismissed prompt (first occurrence only)", () => {
    let state = { ...defaultContextualPromptState(), enabled: true };
    const first = nextContextualPrompt(state, ["all-in"]);
    expect(first?.id).toBe("all-in");

    // Dismiss it.
    state = markContextualPromptSeen(state, "all-in");

    // The same event no longer produces a prompt...
    expect(nextContextualPrompt(state, ["all-in"])).toBeUndefined();
    // ...but a different first occurrence still surfaces.
    expect(nextContextualPrompt(state, ["all-in", "side-pot"])?.id).toBe(
      "side-pot",
    );
  });

  it("marks seen idempotently", () => {
    const once = markContextualPromptSeen(
      { ...defaultContextualPromptState(), enabled: true },
      "elimination",
    );
    const twice = markContextualPromptSeen(once, "elimination");
    expect(twice.seen).toEqual(["elimination"]);
    expect(twice).toBe(once);
  });

  it("suppresses all prompts while coaching is disabled", () => {
    const disabled = { enabled: false, seen: [] as ContextualPromptId[] };
    expect(nextContextualPrompt(disabled, ["all-in"])).toBeUndefined();
  });

  /*
    E27-010. Tips fired for ordinary poker events -- blinds going up, stacks
    shortening, waiting before acting -- so routine play arrived as paragraphs
    of commentary beside a table that was showing none of it. They are opt-in
    now, and a save that never expressed a preference gets the new default
    rather than inheriting the old one.
  */
  it("is off by default, so ordinary play is not narrated", () => {
    expect(defaultContextualPromptState().enabled).toBe(false);
    expect(
      nextContextualPrompt(defaultContextualPromptState(), ["blind-increase"]),
    ).toBeUndefined();
  });

  it("replay clears seen history and re-enables coaching", () => {
    const exhausted = {
      enabled: false,
      seen: [...CONTEXTUAL_PROMPT_ORDER],
    };
    const replayed = resetContextualPromptState();
    expect(replayed.enabled).toBe(true);
    expect(replayed.seen).toEqual([]);
    // Every prompt can appear again after a replay.
    expect(nextContextualPrompt(replayed, ["elo-change"])?.id).toBe(
      "elo-change",
    );
    // The exhausted state proves replay is what re-opens them.
    expect(nextContextualPrompt(exhausted, ["elo-change"])).toBeUndefined();
  });
});

describe("prompt recurrence", () => {
  const dismissedEverything: ContextualPromptState = {
    enabled: true,
    seen: [
      "all-in",
      "side-pot",
      "minimum-raise",
      "blind-increase",
      "elimination",
      "qualification",
      "elo-change",
      "short-stack",
      "decision-mistake",
    ],
  };

  it("keeps a dismissed rule dismissed", () => {
    // "This is what a side pot is" is true once and then known.
    for (const id of ["all-in", "side-pot", "minimum-raise"] as const) {
      expect(nextContextualPrompt(dismissedEverything, [id])).toBeUndefined();
    }
  });

  it("brings a situational prompt back in a later session", () => {
    // The original defect: a player who dismissed "you are short-stacked" in
    // their first session never saw it again, so the advice switched itself
    // off exactly when it started to matter.
    for (const id of [
      "short-stack",
      "blind-increase",
      "elimination",
      "qualification",
      "elo-change",
      "decision-mistake",
    ] as const) {
      expect(nextContextualPrompt(dismissedEverything, [id])?.id).toBe(id);
    }
  });

  it("does not repeat a situational prompt within one session", () => {
    expect(
      nextContextualPrompt(dismissedEverything, ["short-stack"], [
        "short-stack",
      ]),
    ).toBeUndefined();
  });

  it("still respects the coaching master switch", () => {
    expect(
      nextContextualPrompt({ enabled: false, seen: [] }, ["short-stack"]),
    ).toBeUndefined();
  });

  it("classifies every prompt exactly once", () => {
    const ids = Object.keys(CONTEXTUAL_PROMPTS) as ContextualPromptId[];
    for (const id of ids) {
      expect(["rule", "situation"]).toContain(PROMPT_RECURRENCE[id]);
    }
    expect(Object.keys(PROMPT_RECURRENCE).sort()).toEqual(ids.sort());
  });
});
