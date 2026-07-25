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
  });

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
