import { describe, expect, it } from "vitest";
import { createPokerTableSnapshot } from "./tournamentSession";
import {
  advanceTournamentRunnerOneStep,
  advanceTournamentRunnerToHero,
  applyHeroTournamentActionOneStep,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTimedTournamentRunner,
  heroTournamentLegalActions,
} from "./tournamentRunner";

const hero = {
  id: "hero",
  name: "Player",
  rating: 1_000,
};

describe("tournament runner", () => {
  it("emits ordered public-only milestones while advancing one transition at a time", () => {
    const started = advanceTournamentRunnerOneStep(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-presentation-events",
      }),
      { policy: { simulations: 50 } },
    );
    expect(started.events.map((event) => event.kind)).toEqual([
      "button-moved",
      "blinds-posted",
      "hole-cards-dealt",
    ]);
    expect(JSON.stringify(started.events)).not.toContain("holeCards");

    const opponent = advanceTournamentRunnerOneStep(started.runner, {
      policy: { simulations: 50 },
    });
    expect(opponent.events).toMatchObject([
      { kind: "action", playerId: expect.any(String) },
    ]);
    expect(opponent.events[0]?.kind).toBe("action");
    expect(opponent.events[0]?.id).toContain(":action:");
  });

  it("reaches the same authoritative hero decision whether presentation events are consumed or skipped", () => {
    const seed = "runner-presentation-skip";
    const source = createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "rational",
      seed,
    });
    const expected = advanceTournamentRunnerToHero(source, {
      policy: { simulations: 50 },
    });
    let stepped = source;
    for (let index = 0; index < 100; index += 1) {
      const transition = advanceTournamentRunnerOneStep(stepped, {
        policy: { simulations: 50 },
      });
      stepped = transition.runner;
      if (transition.awaitingHero || stepped.session.status === "complete") break;
    }
    expect(stepped.session).toEqual(expected.session);
    expect(stepped.decisions).toEqual(expected.decisions);
    expect(stepped.sequence).toBe(expected.sequence);
  });

  it("records a hero action once before the presentation clock advances opponents", () => {
    const ready = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-presentation-hero",
      }),
      { policy: { simulations: 50 } },
    );
    const legal = heroTournamentLegalActions(ready);
    if (!legal) throw new Error("Expected a hero decision");
    const action = legal.check ? "check" : legal.call ? "call" : "fold";
    const transition = applyHeroTournamentActionOneStep(ready, { action });
    expect(transition.events).toMatchObject([
      { kind: "action", playerId: hero.id, command: { type: action } },
    ]);
    expect(transition.runner.decisions).toHaveLength(ready.decisions.length + 1);
    expect(() => applyHeroTournamentActionOneStep(transition.runner, { action })).toThrow(
      "not waiting for the hero",
    );
  });

  it("begins the next hand with one continuous public inter-hand sequence", () => {
    let runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-inter-hand-continuity",
      }),
      { policy: { simulations: 50 } },
    );
    const firstHandId = runner.session.activeHand?.handId;
    if (!firstHandId) throw new Error("Expected the opening hand");
    const legal = heroTournamentLegalActions(runner);
    if (!legal) throw new Error("Expected a hero decision");
    const action = legal.fold ? "fold" : legal.check ? "check" : "call";
    runner = applyHeroTournamentActionOneStep(runner, { action }).runner;

    for (let step = 0; step < 160; step += 1) {
      if (runner.session.lastHand?.handId === firstHandId && !runner.session.activeHand) break;
      const transition = advanceTournamentRunnerOneStep(runner, {
        policy: { simulations: 50 },
      });
      runner = transition.runner;
      if (transition.awaitingHero) {
        const nextLegal = heroTournamentLegalActions(runner);
        if (!nextLegal) throw new Error("Expected legal follow-up action");
        const nextAction = nextLegal.fold ? "fold" : nextLegal.check ? "check" : "call";
        runner = applyHeroTournamentActionOneStep(runner, { action: nextAction }).runner;
      }
    }

    expect(runner.session.lastHand?.handId).toBe(firstHandId);
    expect(runner.session.activeHand).toBeUndefined();
    const nextHand = advanceTournamentRunnerOneStep(runner, {
      policy: { simulations: 50 },
    });
    expect(nextHand.runner.session.activeHand?.handId).not.toBe(firstHandId);
    expect(nextHand.events.map((event) => event.kind)).toEqual([
      "button-moved",
      "blinds-posted",
      "hole-cards-dealt",
    ]);
  });

  it("keeps one hand's public stream ordered and free of duplicate milestones", () => {
    let runner = createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed: "runner-public-hand-stream",
    });
    const events = [] as Array<ReturnType<typeof advanceTournamentRunnerOneStep>["events"][number]>;

    for (let index = 0; index < 120; index += 1) {
      const transition = advanceTournamentRunnerOneStep(runner, {
        policy: { simulations: 50 },
      });
      events.push(...transition.events);
      runner = transition.runner;
      if (transition.awaitingHero) {
        const legal = heroTournamentLegalActions(runner);
        if (!legal) throw new Error("Expected legal hero action");
        const action = legal.allIn
          ? "all-in"
          : legal.call
            ? "call"
            : legal.check
              ? "check"
              : "fold";
        const heroTransition = applyHeroTournamentActionOneStep(runner, { action });
        events.push(...heroTransition.events);
        runner = heroTransition.runner;
      }
      if (runner.session.lastHand && !runner.session.activeHand) break;
    }

    expect(events.slice(0, 3).map((event) => event.kind)).toEqual([
      "button-moved",
      "blinds-posted",
      "hole-cards-dealt",
    ]);
    expect(events.some((event) => event.kind === "action")).toBe(true);
    expect(events.some((event) => event.kind === "pot-awarded")).toBe(true);
    const sidePot = events.find((event) => event.kind === "side-pot-formed");
    if (sidePot?.kind === "side-pot-formed") {
      expect(sidePot.potId).toBeTruthy();
      expect(Array.isArray(sidePot.eligiblePlayerIds)).toBe(true);
    }
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    const firstAward = events.findIndex((event) => event.kind === "pot-awarded");
    const firstAction = events.findIndex((event) => event.kind === "action");
    expect(firstAward).toBeGreaterThan(firstAction);
  });

  it("reveals only live showdown hands in the transient public event", () => {
    let showdown: Extract<
      ReturnType<typeof advanceTournamentRunnerOneStep>["events"][number],
      { kind: "showdown" }
    > | undefined;

    for (let seedIndex = 0; seedIndex < 12 && !showdown; seedIndex += 1) {
      let runner = createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: `runner-showdown-${seedIndex}`,
      });
      for (let stepIndex = 0; stepIndex < 160 && !showdown; stepIndex += 1) {
        const transition = advanceTournamentRunnerOneStep(runner, {
          policy: { simulations: 50 },
        });
        showdown = transition.events.find(
          (event): event is Extract<typeof event, { kind: "showdown" }> =>
            event.kind === "showdown",
        );
        runner = transition.runner;
        if (transition.awaitingHero) {
          const legal = heroTournamentLegalActions(runner);
          if (!legal) throw new Error("Expected legal hero action");
          const action = legal.allIn ? "all-in" : legal.call ? "call" : "check";
          const heroTransition = applyHeroTournamentActionOneStep(runner, { action });
          showdown = heroTransition.events.find(
            (event): event is Extract<typeof event, { kind: "showdown" }> =>
              event.kind === "showdown",
          );
          runner = heroTransition.runner;
        }
      }
    }

    expect(showdown).toBeDefined();
    if (!showdown) return;
    expect(showdown.reveals).toHaveLength(showdown.playerIds.length);
    expect(showdown.reveals.every((reveal) => reveal.cards.length === 2)).toBe(true);
    expect(showdown.awards.length).toBeGreaterThan(0);
  }, 60_000);

  it("keeps an early all-in reveal limited to live all-in players", () => {
    let reveal: Extract<
      ReturnType<typeof advanceTournamentRunnerOneStep>["events"][number],
      { kind: "all-in-reveal" }
    > | undefined;
    let runner = createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed: "runner-all-in-reveal",
    });
    for (let step = 0; step < 160 && !reveal; step += 1) {
      const transition = advanceTournamentRunnerOneStep(runner, { policy: { simulations: 50 } });
      reveal = transition.events.find(
        (event): event is Extract<typeof event, { kind: "all-in-reveal" }> => event.kind === "all-in-reveal",
      );
      runner = transition.runner;
      if (transition.awaitingHero) {
        const legal = heroTournamentLegalActions(runner);
        if (!legal) throw new Error("Expected legal hero action");
        runner = applyHeroTournamentActionOneStep(runner, { action: legal.allIn ? "all-in" : "fold" }).runner;
      }
    }
    if (!reveal) return; // The seed can legitimately finish without a preflop all-in.
    expect(reveal.playerIds).toHaveLength(reveal.reveals.length);
    expect(reveal.reveals.every((entry) => entry.cards.length === 2)).toBe(true);
    // Scans up to 160 policy decisions; ~1.7s alone but slower under parallel
    // load, so it gets an explicit budget rather than the 5s default.
  }, 60_000);

  it("runs the packaged scene fixture through every public board street", () => {
    const publicBoardEvents: Array<{ street: "flop" | "turn" | "river" }> = [];
    let runner = createCareerTournamentRunner({
      eventId: "local-qualifier",
      hero,
      mode: "normal",
      seed: "runner-showdown-3",
    });
    for (let step = 0; step < 160 && publicBoardEvents.length < 5; step += 1) {
      const transition = advanceTournamentRunnerOneStep(runner, { policy: { simulations: 50 } });
      publicBoardEvents.push(
        ...transition.events.filter(
          (event): event is Extract<typeof event, { kind: "board-card-dealt" }> =>
            event.kind === "board-card-dealt",
        ),
      );
      runner = transition.runner;
      if (transition.awaitingHero) {
        const legal = heroTournamentLegalActions(runner);
        if (!legal) throw new Error("Expected legal hero action");
        runner = applyHeroTournamentActionOneStep(runner, {
          action: legal.allIn ? "all-in" : legal.call ? "call" : "check",
        }).runner;
      }
    }
    expect(publicBoardEvents.map((event) => event.street)).toEqual([
      "flop", "flop", "flop", "turn", "river",
    ]);
  });

  it("never leaks a hole card through a non-reveal event, and never reveals a folded hand", () => {
    const label = (card: { rank: string; suit: string }) =>
      `${card.rank}${card.suit[0]}`;
    let sweptHands = 0;
    let sweptReveals = 0;

    for (let seedIndex = 0; seedIndex < 3; seedIndex += 1) {
      let runner = createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: `runner-reveal-privacy-${seedIndex}`,
      });
      // Fold tracking is per hand: a player who folds this hand must never be
      // among that hand's reveals, even though the same id may show down later.
      let foldedThisHand = new Set<string>();
      let currentHandId = runner.session.activeHand?.handId;

      for (let step = 0; step < 90; step += 1) {
        const before = runner.session.activeHand;
        if (before && before.handId !== currentHandId) {
          currentHandId = before.handId;
          foldedThisHand = new Set();
          sweptHands += 1;
        }
        // Every hole card the engine is holding for this hand, minus anything
        // the board has already made public.
        const boardLabels = new Set((before?.board ?? []).map(label));
        const hiddenLabels = new Set(
          Object.values(before?.holeCards ?? {})
            .flat()
            .map(label)
            .filter((cardLabel) => !boardLabels.has(cardLabel)),
        );

        const transition = heroTournamentLegalActions(runner)
          ? applyHeroTournamentActionOneStep(runner, {
              action: heroTournamentLegalActions(runner)?.check ? "check" : "call",
            })
          : advanceTournamentRunnerOneStep(runner, { policy: { simulations: 50 } });

        for (const event of transition.events) {
          if (event.kind === "action" && event.command.type === "fold") {
            foldedThisHand.add(event.playerId);
          }
          if (event.kind === "showdown" || event.kind === "all-in-reveal") {
            sweptReveals += 1;
            for (const entry of event.reveals) {
              expect(foldedThisHand.has(entry.playerId)).toBe(false);
              expect(event.playerIds).toContain(entry.playerId);
            }
            continue;
          }
          // A non-reveal event may legitimately carry a board card or the
          // public best-five of an award, but never an unrevealed hole card.
          const serialized = JSON.stringify(event);
          const publicLabels = new Set([
            ...boardLabels,
            ...(event.kind === "board-card-dealt" ? [label(event.card)] : []),
            ...(event.kind === "hand-result"
              ? event.awards.flatMap((award) => award.hand?.cards.map(label) ?? [])
              : []),
          ]);
          for (const hidden of hiddenLabels) {
            if (publicLabels.has(hidden)) continue;
            expect(
              serialized.includes(`"${hidden[0]}"`) &&
                serialized.includes("holeCards"),
            ).toBe(false);
          }
          expect(serialized).not.toContain("holeCards");
        }

        runner = transition.runner;
        if (runner.session.status === "complete") break;
        if (transition.awaitingHero) {
          const legal = heroTournamentLegalActions(runner);
          if (!legal) break;
          runner = applyHeroTournamentActionOneStep(runner, {
            action: legal.check ? "check" : legal.call ? "call" : "fold",
          }).runner;
        }
      }
    }

    expect(sweptHands).toBeGreaterThan(0);
    expect(sweptReveals).toBeGreaterThan(0);
  }, 60_000);

  it("keeps emitting public milestones after the hero folds until the hand settles", () => {
    let runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-hero-folds-watch-runout",
      }),
      { policy: { simulations: 50 } },
    );
    const fold = applyHeroTournamentActionOneStep(runner, { action: "fold" });
    runner = fold.runner;
    const events = [...fold.events];

    for (let step = 0; step < 120 && !runner.session.lastHand; step += 1) {
      const transition = advanceTournamentRunnerOneStep(runner, {
        policy: { simulations: 50 },
      });
      expect(transition.awaitingHero).toBe(false);
      events.push(...transition.events);
      runner = transition.runner;
    }

    expect(runner.session.lastHand).toBeDefined();
    expect(events.some((event) => event.kind === "pot-awarded")).toBe(true);
    expect(events.some((event) => event.kind === "action")).toBe(true);
    const resultIndex = events.findIndex(
      (event) => event.kind === "hand-result" || event.kind === "showdown",
    );
    const awardIndex = events.findIndex((event) => event.kind === "pot-awarded");
    expect(resultIndex).toBeGreaterThan(-1);
    expect(resultIndex).toBeLessThan(awardIndex);
    const collectionIndex = events.findIndex((event) => event.kind === "cards-collected");
    expect(collectionIndex).toBeGreaterThan(awardIndex);
    expect(events[events.length - 1]?.kind).toBe("cards-collected");
    const handResult = events[resultIndex];
    expect(["hand-result", "showdown"]).toContain(handResult.kind);
    if (handResult.kind === "hand-result") {
      expect(handResult.awards.length).toBeGreaterThan(0);
      expect(JSON.stringify(handResult)).not.toMatch(/holeCards|rank|suit/i);
    }
  });

  it("automates opponents and pauses only for a legal hero decision", () => {
    const runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-start",
      }),
      { policy: { simulations: 50 } },
    );
    const legal = heroTournamentLegalActions(runner);
    expect(legal?.playerId).toBe(hero.id);
    expect(runner.session.activeHand).toBeDefined();
    expect(runner.decisions.every((entry) => entry.playerId !== hero.id)).toBe(
      true,
    );
  });

  it("accepts a legal hero action and advances to the next hero decision", () => {
    let runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "rational",
        seed: "runner-action",
      }),
      { policy: { simulations: 50 } },
    );
    const legal = heroTournamentLegalActions(runner);
    if (!legal) throw new Error("Expected hero action");
    const action = legal.check ? "check" : legal.call ? "call" : "fold";
    runner = applyHeroTournamentAction(
      runner,
      { action, decisionElapsedMs: 2_000 },
      { policy: { simulations: 50 } },
    );
    expect(runner.sequence).toBeGreaterThan(0);
    expect(
      runner.session.status === "complete" ||
        heroTournamentLegalActions(runner)?.playerId === hero.id,
    ).toBe(true);
  });

  it("keeps opponent cards out of the runner's table snapshot", () => {
    const runner = advanceTournamentRunnerToHero(
      createCareerTournamentRunner({
        eventId: "local-qualifier",
        hero,
        mode: "normal",
        seed: "runner-snapshot",
      }),
      { policy: { simulations: 50 } },
    );
    const snapshot = createPokerTableSnapshot(runner.session);
    expect(
      snapshot.players
        .filter((player) => player.id !== hero.id)
        .every((player) => player.cards === undefined),
    ).toBe(true);
  });

  it("uses the timed blind guarantee at the configured deadline", () => {
    const startedAtMs = 10_000;
    const runner = advanceTournamentRunnerToHero(
      createTimedTournamentRunner({
        minutes: 5,
        hero,
        seed: "runner-timed",
        nowMs: startedAtMs,
      }),
      {
        nowMs: startedAtMs + 5 * 60_000,
        policy: { simulations: 50 },
      },
    );
    const stacks = runner.session.tournament.players
      .filter((player) => player.status === "active")
      .map((player) => player.stack)
      .sort((left, right) => right - left);
    expect(runner.timed?.lastBlindDecision?.phase).toBe("deadline");
    expect(runner.timed?.lastBlindDecision?.bigBlind).toBeGreaterThanOrEqual(
      stacks[1],
    );
  });

  it.each(["normal", "rational"] as const)(
    "can complete a scored %s career event through hero decisions",
    (mode) => {
      let runner = advanceTournamentRunnerToHero(
        createCareerTournamentRunner({
          eventId: "local-qualifier",
          hero,
          mode,
          seed: `runner-complete-${mode}`,
        }),
        { policy: { simulations: 50 } },
      );
      for (let step = 0; step < 500 && !runner.session.result; step += 1) {
        const legal = heroTournamentLegalActions(runner);
        if (!legal) {
          runner = advanceTournamentRunnerToHero(runner, {
            policy: { simulations: 50 },
          });
          continue;
        }
        const action = legal.allIn
          ? "all-in"
          : legal.call
            ? "call"
            : legal.check
              ? "check"
              : "fold";
        runner = applyHeroTournamentAction(
          runner,
          { action, decisionElapsedMs: 500 },
          { policy: { simulations: 50 } },
        );
      }
      expect(runner.session.result).toMatchObject({
        eventId: "local-qualifier",
        fieldSize: 6,
      });
      expect(runner.session.result?.tournamentEloDelta).toEqual(
        expect.any(Number),
      );
    },
    // Plays a full six-handed event through the real policy: ~3 s on its own,
    // which overruns the 5 s default once the suite is running files in
    // parallel. The budget is generous because the failure mode this guards
    // against is a hang, not a slow run.
    30_000,
  );

  it("completes a Timed Table with placement Elo and no career unlocks", () => {
    let runner = advanceTournamentRunnerToHero(
      createTimedTournamentRunner({
        minutes: 5,
        hero,
        seed: "runner-timed-complete",
        nowMs: 10_000,
      }),
      {
        nowMs: 10_000 + 5 * 60_000,
        policy: { simulations: 50 },
      },
    );
    for (let step = 0; step < 100 && !runner.session.result; step += 1) {
      const legal = heroTournamentLegalActions(runner);
      if (!legal) {
        runner = advanceTournamentRunnerToHero(runner, {
          nowMs: 10_000 + 5 * 60_000,
          policy: { simulations: 50 },
        });
        continue;
      }
      const action = legal.allIn
        ? "all-in"
        : legal.call
          ? "call"
          : legal.check
            ? "check"
            : "fold";
      runner = applyHeroTournamentAction(
        runner,
        { action, decisionElapsedMs: 500 },
        {
          nowMs: 10_000 + 5 * 60_000,
          policy: { simulations: 50 },
        },
      );
    }
    expect(runner.session.result).toBeDefined();
    expect(runner.session.result?.eventName).toBe("5-Minute Timed Table");
    expect(runner.session.result?.unlockedEventIds).toEqual([]);
    expect(runner.session.result?.nextEventId).toBeUndefined();
    expect(runner.session.result?.tournamentEloDelta).toEqual(
      expect.any(Number),
    );
  });
});
