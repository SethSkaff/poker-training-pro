import {
  CAREER_EVENTS,
  advanceTournamentClock,
  applyBettingAction,
  buildLivePots,
  buildPots,
  createBettingRound,
  createInformationSet,
  createSeededRandom,
  createShuffledDeck,
  createTournament,
  currentBlindLevel,
  dealRoundRobin,
  deriveSeed,
  drawCards,
  getLegalActions,
  nextToAct,
  recordEliminations,
  resolvePots,
  type BettingActionCommand,
  type BettingRoundState,
  type BlindLevel,
  type CareerEventDefinition,
  type CareerTier,
  type ContestablePot,
  type DeckSeed,
  type HandActionRecord,
  type HandInformationPlayer,
  type HandInformationSource,
  type LegalActionSet,
  type PlayerInformationSet,
  type PotAward,
  type TournamentEntrant,
  type TournamentState,
  type TournamentStructure,
} from "../engine";
import type {
  Card,
  GameMode,
  PokerAction,
  SeatPlayer,
  Street,
  TrainingScenario,
} from "../types/poker";
import { formatMessage } from "../lib/localeMessages";
import {
  NORMAL_OPPONENT_PROFILES,
  decideNormalAction,
  type NormalActionEvaluation,
  type NormalDecision,
} from "./normal";
import {
  decideRationalAction,
  decideRationalActionAsync,
  type EquityEstimator,
  type RationalActionRole,
  type RationalDecision,
  type RationalPolicyInput,
  type RationalTournamentContext,
} from "./rational";

export const SESSION_TABLE_SIZE = 6;
export const SESSION_FORMAT = "compressed-six-seat" as const;

export type TournamentPolicyMode = Extract<GameMode, "normal" | "rational">;
export type NormalProfileKey = keyof typeof NORMAL_OPPONENT_PROFILES;

export interface TournamentSessionCareerResult {
  eventId: string;
  finishPlace: number;
  fieldSize: typeof SESSION_TABLE_SIZE;
  sourceFieldSize: number;
  qualifyingPlaces: number;
  qualified: boolean;
  tournamentEloDelta: number;
}

export interface TournamentSessionEvent {
  id: string;
  name: string;
  tier: CareerTier;
  sourceFieldSize: number;
  sessionFieldSize: typeof SESSION_TABLE_SIZE;
  qualifyingPlaces: number;
  qualificationLabel: string;
  structure: TournamentStructure;
  prerequisites: string[];
  ratingWeight: number;
  unlocked: boolean;
  format: typeof SESSION_FORMAT;
  disclosure: string;
}

export interface TournamentSessionEntrant extends TournamentEntrant {
  rating: number;
  normalProfile?: NormalProfileKey;
}

export interface CreateTournamentSessionOptions {
  eventId: string;
  hero: TournamentSessionEntrant;
  mode: TournamentPolicyMode;
  seed: DeckSeed;
  careerResults?: readonly TournamentSessionCareerResult[];
  opponents?: readonly TournamentSessionEntrant[];
}

export interface SessionHandState {
  handId: string;
  street: Street;
  deck: Card[];
  deckCursor: number;
  board: Card[];
  holeCards: Record<string, Card[]>;
  startingStacks: Record<string, number>;
  buttonSeat: number;
  smallBlindPlayerId: string;
  bigBlindPlayerId: string;
  betting: BettingRoundState;
  information: HandInformationSource;
}

export interface SessionHandResult {
  handId: string;
  board: Card[];
  pots: ContestablePot[];
  awards: PotAward[];
  eliminatedPlayerIds: string[];
}

export interface PairwiseEloEntry {
  opponentId: string;
  opponentRating: number;
  expectedScore: number;
  actualScore: 0 | 0.5 | 1;
  delta: number;
}

export interface PairwiseTournamentElo {
  heroId: string;
  heroRating: number;
  kFactor: number;
  ratingWeight: number;
  entries: PairwiseEloEntry[];
  totalDelta: number;
}

export interface TournamentSessionResult
  extends TournamentSessionCareerResult {
  heroId: string;
  eventName: string;
  handNumber: number;
  elo: PairwiseTournamentElo;
  placementLabel: string;
  qualificationLabel: string;
  unlockedEventIds: string[];
  newlyUnlockedEventIds: string[];
  nextEventId?: string;
}

export interface TournamentSession {
  id: string;
  format: typeof SESSION_FORMAT;
  mode: TournamentPolicyMode;
  seed: DeckSeed;
  event: TournamentSessionEvent;
  heroId: string;
  entrants: TournamentSessionEntrant[];
  tournament: TournamentState;
  careerResults: TournamentSessionCareerResult[];
  activeHand?: SessionHandState;
  lastHand?: SessionHandResult;
  result?: TournamentSessionResult;
  status: "playing" | "complete";
}

export type SessionPolicyDecision =
  | {
      mode: "rational";
      command: BettingActionCommand;
      rational: RationalDecision;
    }
  | {
      mode: "normal";
      command: BettingActionCommand;
      normal: NormalDecision;
      rationalBaseline: RationalDecision;
    };

export interface SessionPolicyOptions {
  simulations?: number;
  temperature?: number;
}

/**
 * Names are composed from independent given/family parts rather than a fixed
 * list, so the identity pool is large enough that a career does not cycle back
 * to the same five faces. Both lists are deliberately mixed in origin and
 * carry no gender or nationality signal that the appearance derivation could
 * pick up — appearance is keyed to the resulting id and nothing else.
 */
const GIVEN_NAMES = [
  "Alex", "Blair", "Casey", "Devon", "Emery", "Frankie",
  "Gale", "Harper", "Indigo", "Jordan", "Kai", "Lennon",
  "Marlow", "Noor", "Onyx", "Paz", "Quinn", "Rio",
  "Sasha", "Tam", "Umi", "Vesper", "Wren", "Zuri",
] as const;

const FAMILY_NAMES = [
  "Moreno", "Woods", "Park", "Ellis", "Ross", "Vale",
  "Hart", "Stone", "Kim", "Reed", "Santos", "Frost",
  "Abara", "Batista", "Calder", "Duarte", "Eriksen", "Fenwick",
  "Ghosh", "Halloran", "Ibarra", "Jansen", "Kovač", "Laurent",
] as const;

const ROSTER_PROFILES = Object.keys(NORMAL_OPPONENT_PROFILES) as NormalProfileKey[];

/**
 * Rating band per tier. Higher tiers field measurably stronger opponents, so
 * a championship table reads as a different competition rather than the local
 * qualifier with new signage.
 */
const TIER_RATING_BANDS: Record<CareerTier, { floor: number; spread: number }> = {
  local: { floor: 1_000, spread: 90 },
  regional: { floor: 1_060, spread: 110 },
  circuit: { floor: 1_130, spread: 130 },
  championship: { floor: 1_210, spread: 150 },
  world: { floor: 1_300, spread: 180 },
};

export interface CreateSessionOpponentsOptions {
  tier?: CareerTier;
  /**
   * Identities to push to the back of the draw. Deliberately **not** wired to
   * "the field from the player's previous event": replay reconstruction
   * regenerates the roster from `seed + eventId + mode` alone
   * (`restoreTournamentRunnerReplay`), so an avoid-list derived from live
   * session state would have to be persisted in the replay envelope and pass
   * the export allowlist to keep reconstruction faithful. Measurement showed
   * that cost buys nothing: over 2,000 consecutive-event pairs the generated
   * field never repeated identically and only 4.3% shared even one opponent
   * (mean overlap 0.043 of five seats). The pool size already delivers the
   * "no immediate repeat" guarantee, so the hook stays available for a caller
   * that can supply it deterministically and is unused in production.
   */
  avoidIds?: readonly string[];
}

/**
 * Public, seed-derived entrants. Names/profiles/rating are replay data; visual
 * appearance is derived separately from the resulting id in PokerTable, which
 * is what keeps appearance uncorrelated with playing behavior.
 */
export function createSessionOpponents(
  seed: DeckSeed,
  eventId: string,
  mode: TournamentPolicyMode,
  options: CreateSessionOpponentsOptions = {},
): TournamentSessionEntrant[] {
  const random = createSeededRandom(deriveSeed(seed, eventId, mode, "roster"));
  const identities: { id: string; name: string }[] = [];
  const takenIds = new Set<string>();
  const takenGiven = new Set<string>();
  const takenFamily = new Set<string>();

  // Draw distinct given/family parts so no two seats share a first or last
  // name, which is what actually makes a table read as six different people.
  // More candidates than seats are drawn so the repeat filter below has real
  // alternatives to choose from rather than only a reordering.
  const seats = SESSION_TABLE_SIZE - 1;
  let guard = 0;
  while (identities.length < seats * 3 && guard < 800) {
    guard += 1;
    const given = GIVEN_NAMES[Math.floor(random() * GIVEN_NAMES.length)];
    const family = FAMILY_NAMES[Math.floor(random() * FAMILY_NAMES.length)];
    if (takenGiven.has(given) || takenFamily.has(family)) continue;
    const id = `${given}-${family}`.toLowerCase();
    if (takenIds.has(id)) continue;
    takenGiven.add(given);
    takenFamily.add(family);
    takenIds.add(id);
    identities.push({ id, name: `${given} ${family}` });
  }

  const avoid = new Set(options.avoidIds ?? []);
  const seated = [
    ...identities.filter((identity) => !avoid.has(identity.id)),
    ...identities.filter((identity) => avoid.has(identity.id)),
  ].slice(0, seats);

  const band = TIER_RATING_BANDS[options.tier ?? "local"];
  return seated.map(({ id, name }) => ({
    id,
    name,
    rating: band.floor + Math.floor(random() * band.spread),
    normalProfile: ROSTER_PROFILES[Math.floor(random() * ROSTER_PROFILES.length)],
  }));
}

function sourceQualificationRate(event: CareerEventDefinition): number {
  switch (event.qualification.type) {
    case "win":
      return 1 / event.fieldSize;
    case "top-count":
      return Math.min(1, event.qualification.value / event.fieldSize);
    case "top-percent":
      return Math.min(1, event.qualification.value);
  }
}

function compressedQualifyingPlaces(event: CareerEventDefinition): number {
  if (event.qualification.type === "win") return 1;
  return Math.max(
    1,
    Math.min(
      SESSION_TABLE_SIZE,
      Math.ceil(sourceQualificationRate(event) * SESSION_TABLE_SIZE),
    ),
  );
}

function compressedStructure(event: CareerEventDefinition): TournamentStructure {
  return {
    ...event.structure,
    id: `${event.structure.id}-six-seat`,
    name: `${event.structure.name} — Six-Seat Career`,
    maxSeats: SESSION_TABLE_SIZE,
    levels: event.structure.levels.map((level) => ({ ...level })),
  };
}

function qualificationLabel(
  event: CareerEventDefinition,
  qualifyingPlaces: number,
): string {
  if (event.qualification.type === "win") {
    return formatMessage("career.qualification.winFinal");
  }
  return formatMessage("career.qualification.topFinish", {
    places: qualifyingPlaces,
    total: SESSION_TABLE_SIZE,
  });
}

function qualifiedEventIds(
  results: readonly TournamentSessionCareerResult[],
): Set<string> {
  return new Set(
    results.filter((result) => result.qualified).map((result) => result.eventId),
  );
}

/**
 * Lists the five career events while honestly disclosing that the local build
 * compresses the published field into a six-seat tournament. Qualification
 * ratios are scaled from the source event instead of reusing source counts.
 */
export function listTournamentSessionEvents(
  careerResults: readonly TournamentSessionCareerResult[] = [],
): TournamentSessionEvent[] {
  const qualified = qualifiedEventIds(careerResults);
  return CAREER_EVENTS.map((event) => {
    const qualifyingPlaces = compressedQualifyingPlaces(event);
    return {
      id: event.id,
      name: formatMessage(`career.event.${event.id}`),
      tier: event.tier,
      sourceFieldSize: event.fieldSize,
      sessionFieldSize: SESSION_TABLE_SIZE,
      qualifyingPlaces,
      qualificationLabel: qualificationLabel(event, qualifyingPlaces),
      structure: compressedStructure(event),
      prerequisites: [...event.prerequisites],
      ratingWeight: event.ratingWeight,
      unlocked:
        event.prerequisites.length === 0 ||
        event.prerequisites.every((id) => qualified.has(id)),
      format: SESSION_FORMAT,
      disclosure:
        `Compressed local six-seat simulation of a ${event.fieldSize}-entry career event; ` +
        "blind amounts and level ratios come from the published career structure.",
    };
  });
}

function assertEntrants(
  hero: TournamentSessionEntrant,
  opponents: readonly TournamentSessionEntrant[],
): TournamentSessionEntrant[] {
  if (opponents.length !== SESSION_TABLE_SIZE - 1) {
    throw new Error("A six-seat session requires exactly five opponents");
  }
  const entrants = [hero, ...opponents].map((entrant) => ({ ...entrant }));
  if (new Set(entrants.map((entrant) => entrant.id)).size !== entrants.length) {
    throw new Error("Session entrant IDs must be unique");
  }
  for (const entrant of entrants) {
    if (
      !Number.isFinite(entrant.rating) ||
      entrant.rating < 100 ||
      entrant.rating > 4_000
    ) {
      throw new Error(`Invalid tournament rating for ${entrant.id}`);
    }
  }
  return entrants;
}

export function createTournamentSession(
  options: CreateTournamentSessionOptions,
): TournamentSession {
  const careerResults = (options.careerResults ?? []).map((result) => ({
    ...result,
  }));
  const event = listTournamentSessionEvents(careerResults).find(
    (entry) => entry.id === options.eventId,
  );
  if (!event) throw new Error(`Unknown career event ${options.eventId}`);
  if (!event.unlocked) {
    throw new Error(`Career event ${options.eventId} is still locked`);
  }

  const entrants = assertEntrants(
    options.hero,
    options.opponents ??
      createSessionOpponents(options.seed, options.eventId, options.mode, {
        tier: event.tier,
      }),
  );
  const tournament = createTournament(
    `${options.eventId}-session`,
    event.structure,
    entrants,
    deriveSeed(options.seed, options.eventId, "tournament"),
  );

  return {
    id: `${options.eventId}:${String(options.seed)}`,
    format: SESSION_FORMAT,
    mode: options.mode,
    seed: options.seed,
    event,
    heroId: options.hero.id,
    entrants,
    tournament,
    careerResults,
    status: "playing",
  };
}

function tableForSession(session: TournamentSession) {
  const table = session.tournament.tables[0];
  if (!table) throw new Error("Session table is missing");
  return table;
}

function activePlayers(session: TournamentSession) {
  return session.tournament.players
    .filter((player) => player.status === "active")
    .sort((left, right) => (left.seat as number) - (right.seat as number));
}

function nextOccupiedSeat(
  occupiedSeats: readonly number[],
  afterSeat: number,
): number {
  for (let distance = 1; distance <= SESSION_TABLE_SIZE; distance += 1) {
    const seat = ((afterSeat - 1 + distance) % SESSION_TABLE_SIZE) + 1;
    if (occupiedSeats.includes(seat)) return seat;
  }
  throw new Error("No occupied seat is available");
}

function clockwisePlayersAfter(
  players: ReturnType<typeof activePlayers>,
  afterSeat: number,
) {
  return [...players].sort((left, right) => {
    const leftDistance =
      ((left.seat as number) - afterSeat + SESSION_TABLE_SIZE) %
      SESSION_TABLE_SIZE;
    const rightDistance =
      ((right.seat as number) - afterSeat + SESSION_TABLE_SIZE) %
      SESSION_TABLE_SIZE;
    const normalizedLeft =
      leftDistance === 0 ? SESSION_TABLE_SIZE : leftDistance;
    const normalizedRight =
      rightDistance === 0 ? SESSION_TABLE_SIZE : rightDistance;
    return normalizedLeft - normalizedRight;
  });
}

function cloneTournament(state: TournamentState): TournamentState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    tables: state.tables.map((table) => ({ ...table })),
    breakingOrder: [...state.breakingOrder],
  };
}

function postForced(
  stacks: Map<string, number>,
  totalCommitted: Map<string, number>,
  streetCommitted: Map<string, number>,
  playerId: string,
  amount: number,
  countsTowardStreet: boolean,
): number {
  const posted = Math.min(stacks.get(playerId) ?? 0, amount);
  stacks.set(playerId, (stacks.get(playerId) ?? 0) - posted);
  totalCommitted.set(
    playerId,
    (totalCommitted.get(playerId) ?? 0) + posted,
  );
  if (countsTowardStreet) {
    streetCommitted.set(
      playerId,
      (streetCommitted.get(playerId) ?? 0) + posted,
    );
  }
  return posted;
}

function informationPlayers(
  players: ReturnType<typeof activePlayers>,
  betting: BettingRoundState,
  holeCards: Readonly<Record<string, readonly Card[]>>,
): HandInformationPlayer[] {
  return players.map((player) => {
    const bettingPlayer = betting.players.find((entry) => entry.id === player.id);
    if (!bettingPlayer) throw new Error(`Missing betting state for ${player.id}`);
    return {
      id: player.id,
      name: player.name,
      seat: player.seat as number,
      stack: bettingPlayer.stack,
      status: bettingPlayer.status,
      streetCommitted: bettingPlayer.streetCommitted,
      totalCommitted: bettingPlayer.totalCommitted,
      holeCards: holeCards[player.id].map((card) => ({ ...card })),
    };
  });
}

function sumCommitted(players: readonly HandInformationPlayer[]): number {
  return players.reduce((sum, player) => sum + player.totalCommitted, 0);
}

/**
 * Starts the next deterministic hand and posts only the blinds. Legacy blind
 * schedules may still carry an ante field, but it is intentionally ignored.
 * creates a core betting round. The first hand and every later hand advance
 * the button clockwise to the next live seat.
 */
export function beginTournamentSessionHand(
  source: TournamentSession,
): TournamentSession {
  if (source.status !== "playing" || source.result) {
    throw new Error("Cannot start a hand in a completed session");
  }
  if (source.activeHand) throw new Error("The current hand is not complete");
  const players = activePlayers(source);
  if (players.length < 2) throw new Error("A hand requires two active players");

  const tournament = cloneTournament(source.tournament);
  const table = tournament.tables[0];
  const occupied = players.map((player) => player.seat as number);
  table.buttonSeat = nextOccupiedSeat(occupied, table.buttonSeat);
  table.handNumber += 1;

  const buttonSeat = table.buttonSeat;
  const smallBlindSeat =
    players.length === 2
      ? buttonSeat
      : nextOccupiedSeat(occupied, buttonSeat);
  const bigBlindSeat = nextOccupiedSeat(occupied, smallBlindSeat);
  const smallBlindPlayer = players.find(
    (player) => player.seat === smallBlindSeat,
  );
  const bigBlindPlayer = players.find((player) => player.seat === bigBlindSeat);
  if (!smallBlindPlayer || !bigBlindPlayer) {
    throw new Error("Unable to assign the session blinds");
  }

  const handId = `${source.id}:hand-${table.handNumber}`;
  const deck = createShuffledDeck(
    deriveSeed(source.seed, source.event.id, handId, "deck"),
  );
  const dealOrder = clockwisePlayersAfter(players, buttonSeat).map(
    (player) => player.id,
  );
  const dealt = dealRoundRobin(deck, 0, dealOrder, 2);
  const level = currentBlindLevel(tournament);
  const stacks = new Map(players.map((player) => [player.id, player.stack]));
  const totalCommitted = new Map(players.map((player) => [player.id, 0]));
  const streetCommitted = new Map(players.map((player) => [player.id, 0]));
  const forcedActions: HandActionRecord[] = [];

  const smallBlind = postForced(
    stacks,
    totalCommitted,
    streetCommitted,
    smallBlindPlayer.id,
    level.smallBlind,
    true,
  );
  forcedActions.push({
    playerId: smallBlindPlayer.id,
    type: "small-blind",
    amount: smallBlind,
  });
  const bigBlind = postForced(
    stacks,
    totalCommitted,
    streetCommitted,
    bigBlindPlayer.id,
    level.bigBlind,
    true,
  );
  forcedActions.push({
    playerId: bigBlindPlayer.id,
    type: "big-blind",
    amount: bigBlind,
  });

  const preflopOrder = clockwisePlayersAfter(players, bigBlindSeat).map(
    (player) => player.id,
  );
  const betting = createBettingRound(
    players.map((player) => ({
      id: player.id,
      stack: stacks.get(player.id) as number,
      streetCommitted: streetCommitted.get(player.id) as number,
      totalCommitted: totalCommitted.get(player.id) as number,
      status:
        (stacks.get(player.id) as number) === 0
          ? ("all-in" as const)
          : ("active" as const),
    })),
    preflopOrder,
    {
      minimumBet: level.bigBlind,
      nominalOpeningBet: level.bigBlind,
      lastFullRaise: level.bigBlind,
    },
  );

  for (const tournamentPlayer of tournament.players) {
    if (stacks.has(tournamentPlayer.id)) {
      tournamentPlayer.stack = stacks.get(tournamentPlayer.id) as number;
    }
  }
  const infoPlayers = informationPlayers(players, betting, dealt.hands);
  const information: HandInformationSource = {
    handId,
    street: "preflop",
    board: [],
    pot: sumCommitted(infoPlayers),
    currentBet: betting.currentBet,
    actingPlayerId: nextToAct(betting) ?? undefined,
    buttonSeat,
    players: infoPlayers,
    actions: forcedActions,
  };

  return {
    ...source,
    tournament,
    activeHand: {
      handId,
      street: "preflop",
      deck,
      deckCursor: dealt.cursor,
      board: [],
      holeCards: Object.fromEntries(
        Object.entries(dealt.hands).map(([id, cards]) => [
          id,
          cards.map((card) => ({ ...card })),
        ]),
      ),
      startingStacks: Object.fromEntries(
        players.map((player) => [player.id, player.stack]),
      ),
      buttonSeat,
      smallBlindPlayerId: smallBlindPlayer.id,
      bigBlindPlayerId: bigBlindPlayer.id,
      betting,
      information,
    },
    lastHand: undefined,
  };
}

function syncTournamentStacks(
  tournament: TournamentState,
  betting: BettingRoundState,
): TournamentState {
  return {
    ...tournament,
    players: tournament.players.map((player) => {
      const bettingPlayer = betting.players.find(
        (entry) => entry.id === player.id,
      );
      return bettingPlayer ? { ...player, stack: bettingPlayer.stack } : { ...player };
    }),
    tables: tournament.tables.map((table) => ({ ...table })),
    breakingOrder: [...tournament.breakingOrder],
  };
}

function syncHandInformation(
  hand: SessionHandState,
  betting: BettingRoundState,
  actions: readonly HandActionRecord[],
): HandInformationSource {
  const players = hand.information.players.map((player) => {
    const bettingPlayer = betting.players.find((entry) => entry.id === player.id);
    if (!bettingPlayer) throw new Error(`Missing betting player ${player.id}`);
    return {
      ...player,
      stack: bettingPlayer.stack,
      status: bettingPlayer.status,
      streetCommitted: bettingPlayer.streetCommitted,
      totalCommitted: bettingPlayer.totalCommitted,
      holeCards: player.holeCards.map((card) => ({ ...card })),
    };
  });
  return {
    ...hand.information,
    board: hand.board.map((card) => ({ ...card })),
    pot: sumCommitted(players),
    currentBet: betting.currentBet,
    actingPlayerId: nextToAct(betting) ?? undefined,
    players,
    actions: actions.map((action) => ({ ...action })),
  };
}

export function applyTournamentSessionAction(
  source: TournamentSession,
  playerId: string,
  command: BettingActionCommand,
): TournamentSession {
  const hand = source.activeHand;
  if (!hand) throw new Error("No active session hand");
  const result = applyBettingAction(hand.betting, playerId, command);
  const actions = [
    ...hand.information.actions,
    {
      playerId,
      type: result.event.type,
      amount: result.event.to,
    },
  ];
  const nextHand: SessionHandState = {
    ...hand,
    betting: result.state,
    information: hand.information,
  };
  nextHand.information = syncHandInformation(nextHand, result.state, actions);

  return {
    ...source,
    tournament: syncTournamentStacks(source.tournament, result.state),
    activeHand: nextHand,
  };
}

function nextStreet(street: Street): Exclude<Street, "preflop"> {
  if (street === "preflop") return "flop";
  if (street === "flop") return "turn";
  return "river";
}

function dealNextStreet(hand: SessionHandState): {
  street: Exclude<Street, "preflop">;
  board: Card[];
  cursor: number;
} {
  if (hand.street === "river") {
    throw new Error("The river is already dealt");
  }
  const burn = drawCards(hand.deck, hand.deckCursor, 1);
  const street = nextStreet(hand.street);
  const count = street === "flop" ? 3 : 1;
  const cards = drawCards(hand.deck, burn.cursor, count);
  return {
    street,
    board: [...hand.board, ...cards.cards],
    cursor: cards.cursor,
  };
}

function createPostflopBetting(
  session: TournamentSession,
  hand: SessionHandState,
): BettingRoundState {
  const players = activePlayers(session).filter((player) =>
    hand.betting.players.some((entry) => entry.id === player.id),
  );
  const order = clockwisePlayersAfter(players, hand.buttonSeat).map(
    (player) => player.id,
  );
  const level = currentBlindLevel(session.tournament);
  return createBettingRound(
    hand.betting.players.map((player) => ({
      ...player,
      streetCommitted: 0,
    })),
    order,
    { minimumBet: level.bigBlind },
  );
}

function awardMap(
  awards: readonly PotAward[],
  refunds: readonly { playerId: string; amount: number }[],
): Map<string, number> {
  const output = new Map<string, number>();
  for (const award of awards) {
    output.set(award.playerId, (output.get(award.playerId) ?? 0) + award.amount);
  }
  for (const refund of refunds) {
    output.set(refund.playerId, (output.get(refund.playerId) ?? 0) + refund.amount);
  }
  return output;
}

function finishScores(
  session: TournamentSession,
  heroFinishPlace: number,
): Array<{ id: string; rating: number; actual: 0 | 0.5 | 1 }> {
  return session.entrants
    .filter((entrant) => entrant.id !== session.heroId)
    .map((entrant) => {
      const tournamentPlayer = session.tournament.players.find(
        (player) => player.id === entrant.id,
      );
      const opponentPlace = tournamentPlayer?.finishPlace;
      const actual =
        opponentPlace === undefined || opponentPlace < heroFinishPlace
          ? 0
          : opponentPlace === heroFinishPlace
            ? 0.5
            : 1;
      return { id: entrant.id, rating: entrant.rating, actual };
    });
}

export function calculatePairwiseTournamentElo(
  hero: TournamentSessionEntrant,
  opponents: readonly {
    id: string;
    rating: number;
    actual: 0 | 0.5 | 1;
  }[],
  ratingWeight: number,
  kFactor = 32,
): PairwiseTournamentElo {
  if (opponents.length === 0) throw new Error("Pairwise Elo needs opponents");
  if (!Number.isFinite(ratingWeight) || ratingWeight <= 0) {
    throw new Error("Rating weight must be positive");
  }
  const entries = opponents.map((opponent) => {
    const expectedScore =
      1 / (1 + 10 ** ((opponent.rating - hero.rating) / 400));
    const delta =
      (kFactor * ratingWeight * (opponent.actual - expectedScore)) /
      opponents.length;
    return {
      opponentId: opponent.id,
      opponentRating: opponent.rating,
      expectedScore,
      actualScore: opponent.actual,
      delta,
    };
  });
  return {
    heroId: hero.id,
    heroRating: hero.rating,
    kFactor,
    ratingWeight,
    entries,
    totalDelta: Math.round(
      entries.reduce((sum, entry) => sum + entry.delta, 0),
    ),
  };
}

function ordinalSuffix(place: number): string {
  const modulo100 = place % 100;
  if (modulo100 >= 11 && modulo100 <= 13) return "th";
  switch (place % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function createSessionResult(
  session: TournamentSession,
  finishPlace: number,
): TournamentSessionResult {
  const hero = session.entrants.find((entrant) => entrant.id === session.heroId);
  if (!hero) throw new Error("Session hero is missing");
  const qualifyingPlaces = session.event.qualifyingPlaces;
  const elo = calculatePairwiseTournamentElo(
    hero,
    finishScores(session, finishPlace),
    session.event.ratingWeight,
  );
  const careerResult: TournamentSessionCareerResult = {
    eventId: session.event.id,
    finishPlace,
    fieldSize: SESSION_TABLE_SIZE,
    sourceFieldSize: session.event.sourceFieldSize,
    qualifyingPlaces,
    qualified: finishPlace <= qualifyingPlaces,
    tournamentEloDelta: elo.totalDelta,
  };
  const previousUnlocked = new Set(
    listTournamentSessionEvents(session.careerResults)
      .filter((event) => event.unlocked)
      .map((event) => event.id),
  );
  const resultsAfterEvent = [
    ...session.careerResults.filter(
      (entry) => entry.eventId !== careerResult.eventId,
    ),
    careerResult,
  ];
  const unlockedEventIds = listTournamentSessionEvents(resultsAfterEvent)
    .filter((event) => event.unlocked)
    .map((event) => event.id);
  const newlyUnlockedEventIds = unlockedEventIds.filter(
    (eventId) => !previousUnlocked.has(eventId),
  );
  const nextEventId = CAREER_EVENTS.find(
    (event) =>
      unlockedEventIds.includes(event.id) &&
      !resultsAfterEvent.some((result) => result.eventId === event.id),
  )?.id;
  return {
    heroId: hero.id,
    ...careerResult,
    eventName: session.event.name,
    handNumber: tableForSession(session).handNumber,
    elo,
    placementLabel: formatMessage("career.result.placement", {
      place: `${finishPlace}${ordinalSuffix(finishPlace)}`,
      total: SESSION_TABLE_SIZE,
    }),
    qualificationLabel:
      finishPlace <= qualifyingPlaces
        ? formatMessage("career.result.qualified")
        : formatMessage("career.result.notQualified", { qualifyingPlaces }),
    unlockedEventIds,
    newlyUnlockedEventIds,
    ...(nextEventId ? { nextEventId } : {}),
  };
}

/**
 * Awards all side pots/refunds through the core pot engine, records zero-stack
 * eliminations through the core tournament director, and closes the session
 * only when the hero busts or wins.
 */
export function settleTournamentSessionHand(
  source: TournamentSession,
): TournamentSession {
  const hand = source.activeHand;
  if (!hand) throw new Error("No active session hand");
  if (!hand.betting.complete) {
    throw new Error("Cannot settle while betting is still open");
  }
  const live = hand.betting.players.filter(
    (player) => player.status !== "folded",
  );
  if (live.length > 1 && hand.board.length !== 5) {
    throw new Error("A contested pot requires a complete board");
  }

  const built = buildPots(
    hand.betting.players.map((player) => ({
      playerId: player.id,
      amount: player.totalCommitted,
      folded: player.status === "folded",
      allIn: player.status === "all-in",
    })),
  );
  const seats = Object.fromEntries(
    hand.information.players.map((player) => [player.id, player.seat]),
  );
  const resolved = resolvePots(built.pots, {
    board: hand.board,
    holeCards: hand.holeCards,
    seats,
    buttonSeat: hand.buttonSeat,
    tableSize: SESSION_TABLE_SIZE,
    smallestChip: 1,
  });
  const winnings = awardMap(resolved.awards, built.refunds);
  let tournament = cloneTournament(source.tournament);
  tournament.players = tournament.players.map((player) => ({
    ...player,
    stack: player.stack + (winnings.get(player.id) ?? 0),
  }));

  const eliminated = tournament.players.filter(
    (player) => player.status === "active" && player.stack === 0,
  );
  if (eliminated.length > 0) {
    tournament = recordEliminations(
      tournament,
      eliminated.map((player) => ({
        playerId: player.id,
        handId: hand.handId,
        tableId: player.tableId as string,
        startedHandWith: hand.startingStacks[player.id],
      })),
    );
  }

  let next: TournamentSession = {
    ...source,
    tournament,
    activeHand: undefined,
    lastHand: {
      handId: hand.handId,
      board: hand.board.map((card) => ({ ...card })),
      pots: built.pots.map((pot) => ({
        ...pot,
        contributorIds: [...pot.contributorIds],
        eligiblePlayerIds: [...pot.eligiblePlayerIds],
      })),
      awards: resolved.awards.map((award) => ({ ...award })),
      eliminatedPlayerIds: eliminated.map((player) => player.id),
    },
  };
  const heroState = tournament.players.find(
    (player) => player.id === source.heroId,
  );
  if (!heroState) throw new Error("Hero tournament state is missing");
  if (heroState.finishPlace !== undefined) {
    const result = createSessionResult(next, heroState.finishPlace);
    next = {
      ...next,
      status: "complete",
      result,
      careerResults: [
        ...source.careerResults.filter(
          (entry) => entry.eventId !== result.eventId,
        ),
        {
          eventId: result.eventId,
          finishPlace: result.finishPlace,
          fieldSize: result.fieldSize,
          sourceFieldSize: result.sourceFieldSize,
          qualifyingPlaces: result.qualifyingPlaces,
          qualified: result.qualified,
          tournamentEloDelta: result.tournamentEloDelta,
        },
      ],
    };
  }
  return next;
}

/**
 * Moves a completed betting round to the next street, or settles a fold/river.
 * All-in hands can call this repeatedly to deal a deterministic runout.
 */
export function progressTournamentSessionHand(
  source: TournamentSession,
): TournamentSession {
  const hand = source.activeHand;
  if (!hand) throw new Error("No active session hand");
  if (!hand.betting.complete) {
    throw new Error("Betting must complete before progressing the hand");
  }
  if (hand.betting.handComplete || hand.street === "river") {
    return settleTournamentSessionHand(source);
  }

  const dealt = dealNextStreet(hand);
  const staged: SessionHandState = {
    ...hand,
    street: dealt.street,
    board: dealt.board,
    deckCursor: dealt.cursor,
    information: {
      ...hand.information,
      street: dealt.street,
      board: dealt.board.map((card) => ({ ...card })),
    },
  };
  const betting = createPostflopBetting(source, staged);
  const actions = [
    ...staged.information.actions,
    { playerId: "dealer", type: dealt.street },
  ];
  const information = syncHandInformation(staged, betting, actions);

  return {
    ...source,
    activeHand: {
      ...staged,
      betting,
      information: {
        ...information,
        street: dealt.street,
        board: dealt.board.map((card) => ({ ...card })),
      },
    },
  };
}

export function advanceTournamentSessionClock(
  source: TournamentSession,
  elapsedMs: number,
): TournamentSession {
  return {
    ...source,
    tournament: advanceTournamentClock(source.tournament, elapsedMs),
  };
}

function mapRationalRole(role: RationalActionRole): NormalActionEvaluation["purpose"] {
  switch (role) {
    case "showdown":
      return "defense";
    case "value":
      return "value";
    case "semi-bluff":
      return "semi-bluff";
    case "bluff":
      return "bluff";
    case "fold":
      return "neutral";
  }
}

function policyInformation(
  session: TournamentSession,
  playerId: string,
): {
  hand: SessionHandState;
  informationSet: PlayerInformationSet;
  legalActions: LegalActionSet;
  level: BlindLevel;
} {
  const hand = session.activeHand;
  if (!hand) throw new Error("No active session hand");
  if (nextToAct(hand.betting) !== playerId) {
    throw new Error(`It is not ${playerId}'s turn`);
  }
  return {
    hand,
    informationSet: createInformationSet(hand.information, playerId),
    legalActions: getLegalActions(hand.betting, playerId),
    level: currentBlindLevel(session.tournament),
  };
}

interface SessionPolicyContext {
  rationalInput: RationalPolicyInput;
  hand: SessionHandState;
  informationSet: PlayerInformationSet;
  legalActions: LegalActionSet;
  level: BlindLevel;
}

/** Public tournament facts shared by live bots and post-round review. */
export function tournamentPolicyContextForSession(
  session: TournamentSession,
  playerId: string,
): RationalTournamentContext {
  const active = session.tournament.players.filter(
    (player) => player.status === "active",
  );
  const occupied = active.map((player) => player.seat as number);
  const currentButton =
    session.activeHand?.buttonSeat ?? session.tournament.tables[0]?.buttonSeat ?? 1;
  let imminentBigBlind = false;
  if (occupied.length >= 2) {
    const nextButton = nextOccupiedSeat(occupied, currentButton);
    const nextSmallBlind =
      occupied.length === 2
        ? nextButton
        : nextOccupiedSeat(occupied, nextButton);
    const nextBigBlind = nextOccupiedSeat(occupied, nextSmallBlind);
    imminentBigBlind = active.some(
      (player) => player.id === playerId && player.seat === nextBigBlind,
    );
  }
  const qualifyingPlaces = Math.max(0, session.event.qualifyingPlaces ?? 0);
  const placesToQualification =
    qualifyingPlaces > 0
      ? Math.max(0, active.length - qualifyingPlaces)
      : undefined;

  return {
    playersRemaining: active.length,
    // Career events award qualification rather than cash. Do not feed the
    // same boundary into both `paidPlaces` and `placesToQualification`, which
    // would double-count one bubble as two independent risk premiums.
    placesToQualification,
    averageStack:
      active.reduce((sum, player) => sum + player.stack, 0) /
      Math.max(1, active.length),
    handForHand:
      qualifyingPlaces > 0 && active.length === qualifyingPlaces + 1,
    imminentBigBlind,
  };
}

function sessionPolicyContext(
  session: TournamentSession,
  playerId: string,
  options: SessionPolicyOptions,
): SessionPolicyContext {
  const { hand, informationSet, legalActions, level } = policyInformation(
    session,
    playerId,
  );
  const rationalInput: RationalPolicyInput = {
    informationSet,
    legalActions,
    bigBlind: level.bigBlind,
    seed: deriveSeed(session.seed, hand.handId, playerId, "rational-policy"),
    simulations: options.simulations,
    temperature: options.temperature,
    tournament: tournamentPolicyContextForSession(session, playerId),
  };
  return { rationalInput, hand, informationSet, legalActions, level };
}

function assembleSessionPolicyDecision(
  session: TournamentSession,
  playerId: string,
  rational: RationalDecision,
  context: SessionPolicyContext,
): SessionPolicyDecision {
  const { hand, informationSet, legalActions, level } = context;
  if (session.mode === "rational") {
    return {
      mode: "rational",
      command: { ...rational.chosen.command },
      rational,
    };
  }

  const entrant = session.entrants.find((entry) => entry.id === playerId);
  const profile = entrant?.normalProfile ?? "tempo";
  const evaluations: NormalActionEvaluation[] = rational.distribution.map(
    (option) => ({
      command: { ...option.command },
      estimatedEv: option.utilityBigBlinds * level.bigBlind,
      purpose: mapRationalRole(option.role),
    }),
  );
  const normal = decideNormalAction({
    informationSet,
    legalActions,
    evaluations,
    profile,
    bigBlind: level.bigBlind,
    seed: deriveSeed(session.seed, hand.handId, playerId, "normal-policy"),
    decisionIndex: hand.information.actions.length,
  });
  return {
    mode: "normal",
    command: { ...normal.command },
    normal,
    rationalBaseline: rational,
  };
}

/**
 * Shared adapter for both AI modes. Rational supplies the information-set EV
 * baseline; Normal wraps the same distribution with bounded personality and
 * public-history deviations.
 */
export function chooseTournamentSessionPolicyAction(
  session: TournamentSession,
  playerId: string,
  options: SessionPolicyOptions = {},
): SessionPolicyDecision {
  const context = sessionPolicyContext(session, playerId, options);
  const rational = decideRationalAction(context.rationalInput);
  return assembleSessionPolicyDecision(session, playerId, rational, context);
}

/**
 * Deterministic async counterpart used by live progression. The equity Monte
 * Carlo is delegated to `estimateEquity`: a worker in a plain browser, or the
 * capped, cooperatively sliced fallback in Electron. The resulting session
 * decision is bit-for-bit identical for a fixed seed and work budget.
 */
export async function chooseTournamentSessionPolicyActionAsync(
  session: TournamentSession,
  playerId: string,
  estimateEquity: EquityEstimator,
  options: SessionPolicyOptions = {},
): Promise<SessionPolicyDecision> {
  const context = sessionPolicyContext(session, playerId, options);
  const rational = await decideRationalActionAsync(context.rationalInput, {
    estimateEquity,
  });
  return assembleSessionPolicyDecision(session, playerId, rational, context);
}

function tableOrderForSnapshot(
  session: TournamentSession,
  viewerId: string,
) {
  const viewer = session.tournament.players.find(
    (player) => player.id === viewerId,
  );
  if (!viewer || viewer.seat === undefined) {
    throw new Error(`Viewer ${viewerId} is not seated`);
  }
  const viewerSeat = viewer.seat;
  return [...session.tournament.players].sort((left, right) => {
    if (left.id === viewerId) return -1;
    if (right.id === viewerId) return 1;
    const leftDistance =
      (((left.seat as number) - viewerSeat + SESSION_TABLE_SIZE) %
        SESSION_TABLE_SIZE) ||
      SESSION_TABLE_SIZE;
    const rightDistance =
      (((right.seat as number) - viewerSeat + SESSION_TABLE_SIZE) %
        SESSION_TABLE_SIZE) ||
      SESSION_TABLE_SIZE;
    return leftDistance - rightDistance;
  });
}

/**
 * Produces the TrainingScenario-shaped snapshot currently consumed by
 * PokerTable. In Normal/Rational mode its math fields are inert compatibility
 * data; no opponent hole cards are exposed.
 */
export function createPokerTableSnapshot(
  session: TournamentSession,
  viewerId = session.heroId,
): TrainingScenario {
  const hand = session.activeHand;
  if (!hand) throw new Error("No active session hand");
  const informationSet = createInformationSet(hand.information, viewerId);
  const ordered = tableOrderForSnapshot(session, viewerId);
  const level = currentBlindLevel(session.tournament);
  const viewerHand = informationSet.players.find(
    (player) => player.id === viewerId,
  );
  if (!viewerHand?.holeCards || viewerHand.holeCards.length !== 2) {
    throw new Error("PokerTable viewer requires two private cards");
  }
  const viewerHoleCards = viewerHand.holeCards;
  const actingId = nextToAct(hand.betting);
  const actor = actingId
    ? informationSet.players.find((player) => player.id === actingId)
    : undefined;
  const viewerBetting = hand.betting.players.find(
    (player) => player.id === viewerId,
  );
  if (!viewerBetting) throw new Error("Viewer betting state is missing");
  const toCall = Math.max(0, hand.betting.currentBet - viewerBetting.streetCommitted);

  const players: SeatPlayer[] = ordered.map((tournamentPlayer, index) => {
    const handPlayer = informationSet.players.find(
      (player) => player.id === tournamentPlayer.id,
    );
    return {
      id: tournamentPlayer.id,
      name: tournamentPlayer.name,
      stack: tournamentPlayer.stack,
      seat: index,
      status:
        tournamentPlayer.status === "eliminated"
          ? "out"
          : (handPlayer?.status ?? "out"),
      bet: handPlayer?.streetCommitted ?? 0,
      totalCommitted: handPlayer?.totalCommitted ?? 0,
      ...(tournamentPlayer.id === viewerId
        ? { cards: viewerHoleCards.map((card) => ({ ...card })) }
        : {}),
    };
  });
  const buttonIndex = ordered.findIndex(
    (player) => player.seat === hand.buttonSeat,
  );
  const smallBlindIndex = ordered.findIndex(
    (player) => player.id === hand.smallBlindPlayerId,
  );
  const bigBlindIndex = ordered.findIndex(
    (player) => player.id === hand.bigBlindPlayerId,
  );
  const recommendedAction: PokerAction =
    toCall > 0 ? "call" : "check";
  // This is public ledger data only: committed amounts and folded status. It
  // lets the table explain an all-in side pot before the board/runout resolves
  // without reading or projecting anybody's hidden cards.
  const builtLivePots = buildLivePots(
    hand.betting.players.map((player) => ({
      playerId: player.id,
      amount: player.totalCommitted,
      folded: player.status === "folded",
      allIn: player.status === "all-in",
    })),
  );
  const potBreakdown = builtLivePots.pots.map((pot) => ({
    id: pot.id,
    kind: pot.kind,
    amount: pot.amount,
    eligiblePlayerIds: [...pot.eligiblePlayerIds],
  }));

  return {
    id: hand.handId,
    title: formatMessage("tournamentSession.title", {
      eventName: session.event.name,
      handNumber: tableForSession(session).handNumber,
    }),
    difficulty:
      session.event.tier === "local"
        ? 2
        : session.event.tier === "regional"
          ? 3
          : session.event.tier === "world"
            ? 5
            : 4,
    street: hand.street,
    blinds: [level.smallBlind, level.bigBlind],
    ante: 0,
    heroSeat: 0,
    buttonSeat: Math.max(0, buttonIndex),
    smallBlindSeat: Math.max(0, smallBlindIndex),
    bigBlindSeat: Math.max(0, bigBlindIndex),
    actingPlayerId: actingId ?? undefined,
    pot: hand.information.pot,
    potBreakdown,
    amountToCall: toCall,
    minimumRaise:
      hand.betting.currentBet === 0
        ? level.bigBlind
        : hand.betting.currentBet + hand.betting.lastFullRaise,
    heroCards: viewerHoleCards.map((card) => ({ ...card })),
    board: hand.board.map((card) => ({ ...card })),
    players,
    prompt: actingId
      ? formatMessage("tournamentSession.prompt.actorDeciding", {
          actorName: actor?.name ?? actingId,
        })
      : formatMessage("tournamentSession.prompt.bettingComplete"),
    recommendedAction,
    actionReason: formatMessage("tournamentSession.actionReason"),
    mathQuestion: {
      topic: "pot-odds",
      prompt: "Compatibility field; hidden outside Training mode.",
      unit: "chips",
      correctValue: toCall,
      tolerance: 0,
      explanation: "Tournament mode uses the live policy audit instead.",
    },
    tags: [
      "tournament",
      session.mode,
      session.event.tier,
      SESSION_FORMAT,
    ],
  };
}
