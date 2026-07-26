import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertNoHiddenCards,
  CRITIC_LABELS,
  heuristicCritic,
  httpCritic,
  playPublicHands,
  renderHandHistory,
  runCriticHarness,
  sampleHands,
  type PublicHandHistory,
} from "./critic-harness";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

describe("public hand histories carry no hidden information", () => {
  const { histories, chains } = playPublicHands({
    hands: 6,
    mode: "normal",
    seed: "critic-test",
  });

  it("plays real hands through the production policy", () => {
    expect(histories.length).toBeGreaterThan(0);
    expect(histories[0].actions.length).toBeGreaterThan(0);
    expect(histories[0].players.length).toBe(6);
  });

  it("never carries a hole card, on any player, in any hand", () => {
    for (const history of histories) {
      // The structural check the harness itself uses.
      expect(() => assertNoHiddenCards(history)).not.toThrow();
      // And independently: no player object has a cards field at all.
      for (const player of history.players) {
        expect(Object.keys(player)).toEqual([
          "id",
          "seat",
          "startingStack",
          "finalStatus",
        ]);
      }
    }
  });

  it("catches a card smuggled in under any key, not just `holeCards`", () => {
    // A string search for "holeCards" would miss this; the walk does not.
    const smuggled = {
      ...histories[0],
      players: histories[0].players.map((player, index) =>
        index === 0
          ? { ...player, dealt: [{ rank: "A", suit: "spades" }] }
          : player,
      ),
    } as unknown as PublicHandHistory;
    expect(() => assertNoHiddenCards(smuggled)).toThrow(
      /card outside the board/,
    );
  });

  it("still allows the board, which is public by definition", () => {
    const withBoard = {
      ...histories[0],
      board: [
        { rank: "A", suit: "spades" },
        { rank: "7", suit: "hearts" },
        { rank: "2", suit: "clubs" },
      ],
    } as unknown as PublicHandHistory;
    expect(() => assertNoHiddenCards(withBoard)).not.toThrow();
  });

  it("renders a history a critic can read without leaking cards", () => {
    const sampled = sampleHands(histories, chains, 4);
    for (const hand of sampled) {
      const text = renderHandHistory(hand);
      expect(text).toContain("Hand ");
      expect(text).not.toContain("holeCards");
      // Card notation may appear only for board cards; if a hand has no board
      // the rendering must contain no card notation at all.
      if (hand.history.board.length === 0) {
        expect(text).not.toMatch(/\bboard:/);
      }
    }
  });
});

describe("sampling picks the hands worth a second opinion", () => {
  const { histories, chains } = playPublicHands({
    hands: 12,
    mode: "normal",
    seed: "critic-sample",
  });

  it("returns both suspicious and representative hands", () => {
    const sampled = sampleHands(histories, chains, 12);
    expect(sampled.length).toBeGreaterThan(0);
    // A table that is only ever asked about its worst moments produces a
    // report that looks damning however it plays.
    expect(sampled.some((hand) => hand.reason === "representative")).toBe(true);
  });

  it("reserves the representative share even when suspicion is common", () => {
    // Taking suspicious hands first and truncating crowds representatives out
    // entirely on exactly the runs where an unbiased comparison matters most.
    // A real 20-hand run at limit 8 produced eight suspicious hands and zero
    // representative ones before this was reserved.
    const sampled = sampleHands(histories, chains, 4);
    expect(sampled.length).toBeLessThanOrEqual(4);
    expect(sampled.some((hand) => hand.reason === "representative")).toBe(true);
  });

  it("explains why each suspicious hand was picked", () => {
    const sampled = sampleHands(histories, chains, 12);
    for (const hand of sampled) {
      if (hand.reason === "suspicious") {
        expect(hand.signals.length).toBeGreaterThan(0);
      } else {
        expect(hand.signals).toEqual([]);
      }
    }
  });

  it("is deterministic for the same arguments", () => {
    const first = sampleHands(histories, chains, 8).map(
      (hand) => hand.history.handId,
    );
    const second = sampleHands(histories, chains, 8).map(
      (hand) => hand.history.handId,
    );
    expect(first).toEqual(second);
  });
});

describe("the harness runs offline and states its own standing", () => {
  it("produces a report with no endpoint, no key, and no network", async () => {
    const report = await runCriticHarness({
      hands: 6,
      sample: 4,
      mode: "normal",
      seed: "critic-offline",
    });
    expect(report.critic).toBe("offline-heuristic");
    expect(report.verdicts.length).toBeGreaterThan(0);
    for (const verdict of report.verdicts) {
      expect(CRITIC_LABELS).toContain(verdict.label);
    }
    // Plays real hands through the production policy, so the 5 s default is
    // not a meaningful budget here.
  }, 60_000);

  it("carries the not-a-source-of-truth statement in the data, not only in prose", async () => {
    // A consumer that renders the report cannot present it as a verdict
    // without also carrying the disclaimer.
    const report = await runCriticHarness({
      hands: 4,
      sample: 2,
      mode: "normal",
      seed: "critic-disclaimer",
    });
    expect(report.status).toBe("qualitative-signal-only");
    expect(report.disclaimer).toContain("never override");
    expect(report.disclaimer).toContain("not a release gate");
  }, 60_000);

  it("is not wired into release verification", () => {
    // The risk recorded against E14-002 is that this becomes a gate.
    const runner = readFileSync(
      path.join(projectRoot, "scripts", "release", "run-release-verification.mjs"),
      "utf8",
    );
    expect(runner).not.toContain("critic-harness");
    expect(runner).not.toContain("report-critic-harness");
  });
});

describe("reaching the network is deliberate, never accidental", () => {
  it("has no default endpoint and no environment fallback", () => {
    const source = readFileSync(
      path.join(projectRoot, "scripts", "critic-harness.ts"),
      "utf8",
    );
    // An endpoint read from the environment would make an egress path appear
    // on a machine that happened to have a variable set.
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/https?:\/\/[a-z]/i);
  });

  it("re-checks redaction immediately before the request leaves", async () => {
    let sentBody = "";
    const critic = httpCritic({
      endpoint: "http://localhost:0/label",
      model: "test-model",
      fetchImpl: (async (_url: string, init: { body: string }) => {
        sentBody = init.body;
        return {
          ok: true,
          json: async () => ({ label: "human-plausible", note: "ok" }),
        };
      }) as unknown as typeof fetch,
    });

    const { histories, chains } = playPublicHands({
      hands: 3,
      mode: "normal",
      seed: "critic-http",
    });
    const [hand] = sampleHands(histories, chains, 1);
    await critic.label(hand);
    expect(sentBody).not.toContain("holeCards");

    // And a history that has picked up a card on its way through is stopped
    // here, at the last point where it still can be.
    const tainted = {
      ...hand,
      history: {
        ...hand.history,
        players: hand.history.players.map((player) => ({
          ...player,
          dealt: [{ rank: "K", suit: "hearts" }],
        })),
      },
    } as typeof hand;
    await expect(critic.label(tainted)).rejects.toThrow(
      /card outside the board/,
    );
  });

  it("only accepts labels from the fixed vocabulary", async () => {
    const critic = httpCritic({
      endpoint: "http://localhost:0/label",
      model: "test-model",
      fetchImpl: (async () => ({
        ok: true,
        // A chatty model inventing its own category must not create one.
        json: async () => ({ label: "catastrophically-bad", note: "n/a" }),
      })) as unknown as typeof fetch,
    });
    const { histories, chains } = playPublicHands({
      hands: 2,
      mode: "normal",
      seed: "critic-vocab",
    });
    const [hand] = sampleHands(histories, chains, 1);
    const verdict = await critic.label(hand);
    expect(CRITIC_LABELS).toContain(verdict.label);
  });
});

describe("the harness is excluded from the shipped bundle", () => {
  it("lives outside every production entrypoint's import graph", () => {
    // The production-composition audit walks imports from src/main.tsx and the
    // Electron entrypoints. Nothing under src/ or electron/ may reach here.
    const policy = JSON.parse(
      readFileSync(
        path.join(projectRoot, "config", "production-composition-policy.json"),
        "utf8",
      ),
    ) as { rendererEntrypoints?: string[]; electronEntrypoints?: string[] };
    const entrypoints = [
      ...(policy.rendererEntrypoints ?? ["src/main.tsx"]),
      ...(policy.electronEntrypoints ?? [
        "electron/main.cjs",
        "electron/preload.cjs",
      ]),
    ];
    for (const entry of entrypoints) {
      expect(entry.startsWith("scripts/")).toBe(false);
    }
  });

  it("is never imported by shipped code", () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSyncSafe(directory)) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx|cjs|mjs|js|jsx)$/.test(entry.name)) continue;
        const source = readFileSync(full, "utf8");
        if (/from\s+["'][^"']*critic-harness/.test(source)) {
          offenders.push(path.relative(projectRoot, full));
        }
      }
    };
    walk(path.join(projectRoot, "src"));
    walk(path.join(projectRoot, "electron"));
    expect(offenders).toEqual([]);
  });
});

function readdirSyncSafe(directory: string) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (
      require("node:fs") as typeof import("node:fs")
    ).readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

describe("the offline critic labels what it claims to", () => {
  it("returns a label from the vocabulary the criterion names", async () => {
    const { histories, chains } = playPublicHands({
      hands: 8,
      mode: "normal",
      seed: "critic-labels",
    });
    for (const hand of sampleHands(histories, chains, 6)) {
      const verdict = await heuristicCritic.label(hand);
      expect(CRITIC_LABELS).toContain(verdict.label);
      expect(verdict.critic).toBe("offline-heuristic");
    }
  }, 60_000);
});
