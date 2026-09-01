import type { Card, Street } from "../types/poker";
import {
  createSeededRandom,
  deriveSeed,
  hashSeed,
  type DeckSeed,
} from "./deck";

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  /**
   * Legacy read compatibility only. New tournament hands are blind-only and
   * never post this value, even when an imported schedule contains one.
   */
  bigBlindAnte?: number;
  durationMs: number;
}

export interface TournamentStructure {
  id: string;
  name: string;
  startingStack: number;
  maxSeats: number;
  levels: BlindLevel[];
  rated: boolean;
}

export type CareerTier =
  | "local"
  | "regional"
  | "circuit"
  | "championship"
  | "world";

export interface QualificationRule {
  type: "top-count" | "top-percent" | "win";
  value: number;
}

export interface CareerEventDefinition {
  id: string;
  name: string;
  tier: CareerTier;
  fieldSize: number;
  structure: TournamentStructure;
  prerequisites: string[];
  qualification: QualificationRule;
  unlocks: string[];
  ratingWeight: number;
}

export interface CareerEventResult {
  eventId: string;
  finishPlace: number;
  fieldSize: number;
}

export interface TournamentEntrant {
  id: string;
  name: string;
  rating?: number;
}

export interface TournamentPlayerState extends TournamentEntrant {
  stack: number;
  status: "active" | "eliminated";
  tableId?: string;
  seat?: number;
  finishPlace?: number;
}

export interface TournamentTableState {
  id: string;
  maxSeats: number;
  buttonSeat: number;
  handNumber: number;
  status: "playing" | "waiting" | "breaking";
}

export interface TournamentState {
  id: string;
  structure: TournamentStructure;
  players: TournamentPlayerState[];
  tables: TournamentTableState[];
  levelIndex: number;
  levelElapsedMs: number;
  totalElapsedMs: number;
  status: "registering" | "running" | "complete";
  handForHand: boolean;
  seedCommitment: string;
  breakingOrder: string[];
}

export interface TableMovePlan {
  playerId: string;
  fromTableId: string;
  toTableId: string;
  toSeat: number;
  reason: "balance";
}

export interface TableBreakPlan {
  tableId: string;
  moves: Array<Omit<TableMovePlan, "reason"> & { reason: "break" }>;
}

export interface EliminationRecord {
  playerId: string;
  handId: string;
  tableId: string;
  startedHandWith: number;
}

export interface HandActionRecord {
  playerId: string;
  type: string;
  amount?: number;
}

export interface HandInformationPlayer {
  id: string;
  name: string;
  seat: number;
  stack: number;
  status: "active" | "folded" | "all-in" | "out";
  streetCommitted: number;
  totalCommitted: number;
  holeCards: Card[];
  revealed?: boolean;
}

export interface HandInformationSource {
  handId: string;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  actingPlayerId?: string;
  buttonSeat: number;
  players: HandInformationPlayer[];
  actions: HandActionRecord[];
  /** Server-only fields that are intentionally omitted from projected views. */
  deck?: Card[];
  burnCards?: Card[];
  seed?: DeckSeed;
}

export interface PlayerInformationSet {
  handId: string;
  viewerId: string;
  street: Street;
  board: Card[];
  pot: number;
  currentBet: number;
  actingPlayerId?: string;
  buttonSeat: number;
  players: Array<Omit<HandInformationPlayer, "holeCards"> & { holeCards?: Card[] }>;
  actions: HandActionRecord[];
}

const MAIN_EVENT_BLINDS: ReadonlyArray<
  readonly [smallBlind: number, bigBlind: number]
> = [
  [100, 200],
  [200, 300],
  [200, 400],
  [300, 500],
  [300, 600],
  [400, 800],
  [500, 1_000],
  [600, 1_200],
  [1_000, 1_500],
  [1_000, 2_000],
  [1_000, 2_500],
  [1_500, 3_000],
  [2_000, 4_000],
  [3_000, 5_000],
  [3_000, 6_000],
  [4_000, 8_000],
  [5_000, 10_000],
  [6_000, 12_000],
  [10_000, 15_000],
  [10_000, 20_000],
  [10_000, 25_000],
  [15_000, 30_000],
  [20_000, 40_000],
  [25_000, 50_000],
  [30_000, 60_000],
  [40_000, 80_000],
  [50_000, 100_000],
  [60_000, 120_000],
  [100_000, 150_000],
  [100_000, 200_000],
  [125_000, 250_000],
  [150_000, 300_000],
  [200_000, 400_000],
  [250_000, 500_000],
  [300_000, 600_000],
  [400_000, 800_000],
  [500_000, 1_000_000],
  [600_000, 1_200_000],
  [800_000, 1_600_000],
  [1_000_000, 2_000_000],
  [1_250_000, 2_500_000],
  [1_500_000, 3_000_000],
  [2_000_000, 4_000_000],
  [2_500_000, 5_000_000],
  [3_000_000, 6_000_000],
  [4_000_000, 8_000_000],
  [5_000_000, 10_000_000],
] as const;

function makeMainEventLevels(durationMs: number): BlindLevel[] {
  return MAIN_EVENT_BLINDS.map(([smallBlind, bigBlind], index) => ({
    level: index + 1,
    smallBlind,
    bigBlind,
    bigBlindAnte: 0,
    durationMs,
  }));
}

export const AUTHENTIC_MAIN_EVENT_STRUCTURE: TournamentStructure = {
  id: "main-event-authentic",
  name: "World Championship — Authentic",
  startingStack: 60_000,
  maxSeats: 9,
  levels: makeMainEventLevels(120 * 60_000),
  rated: true,
};

export const CAREER_MAIN_EVENT_STRUCTURE: TournamentStructure = {
  id: "main-event-career",
  name: "World Championship — Career",
  startingStack: 60_000,
  maxSeats: 9,
  levels: makeMainEventLevels(8 * 60_000),
  rated: true,
};

export const QUICK_MAIN_EVENT_STRUCTURE: TournamentStructure = {
  id: "main-event-quick",
  name: "World Championship — Quick",
  startingStack: 60_000,
  maxSeats: 9,
  levels: makeMainEventLevels(3 * 60_000),
  rated: false,
};

function scaledStructure(
  id: string,
  name: string,
  startingStack: number,
  durationMinutes: number,
): TournamentStructure {
  const scale = startingStack / 60_000;
  return {
    id,
    name,
    startingStack,
    maxSeats: 9,
    rated: true,
    levels: MAIN_EVENT_BLINDS.slice(0, 24).map(
      ([smallBlind, bigBlind], index) => ({
        level: index + 1,
        smallBlind: Math.max(25, Math.round((smallBlind * scale) / 25) * 25),
        bigBlind: Math.max(50, Math.round((bigBlind * scale) / 25) * 25),
        bigBlindAnte: 0,
        durationMs: durationMinutes * 60_000,
      }),
    ),
  };
}

export const CAREER_EVENTS: readonly CareerEventDefinition[] = [
  {
    id: "local-qualifier",
    name: "Local Qualifier",
    tier: "local",
    fieldSize: 27,
    structure: scaledStructure(
      "local-qualifier-structure",
      "Local Qualifier",
      15_000,
      4,
    ),
    prerequisites: [],
    qualification: { type: "top-count", value: 9 },
    unlocks: ["regional-open"],
    ratingWeight: 0.75,
  },
  {
    id: "regional-open",
    name: "Regional Open",
    tier: "regional",
    fieldSize: 54,
    structure: scaledStructure(
      "regional-open-structure",
      "Regional Open",
      25_000,
      5,
    ),
    prerequisites: ["local-qualifier"],
    qualification: { type: "top-percent", value: 0.15 },
    unlocks: ["circuit-main"],
    ratingWeight: 0.9,
  },
  {
    id: "circuit-main",
    name: "Circuit Main Event",
    tier: "circuit",
    fieldSize: 90,
    structure: scaledStructure(
      "circuit-main-structure",
      "Circuit Main Event",
      40_000,
      6,
    ),
    prerequisites: ["regional-open"],
    qualification: { type: "top-count", value: 9 },
    unlocks: ["national-championship"],
    ratingWeight: 1,
  },
  {
    id: "national-championship",
    name: "National Championship",
    tier: "championship",
    fieldSize: 180,
    structure: CAREER_MAIN_EVENT_STRUCTURE,
    prerequisites: ["circuit-main"],
    qualification: { type: "top-percent", value: 0.05 },
    unlocks: ["world-championship"],
    ratingWeight: 1.15,
  },
  {
    id: "world-championship",
    name: "World Championship",
    tier: "world",
    fieldSize: 360,
    structure: CAREER_MAIN_EVENT_STRUCTURE,
    prerequisites: ["national-championship"],
    qualification: { type: "win", value: 1 },
    unlocks: [],
    ratingWeight: 1.25,
  },
] as const;

export function didQualify(
  rule: QualificationRule,
  finishPlace: number,
  fieldSize: number,
): boolean {
  if (
    !Number.isInteger(finishPlace) ||
    finishPlace < 1 ||
    !Number.isInteger(fieldSize) ||
    fieldSize < 1 ||
    finishPlace > fieldSize
  ) {
    throw new Error("Finish place and field size are invalid");
  }

  switch (rule.type) {
    case "win":
      return finishPlace === 1;
    case "top-count":
      return finishPlace <= Math.min(fieldSize, Math.floor(rule.value));
    case "top-percent":
      return finishPlace <= Math.max(1, Math.ceil(fieldSize * rule.value));
  }
}

export function getUnlockedCareerEventIds(
  results: readonly CareerEventResult[],
  events: readonly CareerEventDefinition[] = CAREER_EVENTS,
): string[] {
  const qualified = new Set(
    results
      .filter((result) => {
        const event = events.find((entry) => entry.id === result.eventId);
        return (
          event !== undefined &&
          didQualify(event.qualification, result.finishPlace, result.fieldSize)
        );
      })
      .map((result) => result.eventId),
  );

  return events
    .filter(
      (event) =>
        event.prerequisites.length === 0 ||
        event.prerequisites.every((id) => qualified.has(id)),
    )
    .map((event) => event.id);
}

export function currentBlindLevel(state: TournamentState): BlindLevel {
  return state.structure.levels[state.levelIndex];
}

export function advanceTournamentClock(
  source: TournamentState,
  elapsedMs: number,
): TournamentState {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error("Elapsed time must be non-negative");
  }
  const state: TournamentState = {
    ...source,
    players: source.players.map((player) => ({ ...player })),
    tables: source.tables.map((table) => ({ ...table })),
    levelElapsedMs: source.levelElapsedMs + elapsedMs,
    totalElapsedMs: source.totalElapsedMs + elapsedMs,
  };

  while (
    state.levelIndex < state.structure.levels.length - 1 &&
    state.levelElapsedMs >= currentBlindLevel(state).durationMs
  ) {
    state.levelElapsedMs -= currentBlindLevel(state).durationMs;
    state.levelIndex += 1;
  }

  return state;
}

function randomSeatOrder(count: number, seed: DeckSeed): number[] {
  return shuffleValues(
    Array.from({ length: count }, (_, index) => index),
    seed,
  );
}

function shuffleValues<T>(values: readonly T[], seed: DeckSeed): T[] {
  const random = createSeededRandom(seed);
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [
      output[swapIndex],
      output[index],
    ];
  }
  return output;
}

export function createTournament(
  id: string,
  structure: TournamentStructure,
  entrants: readonly TournamentEntrant[],
  seed: DeckSeed,
): TournamentState {
  if (entrants.length < 2) throw new Error("A tournament needs at least two entrants");
  if (new Set(entrants.map((entrant) => entrant.id)).size !== entrants.length) {
    throw new Error("Tournament entrant IDs must be unique");
  }
  if (structure.levels.length === 0) {
    throw new Error("Tournament structure requires at least one blind level");
  }

  const tableCount = Math.ceil(entrants.length / structure.maxSeats);
  const tables: TournamentTableState[] = Array.from(
    { length: tableCount },
    (_, index) => ({
      id: `table-${index + 1}`,
      maxSeats: structure.maxSeats,
      buttonSeat: 1,
      handNumber: 0,
      status: "playing",
    }),
  );
  const shuffledEntrants = shuffleValues(
    entrants,
    deriveSeed(seed, "seating"),
  );
  const seatOrders = Object.fromEntries(
    tables.map((table) => [
      table.id,
      randomSeatOrder(
        structure.maxSeats,
        deriveSeed(seed, table.id, "seats"),
      ).map((seat) => seat + 1),
    ]),
  ) as Record<string, number[]>;
  const players: TournamentPlayerState[] = shuffledEntrants.map(
    (entrant, index) => {
      const table = tables[index % tables.length];
      const tableIndex = Math.floor(index / tables.length);
      return {
        ...entrant,
        stack: structure.startingStack,
        status: "active",
        tableId: table.id,
        seat: seatOrders[table.id][tableIndex],
      };
    },
  );

  return {
    id,
    structure,
    players,
    tables,
    levelIndex: 0,
    levelElapsedMs: 0,
    totalElapsedMs: 0,
    status: "running",
    handForHand: false,
    seedCommitment: hashSeed(seed).toString(16).padStart(8, "0"),
    breakingOrder: tables.map((table) => table.id).reverse(),
  };
}

function tournamentActivePlayersAtTable(
  state: TournamentState,
  tableId: string,
): TournamentPlayerState[] {
  return state.players.filter(
    (player) => player.status === "active" && player.tableId === tableId,
  );
}

function nextSeatClockwise(
  occupied: readonly number[],
  fromSeat: number,
  tableSize: number,
): number {
  for (let distance = 1; distance <= tableSize; distance += 1) {
    const seat = ((fromSeat - 1 + distance) % tableSize) + 1;
    if (occupied.includes(seat)) return seat;
  }
  throw new Error("No occupied seat is available");
}

function nextBigBlindPlayer(
  state: TournamentState,
  table: TournamentTableState,
): TournamentPlayerState {
  const players = tournamentActivePlayersAtTable(state, table.id);
  if (players.length < 2) throw new Error("Cannot find a big blind at a broken table");
  const occupied = players.map((player) => player.seat as number);

  if (players.length === 2) {
    const nextButton = nextSeatClockwise(
      occupied,
      table.buttonSeat,
      table.maxSeats,
    );
    const bigBlind = nextSeatClockwise(occupied, nextButton, table.maxSeats);
    return players.find((player) => player.seat === bigBlind) as TournamentPlayerState;
  }

  const nextButton = nextSeatClockwise(
    occupied,
    table.buttonSeat,
    table.maxSeats,
  );
  const nextSmallBlind = nextSeatClockwise(
    occupied,
    nextButton,
    table.maxSeats,
  );
  const nextBigBlind = nextSeatClockwise(
    occupied,
    nextSmallBlind,
    table.maxSeats,
  );
  return players.find(
    (player) => player.seat === nextBigBlind,
  ) as TournamentPlayerState;
}

function chooseWorstOpenSeat(
  state: TournamentState,
  table: TournamentTableState,
): number {
  const occupied = tournamentActivePlayersAtTable(state, table.id).map(
    (player) => player.seat as number,
  );
  const open = Array.from({ length: table.maxSeats }, (_, index) => index + 1).filter(
    (seat) => !occupied.includes(seat),
  );
  if (open.length === 0) throw new Error(`Table ${table.id} has no open seat`);

  const scored = open
    .map((candidate) => {
      const withCandidate = [...occupied, candidate];
      const nextButton = nextSeatClockwise(
        withCandidate,
        table.buttonSeat,
        table.maxSeats,
      );
      const nextSmallBlind =
        withCandidate.length === 2
          ? nextButton
          : nextSeatClockwise(
              withCandidate,
              nextButton,
              table.maxSeats,
            );
      const nextBigBlind = nextSeatClockwise(
        withCandidate,
        nextSmallBlind,
        table.maxSeats,
      );
      const distance = (candidate - nextButton + table.maxSeats) % table.maxSeats;
      return {
        candidate,
        prohibited: candidate === nextSmallBlind,
        score: candidate === nextBigBlind ? -1 : distance,
      };
    })
    .filter((entry) => !entry.prohibited)
    .sort((left, right) => left.score - right.score || left.candidate - right.candidate);

  if (scored.length === 0) {
    throw new Error("No legal balance seat is available outside the small blind");
  }
  return scored[0].candidate;
}

export function planTableBalance(
  state: TournamentState,
): TableMovePlan | null {
  const playing = state.tables.filter((table) => table.status === "playing");
  if (playing.length < 2) return null;
  const ranked = playing
    .map((table) => ({
      table,
      count: tournamentActivePlayersAtTable(state, table.id).length,
    }))
    .sort(
      (left, right) =>
        left.count - right.count || left.table.id.localeCompare(right.table.id),
    );
  const shortest = ranked[0];
  const fullest = ranked[ranked.length - 1];
  const allowedDifference = playing.length <= 12 ? 1 : 2;
  if (fullest.count - shortest.count <= allowedDifference) return null;

  const player = nextBigBlindPlayer(state, fullest.table);
  return {
    playerId: player.id,
    fromTableId: fullest.table.id,
    toTableId: shortest.table.id,
    toSeat: chooseWorstOpenSeat(state, shortest.table),
    reason: "balance",
  };
}

export function applyTableMove(
  source: TournamentState,
  move: Pick<TableMovePlan, "playerId" | "fromTableId" | "toTableId" | "toSeat">,
): TournamentState {
  const state: TournamentState = {
    ...source,
    players: source.players.map((player) => ({ ...player })),
    tables: source.tables.map((table) => ({ ...table })),
  };
  const player = state.players.find((entry) => entry.id === move.playerId);
  const target = state.tables.find((table) => table.id === move.toTableId);
  if (
    !player ||
    player.status !== "active" ||
    player.tableId !== move.fromTableId ||
    !target
  ) {
    throw new Error("Invalid table move");
  }
  if (
    tournamentActivePlayersAtTable(state, move.toTableId).some(
      (entry) => entry.seat === move.toSeat,
    )
  ) {
    throw new Error("Destination seat is occupied");
  }

  player.tableId = move.toTableId;
  player.seat = move.toSeat;
  return state;
}

export function planTableBreak(state: TournamentState): TableBreakPlan | null {
  const tournamentActivePlayers = state.players.filter(
    (player) => player.status === "active",
  );
  const playingTables = state.tables.filter((table) => table.status === "playing");
  if (playingTables.length <= 1) return null;
  const capacityWithoutOne =
    (playingTables.length - 1) * state.structure.maxSeats;
  if (tournamentActivePlayers.length > capacityWithoutOne) return null;

  const tableId =
    state.breakingOrder.find((candidate) =>
      playingTables.some((table) => table.id === candidate),
    ) ?? playingTables[playingTables.length - 1].id;
  const leaving = tournamentActivePlayersAtTable(state, tableId).sort(
    (left, right) => (left.seat as number) - (right.seat as number),
  );
  const destinations = playingTables.filter((table) => table.id !== tableId);
  const reserved = new Map<string, Set<number>>();
  const moves: TableBreakPlan["moves"] = [];

  for (const player of leaving) {
    const target = destinations
      .map((table) => ({
        table,
        count:
          tournamentActivePlayersAtTable(state, table.id).length +
          (reserved.get(table.id)?.size ?? 0),
      }))
      .sort(
        (left, right) =>
          left.count - right.count || left.table.id.localeCompare(right.table.id),
      )[0].table;
    const occupied = new Set([
      ...tournamentActivePlayersAtTable(state, target.id).map(
        (entry) => entry.seat as number,
      ),
      ...(reserved.get(target.id) ?? []),
    ]);
    const seat = Array.from(
      { length: target.maxSeats },
      (_, index) => index + 1,
    ).find((candidate) => !occupied.has(candidate));
    if (seat === undefined) throw new Error("Insufficient capacity to break table");
    if (!reserved.has(target.id)) reserved.set(target.id, new Set());
    reserved.get(target.id)?.add(seat);
    moves.push({
      playerId: player.id,
      fromTableId: tableId,
      toTableId: target.id,
      toSeat: seat,
      reason: "break",
    });
  }

  return { tableId, moves };
}

export function recordEliminations(
  source: TournamentState,
  records: readonly EliminationRecord[],
): TournamentState {
  if (records.length === 0) return source;
  if (new Set(records.map((record) => record.playerId)).size !== records.length) {
    throw new Error("A player may be eliminated only once per transition");
  }
  for (const record of records) {
    if (
      !Number.isSafeInteger(record.startedHandWith) ||
      record.startedHandWith < 0
    ) {
      throw new Error("Starting stack for an elimination must be valid");
    }
    const player = source.players.find((entry) => entry.id === record.playerId);
    if (
      !player ||
      player.status !== "active" ||
      player.tableId !== record.tableId
    ) {
      throw new Error(`Invalid elimination record for ${record.playerId}`);
    }
  }

  const activeBefore = source.players.filter(
    (player) => player.status === "active",
  ).length;
  const bestPlace = activeBefore - records.length + 1;
  // During hand-for-hand play the director submits one completed synchronized
  // round as a transition. Hand IDs are table-local, so equality across tables
  // is neither expected nor a valid synchronization signal.
  const sameSynchronizedHand = source.handForHand;
  const sameTableAndHand = records.every(
    (record) =>
      record.handId === records[0].handId &&
      record.tableId === records[0].tableId,
  );
  const places = new Map<string, number>();

  if (sameTableAndHand) {
    [...records]
      .sort(
        (left, right) =>
          right.startedHandWith - left.startedHandWith ||
          left.playerId.localeCompare(right.playerId),
      )
      .forEach((record, index) => {
        const previous = records.find(
          (candidate) =>
            candidate.playerId !== record.playerId &&
            candidate.startedHandWith === record.startedHandWith,
        );
        const tiedPlace =
          previous === undefined ? undefined : places.get(previous.playerId);
        places.set(record.playerId, tiedPlace ?? bestPlace + index);
      });
  } else if (sameSynchronizedHand) {
    for (const record of records) places.set(record.playerId, bestPlace);
  } else {
    [...records]
      .sort(
        (left, right) =>
          left.handId.localeCompare(right.handId) ||
          left.tableId.localeCompare(right.tableId) ||
          left.playerId.localeCompare(right.playerId),
      )
      .forEach((record, index) => {
      places.set(record.playerId, bestPlace + index);
      });
  }

  const state: TournamentState = {
    ...source,
    players: source.players.map((player) => {
      const place = places.get(player.id);
      return place === undefined
        ? { ...player }
        : {
            ...player,
            stack: 0,
            status: "eliminated" as const,
            finishPlace: place,
          };
    }),
    tables: source.tables.map((table) => ({ ...table })),
  };
  const tournamentPlayersRemaining = state.players.filter(
    (player) => player.status === "active",
  );
  if (tournamentPlayersRemaining.length === 1) {
    const winner = tournamentPlayersRemaining[0];
    winner.finishPlace = 1;
    state.status = "complete";
  }
  return state;
}

export function createInformationSet(
  source: HandInformationSource,
  viewerId: string,
): PlayerInformationSet {
  if (!source.players.some((player) => player.id === viewerId)) {
    throw new Error(`Viewer ${viewerId} is not seated in this hand`);
  }

  return {
    handId: source.handId,
    viewerId,
    street: source.street,
    board: source.board.map((card) => ({ ...card })),
    pot: source.pot,
    currentBet: source.currentBet,
    actingPlayerId: source.actingPlayerId,
    buttonSeat: source.buttonSeat,
    players: source.players.map(({ holeCards, ...player }) => ({
      ...player,
      ...(player.id === viewerId || player.revealed
        ? { holeCards: holeCards.map((card) => ({ ...card })) }
        : {}),
    })),
    actions: source.actions.map((action) => ({ ...action })),
  };
}
