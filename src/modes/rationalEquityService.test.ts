import { describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "../types/poker";
import type { LegalActionSet } from "../engine/betting";
import type { PlayerInformationSet } from "../engine/tournament";
import {
  decideRationalAction,
  decideRationalActionAsync,
  estimateRangeEquity,
  type RationalPolicyInput,
} from "./rational";
import {
  createEquityWorkerRuntime,
  type EquityWorkerResponseMessage,
} from "./rationalEquityProtocol";
import {
  CancelledEquityRequestError,
  createRationalEquityService,
  StaleEquityRequestError,
  type EquityWorkerLike,
} from "./rationalEquityService";

const suits: Record<string, Suit> = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
};

function cards(...values: string[]): Card[] {
  return values.map((value) => ({
    rank: value[0] as Rank,
    suit: suits[value[1]],
  }));
}

function makeSpot(heroCards = cards("As", "Kd")): PlayerInformationSet {
  return {
    handId: "equity-service-hand",
    viewerId: "hero",
    street: "flop",
    board: cards("8h", "7d", "2c"),
    pot: 600,
    currentBet: 200,
    actingPlayerId: "hero",
    buttonSeat: 6,
    players: [
      {
        id: "hero",
        name: "Hero",
        seat: 6,
        stack: 4_000,
        status: "active",
        streetCommitted: 0,
        totalCommitted: 400,
        holeCards: heroCards,
      },
      {
        id: "villain",
        name: "Villain",
        seat: 2,
        stack: 4_000,
        status: "active",
        streetCommitted: 200,
        totalCommitted: 600,
      },
    ],
    actions: [{ playerId: "villain", type: "bet", amount: 200 }],
  };
}

function facingBetLegal(spot: PlayerInformationSet): LegalActionSet {
  const hero = spot.players.find((player) => player.id === "hero");
  if (!hero) throw new Error("Hero missing");
  const toCall = Math.max(0, spot.currentBet - hero.streetCommitted);
  const allInTo = hero.streetCommitted + hero.stack;
  return {
    playerId: "hero",
    toCall,
    check: toCall === 0,
    fold: true,
    call: toCall > 0,
    callAmount: Math.min(hero.stack, toCall),
    raise:
      allInTo >= spot.currentBet * 2
        ? { minTo: spot.currentBet * 2, maxTo: allInTo }
        : undefined,
    allIn: true,
    allInTo,
    raisingReopened: true,
  };
}

function policyInput(
  overrides: Partial<RationalPolicyInput> = {},
): RationalPolicyInput {
  const spot = makeSpot();
  return {
    informationSet: spot,
    legalActions: facingBetLegal(spot),
    bigBlind: 100,
    seed: "equity-service-seed",
    simulations: 240,
    ...overrides,
  };
}

/**
 * A controllable in-process worker that drives the real worker runtime. A
 * manual gate lets a test hold the estimator between slices so cancellation and
 * supersession can be exercised deterministically.
 */
class ControllableEquityWorker implements EquityWorkerLike {
  private readonly listeners = new Set<(event: { data: unknown }) => void>();
  private readonly gates: Array<() => void> = [];
  private readonly runtime;
  terminated = false;

  constructor(private readonly autoRelease: boolean) {
    this.runtime = createEquityWorkerRuntime(
      (message) => this.dispatch(message),
      { yieldBetweenSlices: () => this.gate() },
    );
  }

  private gate(): Promise<void> {
    if (this.autoRelease) return Promise.resolve();
    return new Promise<void>((resolve) => this.gates.push(resolve));
  }

  /** Releases every currently-waiting slice boundary and flushes microtasks. */
  async releaseAll(): Promise<void> {
    for (let guard = 0; guard < 10_000; guard += 1) {
      const next = this.gates.shift();
      if (!next) {
        await Promise.resolve();
        if (this.gates.length === 0) return;
        continue;
      }
      next();
      await Promise.resolve();
    }
  }

  postMessage(message: Parameters<EquityWorkerLike["postMessage"]>[0]): void {
    this.runtime.handle(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: { data: unknown }) => void,
  ): void {
    this.listeners.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  private dispatch(message: EquityWorkerResponseMessage): void {
    for (const listener of this.listeners) listener({ data: message });
  }
}

describe("rational equity service determinism", () => {
  it("in-thread fallback matches the synchronous estimator exactly", async () => {
    const service = createRationalEquityService();
    const request = {
      informationSet: makeSpot(),
      legalActions: facingBetLegal(makeSpot()),
      seed: "equity-service-seed",
      simulations: 240,
    };
    const async = await service.estimate(request);
    const sync = estimateRangeEquity(
      request.informationSet,
      request.legalActions,
      request.seed,
      request.simulations,
    );
    expect(async).toEqual(sync);
    expect(service.usesWorker).toBe(false);
  });

  it("worker-backed estimate matches the synchronous estimator exactly", async () => {
    const worker = new ControllableEquityWorker(true);
    const service = createRationalEquityService({ createWorker: () => worker });
    const request = {
      informationSet: makeSpot(),
      legalActions: facingBetLegal(makeSpot()),
      seed: "worker-seed",
      simulations: 180,
      simulationsPerSlice: 16,
    };
    const async = await service.estimate(request);
    const sync = estimateRangeEquity(
      request.informationSet,
      request.legalActions,
      request.seed,
      request.simulations,
      { simulationsPerSlice: request.simulationsPerSlice },
    );
    expect(async).toEqual(sync);
    expect(service.usesWorker).toBe(true);
    service.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("decideRationalActionAsync equals decideRationalAction across the boundary", async () => {
    const input = policyInput({ seed: "decision-equivalence", simulations: 300 });
    const worker = new ControllableEquityWorker(true);
    const service = createRationalEquityService({ createWorker: () => worker });
    const sync = decideRationalAction(input);
    const async = await decideRationalActionAsync(input, {
      estimateEquity: service.estimate,
    });
    expect(async).toEqual(sync);
  });

  it("in-thread fallback also yields identical decisions", async () => {
    const input = policyInput({ seed: "fallback-equivalence", simulations: 260 });
    const service = createRationalEquityService();
    const sync = decideRationalAction(input);
    const async = await decideRationalActionAsync(input, {
      estimateEquity: service.estimate,
    });
    expect(async).toEqual(sync);
  });
});

describe("rational equity service cancellation and staleness", () => {
  it("rejects a pending request when cancelPending is called", async () => {
    const worker = new ControllableEquityWorker(false);
    const service = createRationalEquityService({ createWorker: () => worker });
    const request = {
      informationSet: makeSpot(),
      legalActions: facingBetLegal(makeSpot()),
      seed: "cancel-seed",
      simulations: 200,
      simulationsPerSlice: 8,
    };
    const pending = service.estimate(request);
    const assertion = expect(pending).rejects.toBeInstanceOf(
      CancelledEquityRequestError,
    );
    service.cancelPending();
    await assertion;
    // Releasing the worker afterwards must not resolve the rejected promise.
    await worker.releaseAll();
    service.dispose();
  });

  it("rejects a superseded request and resolves only the newest", async () => {
    const worker = new ControllableEquityWorker(false);
    const service = createRationalEquityService({ createWorker: () => worker });
    const first = service.estimate({
      informationSet: makeSpot(cards("2c", "3d")),
      legalActions: facingBetLegal(makeSpot()),
      seed: "stale-first",
      simulations: 200,
      simulationsPerSlice: 8,
    });
    const staleAssertion = expect(first).rejects.toBeInstanceOf(
      StaleEquityRequestError,
    );
    // A newer decision supersedes the first before it finishes.
    const second = service.estimate({
      informationSet: makeSpot(cards("As", "Kd")),
      legalActions: facingBetLegal(makeSpot()),
      seed: "stale-second",
      simulations: 200,
      simulationsPerSlice: 8,
    });
    await staleAssertion;
    await worker.releaseAll();
    const secondResult = await second;
    const expected = estimateRangeEquity(
      makeSpot(cards("As", "Kd")),
      facingBetLegal(makeSpot()),
      "stale-second",
      200,
      { simulationsPerSlice: 8 },
    );
    expect(secondResult).toEqual(expected);
    service.dispose();
  });

  it("drops a stale worker result that arrives after supersession", async () => {
    // Two independent workers let the first request complete late, after it has
    // already been superseded, proving late results are ignored.
    let created = 0;
    const workers: ControllableEquityWorker[] = [];
    const service = createRationalEquityService({
      createWorker: () => {
        // Only one worker is created per service; emulate ordering with gates.
        const worker = new ControllableEquityWorker(false);
        workers.push(worker);
        created += 1;
        return worker;
      },
    });
    const first = service.estimate({
      informationSet: makeSpot(),
      legalActions: facingBetLegal(makeSpot()),
      seed: "drop-first",
      simulations: 200,
      simulationsPerSlice: 8,
    });
    const firstAssertion = expect(first).rejects.toBeInstanceOf(
      StaleEquityRequestError,
    );
    const second = service.estimate({
      informationSet: makeSpot(),
      legalActions: facingBetLegal(makeSpot()),
      seed: "drop-second",
      simulations: 120,
      simulationsPerSlice: 8,
    });
    await firstAssertion;
    // Flush both requests; the first's late completion must not throw or leak.
    await workers[0].releaseAll();
    const secondResult = await second;
    expect(secondResult.simulations).toBe(120);
    expect(created).toBe(1);
    service.dispose();
  });
});
