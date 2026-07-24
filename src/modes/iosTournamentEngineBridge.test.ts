import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type TournamentEngine = {
  invoke(request: { operation: string; payload: Record<string, unknown> }): Record<string, unknown>;
};

async function engine(): Promise<TournamentEngine> {
  const source = await readFile(
    "ios/PokerTrainingPro/Resources/Engine/tournament-session-engine.js",
    "utf8",
  );
  const sandbox = { JSON, Math, Object, Array, String, Number, Boolean, Error, Set, Map };
  vm.runInNewContext(source, sandbox);
  return (sandbox as unknown as { PokerTrainingProTournamentEngine: TournamentEngine })
    .PokerTrainingProTournamentEngine;
}

const hero = { id: "hero", name: "Mobile Hero", rating: 1_200 };

describe("iOS shared tournament-session engine", () => {
  it("creates a hero-safe Normal tournament snapshot without JavaScriptCore structuredClone", async () => {
    const response = await engine().then((bridge) =>
      bridge.invoke({
        operation: "createTournament",
        payload: {
          kind: "career",
          eventId: "local-qualifier",
          mode: "normal",
          seed: "ios-session-contract",
          nowMs: 1_000,
          hero,
        },
      }),
    );

    expect(response.table).toBeDefined();
    expect(response.legalActions).toBeDefined();
    expect(response.replay).toBeDefined();
    expect(JSON.stringify(response)).not.toContain('"opponentCards"');
  });

  it("applies a legal hero action from an opaque replay checkpoint", async () => {
    const bridge = await engine();
    const first = bridge.invoke({
      operation: "createTournament",
      payload: { kind: "career", eventId: "local-qualifier", mode: "rational", seed: "ios-action-contract", nowMs: 1_000, hero },
    });
    const legal = first.legalActions as { check?: boolean; call?: boolean };
    const action = legal.check ? "check" : legal.call ? "call" : "fold";
    const next = bridge.invoke({
      operation: "actTournament",
      payload: { replay: first.replay, action, nowMs: 1_500, decisionElapsedMs: 500 },
    });
    expect(next.replay).toBeDefined();
  }, 15_000);
});
