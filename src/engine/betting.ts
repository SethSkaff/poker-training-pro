export type BettingPlayerStatus = "active" | "folded" | "all-in";
export type BettingActionType =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "all-in";

export interface BettingPlayerState {
  id: string;
  stack: number;
  streetCommitted: number;
  totalCommitted: number;
  status: BettingPlayerStatus;
}

export interface BettingRoundState {
  players: BettingPlayerState[];
  /** Fixed chips represented by this round: stacks plus all hand commitments. */
  chipTotal: number;
  /** Full clockwise order, rotated so the first player to act is first. */
  actionOrder: string[];
  pending: string[];
  currentBet: number;
  minimumBet: number;
  lastFullRaise: number;
  lastActedAtBet: Record<string, number | undefined>;
  complete: boolean;
  handComplete: boolean;
  lastAggressorId?: string;
}

export interface CreateBettingRoundOptions {
  minimumBet: number;
  /**
   * Used pre-flop when a short big blind posted less than the scheduled blind.
   * The scheduled big blind remains the nominal opening wager.
   */
  nominalOpeningBet?: number;
  currentBet?: number;
  lastFullRaise?: number;
}

export interface LegalActionSet {
  playerId: string;
  toCall: number;
  check: boolean;
  fold: boolean;
  call: boolean;
  callAmount: number;
  bet?: { min: number; max: number };
  raise?: { minTo: number; maxTo: number };
  allIn: boolean;
  allInTo: number;
  raisingReopened: boolean;
}

export interface BettingActionCommand {
  type: BettingActionType;
  /** Total amount committed on this street after a bet or raise. */
  to?: number;
}

export interface BettingActionResult {
  state: BettingRoundState;
  event: {
    playerId: string;
    type: BettingActionType;
    committed: number;
    to: number;
    previousBet: number;
    currentBet: number;
    fullRaise: boolean;
    shortAllIn: boolean;
    allIn: boolean;
  };
}

function assertChipAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function cloneState(state: BettingRoundState): BettingRoundState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    actionOrder: [...state.actionOrder],
    pending: [...state.pending],
    lastActedAtBet: { ...state.lastActedAtBet },
  };
}

/**
 * Verifies the round-local chip ledger. A betting round does not own the
 * central pot, so every chip is represented exactly once by either a player's
 * remaining stack or their cumulative hand contribution.
 */
export function assertBettingStateInvariant(state: BettingRoundState): void {
  assertChipAmount(state.chipTotal, "Betting chip total");
  let observedTotal = 0;
  for (const player of state.players) {
    assertChipAmount(player.stack, `Stack for ${player.id}`);
    assertChipAmount(
      player.streetCommitted,
      `Street contribution for ${player.id}`,
    );
    assertChipAmount(
      player.totalCommitted,
      `Total contribution for ${player.id}`,
    );
    if (player.streetCommitted > player.totalCommitted) {
      throw new Error(
        `Street contribution for ${player.id} exceeds total contribution`,
      );
    }
    if (player.status === "all-in" && player.stack !== 0) {
      throw new Error(`All-in player ${player.id} must have a zero stack`);
    }
    observedTotal += player.stack + player.totalCommitted;
  }
  if (observedTotal !== state.chipTotal) {
    throw new Error(
      `Betting chip conservation failed: expected ${state.chipTotal}, observed ${observedTotal}`,
    );
  }
  if (state.currentBet < 0 || state.lastFullRaise <= 0) {
    throw new Error("Betting thresholds must be positive");
  }
  if (state.players.some((player) => player.streetCommitted > state.currentBet)) {
    throw new Error("A street contribution exceeds the current bet");
  }
}

function clockwiseAfter(order: readonly string[], playerId: string): string[] {
  const index = order.indexOf(playerId);
  if (index < 0) throw new Error(`Player ${playerId} is not in action order`);
  return [
    ...order.slice(index + 1),
    ...order.slice(0, index + 1),
  ];
}

function livePlayers(state: BettingRoundState): BettingPlayerState[] {
  return state.players.filter((player) => player.status !== "folded");
}

function activePlayers(state: BettingRoundState): BettingPlayerState[] {
  return state.players.filter(
    (player) => player.status === "active" && player.stack > 0,
  );
}

function raisingReopenedFor(
  state: BettingRoundState,
  playerId: string,
): boolean {
  const lastBetFaced = state.lastActedAtBet[playerId];
  if (lastBetFaced === undefined) return true;
  return state.currentBet - lastBetFaced >= state.lastFullRaise;
}

function recomputePending(
  state: BettingRoundState,
  afterPlayerId?: string,
): void {
  if (livePlayers(state).length <= 1) {
    state.pending = [];
    state.complete = true;
    state.handComplete = true;
    return;
  }

  const active = activePlayers(state);
  if (active.length === 0) {
    state.pending = [];
    state.complete = true;
    return;
  }

  const candidates = afterPlayerId
    ? clockwiseAfter(state.actionOrder, afterPlayerId)
    : state.actionOrder;

  let pending = candidates.filter((playerId) => {
    const player = state.players.find((entry) => entry.id === playerId);
    if (!player || player.status !== "active" || player.stack <= 0) return false;
    return (
      state.lastActedAtBet[playerId] === undefined ||
      player.streetCommitted < state.currentBet
    );
  });

  // A sole player with chips cannot bet into opponents who are all-in. They
  // still receive action when facing an unmatched all-in wager.
  if (
    active.length === 1 &&
    active[0].streetCommitted >= state.currentBet
  ) {
    pending = [];
  }

  state.pending = pending;
  state.complete = pending.length === 0;
  state.handComplete = false;
}

export function createBettingRound(
  players: readonly BettingPlayerState[],
  actionOrder: readonly string[],
  options: CreateBettingRoundOptions,
): BettingRoundState {
  assertChipAmount(options.minimumBet, "Minimum bet");
  if (options.minimumBet === 0) throw new Error("Minimum bet must be positive");

  const ids = players.map((player) => player.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Betting player IDs must be unique");
  }
  if (
    actionOrder.length !== ids.length ||
    new Set(actionOrder).size !== actionOrder.length ||
    actionOrder.some((id) => !ids.includes(id))
  ) {
    throw new Error("Action order must contain every player exactly once");
  }

  const normalizedPlayers = players.map((player) => {
    assertChipAmount(player.stack, `Stack for ${player.id}`);
    assertChipAmount(
      player.streetCommitted,
      `Street contribution for ${player.id}`,
    );
    assertChipAmount(
      player.totalCommitted,
      `Total contribution for ${player.id}`,
    );
    return {
      ...player,
      status:
        player.stack === 0 && player.status === "active"
          ? ("all-in" as const)
          : player.status,
    };
  });

  const postedMaximum = Math.max(
    0,
    ...normalizedPlayers.map((player) => player.streetCommitted),
  );
  const currentBet = Math.max(
    postedMaximum,
    options.nominalOpeningBet ?? 0,
    options.currentBet ?? 0,
  );

  const state: BettingRoundState = {
    players: normalizedPlayers,
    chipTotal: normalizedPlayers.reduce(
      (sum, player) => sum + player.stack + player.totalCommitted,
      0,
    ),
    actionOrder: [...actionOrder],
    pending: [],
    currentBet,
    minimumBet: options.minimumBet,
    lastFullRaise: options.lastFullRaise ?? options.minimumBet,
    lastActedAtBet: {},
    complete: false,
    handComplete: false,
  };
  recomputePending(state);
  assertBettingStateInvariant(state);
  return state;
}

export function nextToAct(state: BettingRoundState): string | null {
  return state.pending[0] ?? null;
}

export function getLegalActions(
  state: BettingRoundState,
  playerId: string,
): LegalActionSet {
  if (state.complete) throw new Error("Betting round is complete");
  if (nextToAct(state) !== playerId) {
    throw new Error(`It is not ${playerId}'s turn`);
  }

  const player = state.players.find((entry) => entry.id === playerId);
  if (!player || player.status !== "active" || player.stack <= 0) {
    throw new Error(`Player ${playerId} cannot act`);
  }

  const toCall = Math.max(0, state.currentBet - player.streetCommitted);
  const allInTo = player.streetCommitted + player.stack;
  const reopened = raisingReopenedFor(state, playerId);
  const maxTo = allInTo;
  const minRaiseTo = state.currentBet + state.lastFullRaise;
  const canIncreaseBet = reopened && maxTo > state.currentBet;

  return {
    playerId,
    toCall,
    check: toCall === 0,
    fold: true,
    call: toCall > 0,
    callAmount: Math.min(player.stack, toCall),
    bet:
      state.currentBet === 0 && maxTo >= state.minimumBet
        ? { min: state.minimumBet, max: maxTo }
        : undefined,
    raise:
      state.currentBet > 0 &&
      canIncreaseBet &&
      maxTo >= minRaiseTo
        ? { minTo: minRaiseTo, maxTo }
        : undefined,
    allIn:
      maxTo <= state.currentBet ||
      state.currentBet === 0 ||
      canIncreaseBet,
    allInTo,
    raisingReopened: reopened,
  };
}

function requireTarget(
  command: BettingActionCommand,
  minimum: number,
  maximum: number,
): number {
  if (command.to === undefined) {
    throw new Error(`${command.type} requires a total target`);
  }
  assertChipAmount(command.to, `${command.type} target`);
  if (command.to < minimum || command.to > maximum) {
    throw new Error(
      `${command.type} target must be between ${minimum} and ${maximum}`,
    );
  }
  return command.to;
}

export function applyBettingAction(
  source: BettingRoundState,
  playerId: string,
  command: BettingActionCommand,
): BettingActionResult {
  const legal = getLegalActions(source, playerId);
  const state = cloneState(source);
  const player = state.players.find((entry) => entry.id === playerId);
  if (!player) throw new Error(`Unknown player ${playerId}`);

  const previousBet = state.currentBet;
  let target = player.streetCommitted;
  let fullRaise = false;
  let shortAllIn = false;

  switch (command.type) {
    case "fold":
      if (!legal.fold) throw new Error("Fold is not legal");
      player.status = "folded";
      break;
    case "check":
      if (!legal.check) throw new Error("Check is not legal");
      break;
    case "call":
      if (!legal.call) throw new Error("Call is not legal");
      target = player.streetCommitted + legal.callAmount;
      break;
    case "bet":
      if (!legal.bet) throw new Error("Bet is not legal");
      target = requireTarget(command, legal.bet.min, legal.bet.max);
      break;
    case "raise":
      if (!legal.raise) throw new Error("Raise is not legal");
      target = requireTarget(command, legal.raise.minTo, legal.raise.maxTo);
      break;
    case "all-in":
      if (!legal.allIn) throw new Error("All-in is not legal");
      target = legal.allInTo;
      break;
    default:
      throw new Error("Unsupported betting action");
  }

  const committed = target - player.streetCommitted;
  if (committed < 0 || committed > player.stack) {
    throw new Error("Action commits an invalid chip amount");
  }

  player.stack -= committed;
  player.streetCommitted = target;
  player.totalCommitted += committed;

  if (target > previousBet) {
    const raiseIncrement = target - previousBet;
    const requiredIncrement =
      previousBet === 0 ? state.minimumBet : state.lastFullRaise;
    fullRaise = raiseIncrement >= requiredIncrement;
    shortAllIn = !fullRaise && command.type === "all-in";

    if (!fullRaise && command.type !== "all-in") {
      throw new Error("Only an all-in may be smaller than a full bet or raise");
    }

    state.currentBet = target;
    if (fullRaise) state.lastFullRaise = raiseIncrement;
    state.lastAggressorId = playerId;
  }

  if (player.stack === 0 && player.status === "active") {
    player.status = "all-in";
  }

  state.lastActedAtBet[playerId] = state.currentBet;
  recomputePending(state, playerId);
  assertBettingStateInvariant(state);

  return {
    state,
    event: {
      playerId,
      type: command.type,
      committed,
      to: target,
      previousBet,
      currentBet: state.currentBet,
      fullRaise,
      shortAllIn,
      allIn: player.status === "all-in",
    },
  };
}
