import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Eye,
  EyeOff,
  FastForward,
  Gauge,
  HandCoins,
  History,
  Pause,
  RotateCcw,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { SceneAvailability } from "../scene3d/sceneAvailability";
import {
  createSceneTransition,
  retainSceneTerminalFoldedPlayers,
} from "../scene3d/sceneTransition";
import {
  monotonicScenePresentationProgress,
  presentationProgressForEvent,
  sampleScenePresentationProgress,
} from "../scene3d/scenePresentationProgress";
import {
  createTableSceneSnapshot,
  type SceneSnapshotSeat,
} from "../scene3d/tableSceneSnapshot";
import {
  createHoleCardDealPlan,
  sampleHoleCardDeal,
} from "../scene3d/dealChoreography";
import {
  heroStationIndex,
  chipInventoryForAmount,
  seatBetViewportAnchor,
  seatBetViewportAnchorFromCamera,
  seatStackAmountViewportAnchor,
  seatStackAmountViewportAnchorFromCamera,
  seatPlaqueViewportAnchor,
} from "../scene3d/tableSceneModel";
import {
  heroHoleCardClientPointHits,
  heroHoleCardProjectedHitTarget,
} from "../scene3d/heroPeekPresentation";
import {
  trainingScenarios,
  type RatedTrainingScenario,
} from "../data/trainingScenarios";
import type { BettingActionType, LegalActionSet } from "../engine";
import type { CareerTier } from "../engine/tournament";
import {
  cardAriaLabel,
  cardLabel,
  formatChips,
  formatClock,
  formatFixedDecimal,
} from "../lib/format";
import { gameAudio, type SoundName } from "../lib/audio";
import { describeCallAction } from "../lib/actionLabels";
import { isShortStack } from "../lib/chipStackDepth";
import { describeTrainingContext } from "../lib/trainingScenarioContext";
import { cameraPanFromHorizontalDrag, cameraZoomFromWheel } from "../lib/tableCameraControls";
import { createTournamentDecisionClock } from "../lib/tournamentDecisionClock";
/*
  Lazy so three.js stays out of the initial bundle entirely, which is what keeps
  `initialJavaScriptGzipMiB: 0.3` intact -- see docs/desktop-3d-architecture.md.
  The chunk is only fetched when a player has actually turned the scene on.
*/
const TableScene3D = lazy(() =>
  import("./TableScene3D").then((module) => ({ default: module.TableScene3D })),
);
import {
  areHeroCardsMucked,
  foldOffsetProgress,
  isFoldReleaseArmed,
  shouldShowFoldRelease,
  type HeroFoldState,
} from "../lib/heroFoldPresentation";
import { PlayingCard } from "./PlayingCard";
import { TwoDAvatar } from "./TwoDAvatar";
import { DecorativeSceneErrorBoundary } from "./DecorativeSceneErrorBoundary";
import { PokerReferenceContent } from "./PokerReference";
import {
  describeOpponentCharacter,
  describeOpponentAppearance,
  opponentAppearanceStyle,
  type OpponentAppearance,
} from "../lib/opponentAppearance";
import {
  type TwoDAvatarModel,
  unique2DPlayerIdentities,
} from "../lib/twoDAvatarModels";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
import { derivePlayerCountSemantics } from "../lib/playerCountSemantics";
import {
  useTableAnnouncer,
  type TableAnnouncerSnapshot,
} from "../lib/tableAnnouncer";
import {
  detectContextualPromptOccurrences,
  loadContextualPromptState,
  markContextualPromptSeen,
  nextContextualPrompt,
  resetContextualPromptState,
  saveContextualPromptState,
  type ContextualPrompt,
  type ContextualPromptId,
  type ContextualPromptState,
} from "../lib/contextualPrompts";
import {
  estimateTrainingEquity,
  evaluateMathAnswer,
  gradeTrainingAttempt,
  parseMathAnswer,
  type GradedTrainingAttempt,
  type MathEvaluation,
} from "../lib/trainingEngine";
import type {
  HeroTournamentAction,
  TournamentPresentationEvent,
} from "../modes/tournamentRunner";
import {
  estimatePublicAllInEquitySliced,
  type PublicAllInEquityEstimate,
} from "../modes/rational";
import { calculateAiDecisionTiming } from "../modes/decisionTiming";
import {
  keyEventToken,
  resolveBindings,
  resolveKeyboardAction,
  type ActionId,
} from "../lib/actionMap";
import { isInputCaptureActive } from "../lib/inputCaptureGate";
import {
  GAME_ACTION_EVENT,
  useIsGamepadActive,
  type GameActionEventDetail,
} from "./GamepadNavigationProvider";
import { ControlsRemapPanel } from "./ControlsRemapPanel";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import {
  FreezableDelay,
  realFreezableDelayHost,
} from "../lib/freezableDelay";
import { shouldCancelQueuedActionShortcut } from "../lib/queuedActionShortcut";
import { snapRaiseSliderToAmount } from "../lib/raiseSlider";
import {
  DelayFreezeGroup,
  LifecyclePauseCoordinator,
  buildResumeRecap,
  type LifecyclePauseReason,
  type ResumeRecap,
} from "../lib/lifecyclePause";
import {
  createTableActionGate,
  planTableSceneUpdate,
} from "../lib/tableSceneLifecycle";
import { createPresentationEventDelay, presentationEventDelayMs } from "../lib/tournamentPresentationClock";
import { ALL_IN_EQUITY_TRANSITION_MS, interpolateAllInEquities } from "../lib/allInPresentation";
import type {
  Card,
  GameMode,
  GameSettings,
  PlayerProgress,
  PokerAction,
  SeatPlayer,
  TrainingScenario,
} from "../types/poker";
import type { HandValue } from "../engine/evaluator";
import type { TrainingPresentationCheckpoint } from "../lib/trainingCheckpoint";

interface TournamentTableControls {
  legalActions: LegalActionSet;
  onAction: (request: HeroTournamentAction) => void;
  /** True only while the engine is waiting for a legal hero action. */
  heroDecision?: boolean;
  /** The one public event currently being presented, if the table is busy. */
  presentationEvent?: TournamentPresentationEvent;
  /** Public folds retained while Skip holds its readable result beat. */
  skipTerminalFoldedPlayerIds?: readonly string[];
  /**
   * A legal all-in reveal held by the presentation coordinator for this hand.
   * It is intentionally ephemeral: never part of a snapshot, save, or replay.
   */
  allInReveal?: Extract<TournamentPresentationEvent, { kind: "all-in-reveal" }>;
  onPresentationEventComplete?: () => void;
  onSkipPresentation?: () => void;
  kind: "career" | "timed";
  /**
   * Stable identity for this tournament run.  It deliberately survives every
   * hand in the run, but is new when the player starts or retries a new round.
   */
  roundId?: string;
  /** Monotonic authoritative state revision; never a React subtree key. */
  sceneStateVersion: number;
  handNumber: number;
  fieldSize: number;
  /** Tournament-wide survivors; never use this for current-hand math. */
  tournamentPlayersRemaining: number;
  /** Explicit current-hand counts projected by the session owner. */
  playersDealtIn: number;
  activePlayersInHand: number;
  activeOpponents: number;
  /** Current blind level, 1-based, for the tournament HUD (E27-004/E27-008). */
  blindLevel?: number;
  /** Milliseconds until the blinds next rise, so the schedule is inspectable. */
  nextLevelInMs?: number;
  elapsedMs: number;
  durationMs?: number;
  actionHistory: string[];
  showArrival: boolean;
  /**
   * Career tier of the event being played. Drives room scale, crowd density,
   * and lighting at the seated table, so a world championship does not look
   * like the local qualifier with different signage.
   */
  tier?: CareerTier;
  /** Big blind of the opening level, used to detect a blind increase. */
  openingBigBlind?: number;
  /** Finishing places that qualify or cash in this event. */
  qualifyingPlaces?: number;
  /** Actual prior-hand pot award recipients, never inferred from stack size. */
  lastPotWinnerIds?: readonly string[];
  /**
   * Real per-player amounts from the engine's own pot-award resolution for
   * the most recently finished hand, used only to announce the public
   * result once the next hand begins. Never inferred from a stack-size
   * delta.
   */
  lastPotAwards?: readonly {
    potId: string;
    playerId: string;
    amount: number;
    hand?: HandValue;
  }[];
  /**
   * True when the most recently finished hand's award set spanned more than
   * one contestable pot (a genuine side pot), sourced from the engine's own
   * pot-building result.
   */
  lastHandHadSidePot?: boolean;
}

/** Human-readable, public-only event copy shared by the HUD and live region. */
export function presentationEventLabel(event: TournamentPresentationEvent): string {
  switch (event.kind) {
    case "button-moved":
      return "Dealer button moves";
    case "blinds-posted":
      return "Blinds posted";
    case "hole-cards-dealt":
      return "Cards dealt";
    case "action":
      return `${publicActionLabel(event.command.type)} in progress`;
    case "board-card-dealt":
      return `${event.street} card dealt`;
    case "bets-collected":
      return "Bets collected";
    case "showdown":
      return "Showdown";
    case "all-in-reveal":
      return "All-in hands revealed";
    case "hand-result":
      return "Hand result";
    case "side-pot-formed":
      return `Side pot formed: ${formatChips(event.amount)}`;
    case "pot-awarded":
      return `Pot awarded: ${formatChips(event.amount)}`;
    case "cards-collected":
      return "Cards collected";
    case "eliminated":
      return "Player eliminated";
  }
}

/**
 * Maps only public presentation milestones to supplementary audio. Keeping
 * this pure and event-scoped prevents hidden hole cards, simulated equity, or
 * bot decision internals from ever selecting a cue or changing its timing.
 */
export function publicPresentationSound(
  event: TournamentPresentationEvent,
): SoundName | undefined {
  switch (event.kind) {
    case "hole-cards-dealt":
    case "board-card-dealt":
    case "all-in-reveal":
      return "deal";
    case "blinds-posted":
    case "bets-collected":
    case "side-pot-formed":
      return "chip";
    case "action":
      if (event.command.type === "fold") return "fold";
      if (event.command.type === "all-in") return "all-in";
      return ["bet", "raise", "call"].includes(event.command.type)
        ? "chip"
        : undefined;
    case "pot-awarded":
      return "win";
    case "eliminated":
      return "eliminated";
    default:
      return undefined;
  }
}

/** Labels for every public voluntary action; never contains card information. */
export function publicActionLabel(action: BettingActionType): string {
  switch (action) {
    case "fold":
      return "Folds";
    case "check":
      return "Checks";
    case "call":
      return "Calls";
    case "bet":
      return "Bets";
    case "raise":
      return "Raises";
    case "all-in":
      return "All in";
  }
}

/**
 * Derives the exact public cards that form any awarded best-five hand. This is
 * deliberately driven by the engine's award payload instead of recalculating
 * a hand in the UI, so board-playing hands, ties, and separate side-pot
 * winners remain faithful to the authoritative result.
 */
export function winningCardLabelsForAwards(
  awards: readonly { hand?: HandValue }[],
): ReadonlySet<string> {
  return new Set(
    awards.flatMap((award) => award.hand?.cards.map(cardLabel) ?? []),
  );
}

/**
 * The public, authoritative cards to place in the short end-of-hand tableau.
 * This deliberately consumes the runner's showdown award rather than trying to
 * reconstruct a winner from stacks or from a player's concealed hole cards.
 */
export function winningHandsForShowdown(
  event: Extract<TournamentPresentationEvent, { kind: "showdown" }> | undefined,
  board: readonly Card[],
): readonly {
  potId: string;
  playerId: string;
  amount: number;
  handName: string;
  cards: readonly { card: Card; source: "board" | "hole" }[];
}[] {
  if (!event) return [];
  const boardLabels = new Set(board.map(cardLabel));
  return event.awards.flatMap((award) => {
    if (!award.hand) return [];
    return [{
      potId: award.potId,
      playerId: award.playerId,
      amount: award.amount,
      handName: award.hand.displayName,
      cards: award.hand.cards.map((card) => ({
        card,
        source: boardLabels.has(cardLabel(card)) ? "board" as const : "hole" as const,
      })),
    }];
  });
}

/**
 * Selects only card data that is public at the currently presented moment.
 * A held all-in reveal persists through queued board cards, while a showdown
 * replaces it with the final legally revealed set. No runner snapshot or
 * replay is consulted here.
 */
export function publicRevealsForPresentation(
  event: TournamentPresentationEvent | undefined,
  heldAllInReveal: Extract<
    TournamentPresentationEvent,
    { kind: "all-in-reveal" }
  > | undefined,
): readonly { playerId: string; cards: readonly Card[] }[] {
  if (event?.kind === "showdown") return event.reveals;
  if (heldAllInReveal) return heldAllInReveal.reveals;
  if (event?.kind === "all-in-reveal") return event.reveals;
  return [];
}

/**
 * Explains a live side pot exclusively from public table information. A side
 * pot is never an excuse to infer an opponent's hand: the only inputs are
 * committed chips, public all-in status, and the contenders that the engine
 * has already declared eligible for that pot.
 */
export function describeLiveSidePot(
  pot: NonNullable<TrainingScenario["potBreakdown"]>[number],
  players: readonly SeatPlayer[],
): string {
  const eligible = new Set(pot.eligiblePlayerIds);
  const cappedPlayers = players
    .filter((player) => player.status === "all-in" && !eligible.has(player.id))
    .sort((left, right) => (left.totalCommitted ?? 0) - (right.totalCommitted ?? 0));
  const contenders = pot.eligiblePlayerIds
    .map((playerId) => players.find((player) => player.id === playerId)?.name ?? playerId)
    .join(", ");

  if (cappedPlayers.length > 0) {
    const cap = cappedPlayers[0];
    return `${cap.name} is all-in for ${formatChips(cap.totalCommitted ?? 0)}. Chips committed above that cap form this side pot; only ${contenders} can win it.`;
  }

  return `This side pot contains chips outside the main-pot cap. Only ${contenders} can win it.`;
}

/**
 * Map a public betting action onto the body movement the 3D scene plays.
 *
 * Public actions only -- the same rule the DOM gesture layer follows. A body's
 * movement must never be derived from cards or policy output, or the animation
 * becomes a hand-strength tell that the redaction tests cannot see.
 */
export function sceneActionForCommand(
  action: BettingActionType,
): "check" | "call" | "bet" | "raise" | "fold" | "all-in" {
  switch (action) {
    case "fold":
      return "fold";
    case "check":
      return "check";
    case "all-in":
      return "all-in";
    case "bet":
      return "bet";
    case "raise":
      return "raise";
    case "call":
      return "call";
    default:
      return "check";
  }
}

export interface SeatPresentationUpdate {
  action?: BettingActionType;
  /**
   * A table milestone that is not a betting command.
   *
   * Dealing and winning a pot are things that happen *to* a seat rather than
   * decisions it makes, so they cannot go in `action` -- that field is a
   * `BettingActionType` and several consumers read it as one. The 3D scene
   * needs them because the dealer and the cards animate off them.
   */
  sceneAction?: "deal" | "win";
  label?: string;
  wonPot?: boolean;
  eliminated?: boolean;
}

/** Public-only character gesture selection. Deliberately accepts no cards or
 * policy output, so appearance and movement cannot become a hand-strength tell. */
export type SeatGesture =
  | "win"
  | "out"
  | "all-in"
  | "raise"
  | "fold"
  | "bet"
  | "check"
  | "call"
  | "receive"
  | "hold";

/**
 * The physical gesture a seat should be showing.
 *
 * **Every input is public.** There is no card, rank, equity, or evaluated-hand
 * parameter in this signature, which is what makes "animation never reflects
 * hidden-card strength" a structural property rather than a promise — an
 * opponent holding the nuts and one holding 7-2 produce byte-identical
 * gestures. `PokerTable.characterGesture.test.ts` asserts it.
 */
export function seatGestureForPublicState(input: {
  wonPot?: boolean;
  status: SeatPlayer["status"];
  bet: number;
  recentAction?: BettingActionType;
  showingFaceDownCards: boolean;
  hasPublicReveal: boolean;
  /** True on the beat the seat is dealt in. */
  justDealt?: boolean;
  /** Skip is retaining a public terminal fold across a result beat. */
  terminalFolded?: boolean;
}): SeatGesture | undefined {
  if (input.terminalFolded) return undefined;
  if (input.wonPot) return "win";
  if (input.status === "out") return "out";
  if (input.status === "all-in" || input.recentAction === "all-in") return "all-in";
  if (input.status === "folded" || input.recentAction === "fold") return "fold";
  // A raise is a distinct physical act from an opening bet -- chips are
  // gathered and pushed rather than simply placed.
  if (input.recentAction === "raise") return "raise";
  if (input.bet > 0 || input.recentAction === "bet") return "bet";
  if (input.recentAction === "check") return "check";
  if (input.recentAction === "call") return "call";
  if (input.justDealt && input.status === "active") return "receive";
  if (input.showingFaceDownCards && !input.hasPublicReveal && input.status === "active") return "hold";
  return undefined;
}

/**
 * Projects one renderer-safe tournament event onto an individual seat. The
 * projection deliberately reads no scenario cards, so it is safe for every
 * opponent as well as the hero.
 */
export function seatPresentationUpdate(
  event: TournamentPresentationEvent | undefined,
  playerId: string,
): SeatPresentationUpdate {
  if (!event) return {};
  if (event.kind === "action" && event.playerId === playerId) {
    return { action: event.command.type, label: publicActionLabel(event.command.type) };
  }
  if (event.kind === "blinds-posted") {
    const post = event.posts.find((entry) => entry.playerId === playerId);
    if (!post) return {};
    const label =
      post.type === "small-blind"
        ? "Posts small blind"
        : post.type === "big-blind"
          ? "Posts big blind"
          : "Posts big blind ante";
    return { action: "bet", label: `${label} ${formatChips(post.amount)}` };
  }
  /*
    The deal itself, which was the one milestone the scene never heard about.

    `hole-cards-dealt` has always been published -- it drives the deal sound --
    but it was not mapped here, so no seat ever carried `action: "deal"`. The
    renderer's whole dealing animation (cards travelling from the dealer's shoe
    to each seat, and the dealer pitching them) was reachable code that nothing
    ever reached: every hand simply began with two cards already lying on the
    felt. The cost of the miss was invisible because nothing failed; the
    animation just never ran.
  */
  if (event.kind === "hole-cards-dealt" && event.playerIds.includes(playerId)) {
    return { sceneAction: "deal", label: "Dealt in" };
  }
  if (event.kind === "pot-awarded" && event.playerId === playerId) {
    // `win` is what turns the dealer round to push the pot to this seat.
    return { sceneAction: "win", label: `Wins ${formatChips(event.amount)}`, wonPot: true };
  }
  if (event.kind === "eliminated" && event.playerId === playerId) {
    return { label: "Eliminated", eliminated: true };
  }
  return {};
}

interface PokerTableProps {
  mode: GameMode;
  scenario: RatedTrainingScenario | TrainingScenario;
  settings: GameSettings;
  progress: PlayerProgress;
  onProgressChange: (progress: PlayerProgress) => void;
  onSettingsChange: (settings: GameSettings) => void;
  onPauseChange?: (paused: boolean) => void;
  initialTrainingPresentation?: TrainingPresentationCheckpoint;
  onTrainingPresentationChange?: (presentation: TrainingPresentationCheckpoint) => void;
  onNextScenario: (scenarioId: string) => void;
  onExit: () => void;
  tournament?: TournamentTableControls;
}

const seatPositions = [
  "hero",
  "lower-left",
  "upper-left",
  "top",
  "upper-right",
  "lower-right",
] as const;

const EMPTY_DISPLAYED_BOARD: readonly Card[] = [];

/**
 * A concise, player-relevant live announcement. It deliberately omits the
 * dealer, room art, avatar animation, and other decorative scenery so a screen
 * reader hears the same useful state that visual card/chip/audio feedback
 * conveys without being flooded by presentation details.
 */
export function buildPokerTableAnnouncement({
  action,
  latestPublicAction,
  scenario,
}: {
  action: PokerAction | null;
  latestPublicAction?: string;
  scenario: Pick<TrainingScenario, "amountToCall" | "board" | "pot" | "street">;
}): string {
  const street = `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`;
  const board = scenario.board.length
    ? formatMessage("table.announce.board", {
        cards: scenario.board.map(cardAriaLabel).join(", "),
      })
    : formatMessage("table.announce.noBoard");
  const decision = action
    ? formatMessage("table.announce.submittedAction", {
        action: action.replace("-", " "),
      })
    : scenario.amountToCall > 0
      ? formatMessage("table.announce.amountToCall", {
          amount: formatChips(scenario.amountToCall),
        })
      : formatMessage("table.announce.mayCheckOrBet");
  return [
    formatMessage("table.announce.streetPot", {
      street,
      pot: formatChips(scenario.pot),
    }),
    board,
    latestPublicAction
      ? formatMessage("table.announce.latestPublicAction", {
          action: latestPublicAction,
        })
      : "",
    decision,
  ]
    .filter(Boolean)
    .join(" ");
}

/** The decision clock's accessible name, exported for direct assertion. */
export function decisionClockAriaLabel(elapsedMs: number): string {
  return formatMessage("table.decisionClock.ariaLabel", {
    seconds: formatFixedDecimal(elapsedMs / 1000, 1),
  });
}

export interface HeroStackAccessibleState {
  stack: number;
  streetCommitted: number;
  totalCommitted: number;
  position?: string;
}

/** Accessible copy for the persistent stack HUD, announced when it changes. */
export function heroStackAriaLabel({
  stack,
  streetCommitted,
  totalCommitted,
  position,
}: HeroStackAccessibleState): string {
  const positionSummary = position ? ` Position: ${position}.` : "";
  return [
    `Your remaining stack: ${formatChips(stack)} chips.`,
    `Committed this round: ${formatChips(streetCommitted)} chips.`,
    `Total committed this hand: ${formatChips(totalCommitted)} chips.`,
  ].join(" ") + positionSummary;
}

/**
 * Public table-position label derived only from the visible button/blind
 * seats. Keeping it pure makes each rotation testable and ensures the HUD,
 * seat marker, and assistive label always agree on the same position.
 */
export function tablePositionLabelForSeat({
  seat,
  buttonSeat,
  smallBlindSeat,
  bigBlindSeat,
  tableSize,
}: {
  seat: number;
  buttonSeat?: number;
  smallBlindSeat?: number;
  bigBlindSeat?: number;
  tableSize: number;
}): string {
  if (seat === buttonSeat) return formatMessage("table.position.button");
  if (seat === smallBlindSeat) return formatMessage("table.position.smallBlind");
  if (seat === bigBlindSeat) return formatMessage("table.position.bigBlind");
  if (bigBlindSeat === undefined || tableSize <= 0) return "";
  const distance = (seat - bigBlindSeat + tableSize) % tableSize;
  if (distance === 1) return formatMessage("table.position.utg");
  if (distance === tableSize - 1) return formatMessage("table.position.cutoff");
  return distance === 2
    ? formatMessage("table.position.hijack")
    : formatMessage("table.position.middle");
}

function ChipStack({ bet = false }: { bet?: boolean }) {
  return (
    <span className={`chip-stack ${bet ? "chip-stack--bet" : ""}`} aria-hidden="true">
      <i data-denomination="25" />
      <i data-denomination="100" />
      <i data-denomination="500" />
      {!bet && <i data-denomination="1000" />}
    </span>
  );
}

/**
 * A seat's resting pile, as tall as the stack is deep in big blinds (E27-009).
 *
 * The fixed three-chip glyph above says only "chips exist here". This says how
 * many, in the unit that decides how the hand is played -- and it shrinks as
 * the level climbs even when nobody has lost a chip, which is the pressure a
 * tournament is supposed to apply.
 */
function SeatChipStack({
  stack,
  bigBlind,
}: {
  stack: number;
  bigBlind: number;
}) {
  const inventory = chipInventoryForAmount(stack);
  if (inventory.length === 0) return null;
  const visible = inventory;
  const groups = Array.from(new Set(visible));
  return (
    <span
      className={`seat-chip-stack ${
        isShortStack(stack, bigBlind) ? "seat-chip-stack--short" : ""
      }`}
      data-chips={inventory.length}
      data-denominations={groups.join(",")}
      aria-hidden="true"
    >
      {groups.map((denomination) => (
        <span className="seat-chip-denomination" data-denomination={denomination} key={denomination}>
          {visible.filter((chip) => chip === denomination).map((chip, index) => (
            <i data-denomination={chip} key={`${chip}-${index}`} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Stable visual identity, intentionally unrelated to policy/personality. */
export function avatarVariantForPlayerId(playerId: string): number {
  return twoDAvatarModelForPlayerId(playerId).index;
}

function twoDAvatarModelForPlayerId(playerId: string): TwoDAvatarModel {
  return unique2DPlayerIdentities([playerId]).get(playerId)!.model;
}

/** Deterministic random-looking first name for the authored 2D portrait. */
export function firstNameFor2DPlayer(playerId: string, playerName?: string): string {
  return unique2DPlayerIdentities([{ id: playerId, name: playerName }]).get(playerId)!.displayName;
}

/** Resolve the visible 2D model library without allowing a duplicate model. */
export function unique2DAvatarVariants(
  playerIds: readonly string[],
): ReadonlyMap<string, number> {
  return new Map(
    [...unique2DPlayerIdentities(playerIds)].map(([playerId, identity]) => [
      playerId,
      identity.model.index,
    ]),
  );
}

/** Give a visible 2D table a collision-free, gender-matched name roster. */
export function unique2DDisplayNames(
  players: readonly (string | { readonly id: string; readonly name?: string })[],
): ReadonlyMap<string, string> {
  return new Map(
    [...unique2DPlayerIdentities(players)].map(([playerId, identity]) => [
      playerId,
      identity.displayName,
    ]),
  );
}

/**
 * Compact visual scale for the central pot; the numeric pot remains exact.
 * See docs/table-presentation-contract.md for the inclusive-pot convention
 * shared by seat wagers, central chips, and transient travel tokens.
 */
export function potChipStackCount(pot: number): number {
  if (!Number.isFinite(pot) || pot <= 0) return 0;
  return Math.min(8, Math.max(1, Math.ceil(Math.log10(pot + 1))));
}

interface PlayerSeatProps {
  /** Current big blind, so a seat's pile can be drawn in blinds (E27-009). */
  bigBlind: number;
  dealer: boolean;
  isHero: boolean;
  player: SeatPlayer;
  position: (typeof seatPositions)[number];
  wonPot?: boolean;
  /** Only a public action can drive a character gesture; no card data is read. */
  recentAction?: BettingActionType;
  recentActionLabel?: string;
  /** Number of physical private cards that have reached this owner, 0..2. */
  dealtCardCount: number;
  /** True while this hand's deal beat is the presented event. */
  justDealt?: boolean;
  isActing: boolean;
  eliminated?: boolean;
  /** Public fold retained while Skip holds a readable result beat. */
  terminalFolded?: boolean;
  positionLabel?: string;
  revealedCards?: readonly Card[];
  winningCardLabels?: ReadonlySet<string>;
  /** True while a completed hand is being shown face up in the 2D seat lane. */
  showdownRevealed?: boolean;
  /** True when this seat's cards are publicly face up during an all-in. */
  allInRevealed?: boolean;
  /** True only on the initial all-in reveal beat, when the cards should flip. */
  allInRevealBeat?: boolean;
  /** Public all-in equity shown above the revealed cards in 2D mode. */
  allInWinProbability?: number;
  /** Adapter-owned public projection used for DOM/scene parity diagnostics. */
  sceneSeat?: SceneSnapshotSeat;
  /**
   * Ready-mode viewport anchor of this seat's physical rail, so the plaque hangs
   * off the actual chair instead of a fixed viewport percentage. Absent in
   * fallback, where the CSS ellipse remains the layout owner.
   */
  railAnchor?: { readonly xPercent: number; readonly yPercent: number };
  stackAnchor?: { readonly xPercent: number; readonly yPercent: number };
  betAnchor?: { readonly xPercent: number; readonly yPercent: number };
  displayName?: string;
  avatarModel?: TwoDAvatarModel;
  appearance?: OpponentAppearance;
  /** Render the current street bet in the seat label for the flat table. */
  showCurrentBet?: boolean;
}

/**
 * Expose the adapter's stable public identity on the accessible DOM seat.
 * These attributes are deliberately diagnostic only: labels and controls stay
 * owned by the DOM, while the canvas can be audited against the same public
 * projection without reaching into renderer state.
 */
export function sceneSeatDomAttributes(
  sceneSeat: SceneSnapshotSeat | undefined,
): Readonly<Record<string, string>> {
  if (!sceneSeat) return {};
  return {
    "data-scene-player-id": sceneSeat.id,
    "data-scene-canonical-seat": String(sceneSeat.canonicalSeat),
    "data-scene-relative-seat": String(sceneSeat.relativeSeat),
    "data-scene-card-visibility": sceneSeat.cardVisibility,
    "data-scene-stack": String(sceneSeat.stack),
    "data-scene-bet": String(sceneSeat.bet),
    "data-scene-acting": String(sceneSeat.acting),
  };
}

const SEAT_STATUS_FRAGMENT_KEYS: Record<SeatPlayer["status"], string> = {
  active: "table.seat.statusFragment.active",
  folded: "table.seat.statusFragment.folded",
  "all-in": "table.seat.statusFragment.allIn",
  out: "table.seat.statusFragment.out",
};

/**
 * Builds the seat's accessible name from the versioned catalog. Exported so
 * tests can verify the exact string a screen reader receives without
 * re-scanning PokerTable.tsx's source for literal copy.
 */
export function playerSeatAriaLabel({
  isHero,
  name,
  stack,
  status,
  showingCards,
  bet,
  totalCommitted,
  dealer,
}: {
  isHero: boolean;
  name: string;
  stack: number;
  status: SeatPlayer["status"];
  showingCards: boolean;
  bet: number;
  totalCommitted?: number;
  dealer: boolean;
}): string {
  return [
    formatMessage("table.seat.ariaBase", {
      name: isHero ? formatMessage("table.seat.you") : name,
      chips: formatChips(stack),
      status: formatMessage(SEAT_STATUS_FRAGMENT_KEYS[status]),
    }),
    showingCards ? formatMessage("table.seat.holdingCardsFragment") : "",
    bet > 0
      ? formatMessage("table.seat.betFragment", { amount: formatChips(bet) })
      : "",
    totalCommitted !== undefined
      ? `, total invested ${formatChips(totalCommitted)}`
      : "",
    dealer ? formatMessage("table.seat.dealerFragment") : "",
  ].join("");
}

/** Public terminal-state projection shared by DOM and scene during Skip. */
export function isSeatFoldedForPresentation(
  status: SeatPlayer["status"],
  recentAction: BettingActionType | undefined,
  terminalFolded = false,
): boolean {
  return terminalFolded || status === "folded" || recentAction === "fold";
}

function PlayerSeat({
  bigBlind,
  dealer,
  isHero,
  player,
  position,
  wonPot = false,
  recentAction,
  recentActionLabel,
  dealtCardCount,
  justDealt = false,
  isActing,
  eliminated = false,
  terminalFolded = false,
  positionLabel,
  revealedCards,
  winningCardLabels,
  showdownRevealed = false,
  allInRevealed = false,
  allInRevealBeat = false,
  allInWinProbability,
  sceneSeat,
  railAnchor,
  stackAnchor,
  betAnchor,
  displayName,
  avatarModel,
  appearance: suppliedAppearance,
  showCurrentBet = false,
}: PlayerSeatProps) {
  const appearance = suppliedAppearance ?? describeOpponentAppearance(player.id);
  const isMucking = isSeatFoldedForPresentation(
    player.status,
    recentAction,
    terminalFolded,
  );
  const isFolded = isMucking;
  const isAllIn = player.status === "all-in" || recentAction === "all-in";
  const isOut = player.status === "out" || eliminated;
  const seatStatus = isOut
    ? "out"
    : isAllIn
      ? "all-in"
      : isFolded
        ? "folded"
        : player.status;
  // A folded hand is mucked, not a still-visible two-card hand. The public
  // fold gesture/state cue supplies the animation beat; retaining card DOM
  // through a queued event caused folded placeholder corners to overlap.
  const visiblePrivateCardCount = Math.max(0, Math.min(2, Math.floor(dealtCardCount)));
  const isShowingCards = !isHero && !isOut && visiblePrivateCardCount > 0 && !isFolded;
  const hasRevealedCards = revealedCards?.length === 2;
  const isShowdownRevealed = showdownRevealed && hasRevealedCards;
  const isAllInRevealed = allInRevealed && hasRevealedCards;
  const shouldHoldCards =
    isShowingCards && !hasRevealedCards && player.status === "active" && !isMucking;
  const gesture = seatGestureForPublicState({
    wonPot,
    status: player.status,
    bet: player.bet,
    recentAction,
    showingFaceDownCards: isShowingCards,
    hasPublicReveal: hasRevealedCards,
    justDealt,
    terminalFolded,
  });

  return (
    <div
      className={`player-seat player-seat--${position} ${
        isHero ? "player-seat--hero" : ""
      } ${isFolded ? "is-folded" : ""} ${isAllIn ? "is-all-in" : ""} ${
        isOut ? "is-out" : ""
      } ${wonPot ? "is-winner" : ""} ${hasRevealedCards ? "is-revealed" : ""} ${
        isShowdownRevealed ? "is-showdown-revealed" : ""
      } ${
        isAllInRevealed ? "is-all-in-revealed" : ""
      }`}
      role="group"
      {...(
        // Stable public action kind for packaged still-frame evidence. The
        // visible plaque text is localized, so an audit matching on it would be
        // asserting a translation rather than a terminal action state.
        recentAction && !isHero ? { "data-seat-action": recentAction } : {}
      )}
      {...((railAnchor || stackAnchor || betAnchor)
        ? {
            style: {
              ...(railAnchor
                ? {
                    "--seat-rail-x": `${railAnchor.xPercent}%`,
                    "--seat-rail-y": `${railAnchor.yPercent}%`,
                  }
                : {}),
              ...(stackAnchor
                ? {
                    "--seat-stack-x": `${stackAnchor.xPercent}%`,
                    "--seat-stack-y": `${stackAnchor.yPercent}%`,
                  }
                : {}),
              ...(betAnchor
                ? {
                    "--seat-bet-x": `${betAnchor.xPercent}%`,
                    "--seat-bet-y": `${betAnchor.yPercent}%`,
                  }
                : {}),
            } as CSSProperties,
          }
        : {})}
      {...sceneSeatDomAttributes(sceneSeat)}
      aria-label={playerSeatAriaLabel({
        isHero,
        name: displayName ?? player.name,
        stack: player.stack,
        status: seatStatus,
        showingCards: isShowingCards,
        bet: player.bet,
        totalCommitted: player.totalCommitted,
        dealer,
      })}
    >
      {dealer && <span className="dealer-button" aria-hidden="true">D</span>}
      {positionLabel && <span className="seat-position-marker" aria-hidden="true">{positionLabel}</span>}
      {recentActionLabel && (
        <span className="seat-action-label" aria-live="polite">
          {recentActionLabel}
        </span>
      )}
      {isShowingCards && (
        <div className="opponent-cards" aria-hidden={!hasRevealedCards}>
          {isAllInRevealed && allInWinProbability !== undefined && (
            <span className="all-in-win-probability">
              {formatFixedDecimal(allInWinProbability * 100, 1)}%
            </span>
          )}
          {shouldHoldCards && <i className="opponent-card-hand" aria-hidden="true" />}
          {hasRevealedCards
            ? revealedCards.map((card) => {
                const index = revealedCards.indexOf(card);
                return (
                  <PlayingCard
                    key={cardLabel(card)}
                    card={card}
                    small
                    className={
                      [
                        "deal-card",
                        `deal-card--${index + 1}`,
                        winningCardLabels?.has(cardLabel(card))
                          ? "showdown-card is-winning"
                          : "showdown-card is-unused",
                        isAllInRevealed && allInRevealBeat
                          ? "all-in-reveal-card"
                          : "",
                      ].join(" ")
                    }
                  />
                );
              })
            : Array.from({ length: visiblePrivateCardCount }, (_, index) => (
                <PlayingCard
                  key={index}
                  card={{ rank: "A", suit: "spades" }}
                  hidden
                  small
                  className={`deal-card deal-card--${index + 1}`}
                />
              ))}
        </div>
      )}
      {/* The 2D view uses an authored blocky model selected from the 100-model
          library. The 3D/fallback view keeps its seated procedural figure. In
          both cases the identity is stable across seat rotation and replay. */}
      <div
        className={`seat-figure seat-figure--body-${appearance.bodyType} seat-figure--posture-${appearance.posture} seat-figure--age-${appearance.agePresentation}`}
        style={opponentAppearanceStyle(appearance)}
        aria-hidden="true"
      >
        <i className="seat-figure-shadow" />
        <i className="seat-figure-chair" />
        <i className="seat-figure-torso" />
        <div
            className={`seat-avatar ${avatarModel ? "seat-avatar--model" : ""} seat-avatar--variant-${appearance.portrait} seat-avatar--face-${appearance.faceShape}`}
            data-avatar-face={appearance.faceShape}
            data-avatar-hair={appearance.hairStyle}
            data-avatar-shirt={appearance.clothing.name}
            {...(avatarModel
              ? {
                  "data-avatar-model": avatarModel.id,
                  "data-avatar-gender": avatarModel.gender,
                }
              : {})}
          >
          {avatarModel ? (
            <TwoDAvatar model={avatarModel} />
          ) : (
            <>
              <span className="seat-avatar-name">{displayName ?? player.name.split(" ")[0]}</span>
              <i className={`seat-figure-hair seat-figure-hair--${appearance.hairStyle}`} />
              {appearance.accessory !== "none" && (
                <i
                  className={`seat-figure-accessory seat-figure-accessory--${appearance.accessory}`}
                />
              )}
            </>
          )}
          {isActing && (
            <i className="thinking-ring" />
          )}
          {!isHero && gesture && (
            <i
              className={`seat-action-hand seat-action-hand--${gesture}`}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      {/*
        The seat's own pile, sized in big blinds (E27-009). It sits with the
        name and number rather than replacing them: chips answer "how deep is
        this player" at a glance, the numeral answers "exactly how much".
      */}
      <SeatChipStack stack={player.stack} bigBlind={bigBlind} />
      <div
        className="seat-label" aria-hidden="true"
        {...(isHero ? { "data-hero-identity": "true" } : {})}
      >
        <span className="seat-name">{isHero ? formatMessage("table.seat.you") : displayName ?? player.name.split(" ")[0]}</span>
        {wonPot && (
          <span className="seat-winner-badge" aria-hidden="true">
            {formatMessage("table.seat.winner")}
          </span>
        )}
        <strong>{formatChips(player.stack)}</strong>
        {showCurrentBet && (
          <span className="seat-current-bet">
            <small>BET</small>
            <b>{formatChips(player.bet)}</b>
          </span>
        )}
      </div>
      {/*
        The hero's committed wager sits at the hero's seat, exactly as every
        opponent's does (E27-008). It used to be excluded here and duplicated in
        a floating panel instead.
      */}
      {player.bet > 0 && (
        <div
          className="seat-bet"
          aria-hidden="true"
          data-bet-badge={isHero ? "hero" : "opponent"}
        >
          <b>{formatChips(player.bet)}</b>
        </div>
      )}
      {isFolded && (
        <span className="seat-semantic-status visually-hidden">
          {formatMessage("table.seat.folded")}
        </span>
      )}
      {player.status === "all-in" && !wonPot && (
        <span className="seat-semantic-status visually-hidden">
          {formatMessage("table.seat.allIn")}
        </span>
      )}
      {isOut && (
        <span className="seat-semantic-status visually-hidden">
          {formatMessage("table.seat.out")}
        </span>
      )}
      {wonPot && (
        <span className="seat-semantic-status visually-hidden">
          {formatMessage("table.seat.wonPot")}
        </span>
      )}
    </div>
  );
}

interface MathPanelProps {
  scenario: RatedTrainingScenario;
  answer: string;
  error?: string;
  result: MathEvaluation | null;
  mathElo: number;
  onAnswer: (answer: string) => void;
  onFocus: () => void;
  onSubmit: () => void;
}

export interface PokerMathGlossaryEntry {
  term: string;
  definition: string;
  learnMore: string;
}

const POKER_MATH_GLOSSARY: readonly PokerMathGlossaryEntry[] = [
  {
    term: "minimum defense frequency",
    definition: "How often your range should continue. Pot ÷ (pot + bet).",
    learnMore: "Use it as a baseline against bluff-capable bets: continue with roughly this share of your range so an opponent cannot profit by bluffing any two cards. Defend strongest hands first, then adjust tighter against passive players and wider against frequent bluffers.",
  },
  {
    term: "stack-to-pot ratio",
    definition: "Effective stack divided by the current pot.",
    learnMore: "SPR tells you how many pot-sized bets remain. Low SPRs make strong one-pair hands easier to commit; high SPRs reward nut-making hands and call for more caution with marginal pairs.",
  },
  {
    term: "clean-equivalent outs",
    definition: "Full outs plus the fractional value of uncertain outs.",
    learnMore: "Count reliable outs fully and discount risky cards, then convert the adjusted total into a draw probability before comparing it with pot odds.",
  },
  {
    term: "clean outs",
    definition: "Unseen cards likely to make your hand a winner.",
    learnMore: "Count only cards that improve you to a hand likely to remain best. Convert those outs to a draw chance and compare it with the price of calling.",
  },
  {
    term: "risk premium",
    definition: "Extra equity needed because losing chips hurts more in a tournament.",
    learnMore: "Near payout jumps or when shorter stacks may bust, require a better edge before risking your stack. The premium is smaller early and larger near bubbles and final-table pay jumps.",
  },
  {
    term: "set-mining",
    definition: "Calling with a pair mainly to flop three of a kind.",
    learnMore: "Set-mine when the call is small relative to effective stacks and the raiser can realistically pay you after a hit. Short stacks and loose ranges reduce the implied value.",
  },
  {
    term: "chip-EV",
    definition: "Expected chip gain or loss, without payout pressure.",
    learnMore: "Use chip-EV for cash-style and early-tournament decisions by comparing average chips won or lost. Near payout jumps, add tournament pressure rather than treating every chip equally.",
  },
  {
    term: "equity",
    definition: "Your share of the pot based on how often you expect to win.",
    learnMore: "Compare estimated equity with the equity required by pot odds. Continue when your range estimate and future betting justify the price; fold when they do not.",
  },
  {
    term: "flush",
    definition: "A hand with five cards of the same suit.",
    learnMore: "A flush draw needs one more card of the suit to complete. Count the unseen cards that help, then estimate the chance of completing it by the next street or river.",
  },
  {
    term: "outs",
    definition: "Unseen cards that can improve your hand.",
    learnMore: "Count unseen cards that make a useful hand, remove dirty outs that also help an opponent, and estimate your chance of improving by the next card or river.",
  },
  {
    term: "EV",
    definition: "Expected value: outcomes multiplied by their probabilities, then added.",
    learnMore: "List realistic outcomes, multiply each payoff by its chance, and add them. Prefer the highest-EV action while remembering that ranges and future betting make the inputs estimates.",
  },
  {
    term: "ICM",
    definition: "A model that converts tournament chips into payout value.",
    learnMore: "Use ICM near bubbles and final tables, where losing a stack can cost more prize value than winning the same chips gains. It often tightens calls and widens pressure from covering stacks.",
  },
];

export interface PokerMathQuestionSegment {
  text: string;
  glossary?: PokerMathGlossaryEntry;
}

/** Splits authored copy without changing it so recognized terms can open help. */
export function pokerMathQuestionSegments(
  prompt: string,
): PokerMathQuestionSegment[] {
  const segments: PokerMathQuestionSegment[] = [];
  const lowerPrompt = prompt.toLocaleLowerCase("en-US");
  let cursor = 0;

  while (cursor < prompt.length) {
    let nextEntry: PokerMathGlossaryEntry | undefined;
    let nextIndex = -1;

    for (const entry of POKER_MATH_GLOSSARY) {
      const candidateIndex = lowerPrompt.indexOf(
        entry.term.toLocaleLowerCase("en-US"),
        cursor,
      );
      if (
        candidateIndex >= 0 &&
        (nextIndex < 0 ||
          candidateIndex < nextIndex ||
          (candidateIndex === nextIndex &&
            entry.term.length > (nextEntry?.term.length ?? 0)))
      ) {
        nextEntry = entry;
        nextIndex = candidateIndex;
      }
    }

    if (!nextEntry || nextIndex < 0) {
      segments.push({ text: prompt.slice(cursor) });
      break;
    }
    if (nextIndex > cursor) {
      segments.push({ text: prompt.slice(cursor, nextIndex) });
    }
    segments.push({
      text: prompt.slice(nextIndex, nextIndex + nextEntry.term.length),
      glossary: nextEntry,
    });
    cursor = nextIndex + nextEntry.term.length;
  }

  return segments;
}

/**
 * Training actions are judged by EV metadata, but their availability comes
 * from the visible state. Keeping those concerns separate lets a player try a
 * fold, call/check, raise, or all-in even when the authored rating omits that
 * branch; the grader can then mark the choice as wrong or unmodeled.
 */
export function isTrainingActionLegal(
  scenario: RatedTrainingScenario,
  action: PokerAction,
): boolean {
  const hero = scenario.players.find((player) => player.seat === scenario.heroSeat);
  const heroStack = hero?.stack ?? 0;
  const amountToCall = scenario.amountToCall;

  switch (action) {
    case "fold":
      return true;
    case "check":
      return amountToCall === 0;
    case "call":
      return amountToCall > 0 && heroStack >= amountToCall;
    case "raise":
      return scenario.minimumRaise > 0 && heroStack > amountToCall;
    case "all-in":
      return heroStack > 0;
    default:
      return false;
  }
}

function MathPanel({
  scenario,
  answer,
  error,
  result,
  mathElo,
  onAnswer,
  onFocus,
  onSubmit,
}: MathPanelProps) {
  const question = scenario.mathQuestion;
  const [activeGlossary, setActiveGlossary] = useState<PokerMathGlossaryEntry>();
  const [expandedGlossary, setExpandedGlossary] = useState<PokerMathGlossaryEntry>();
  const [showCorrectAnswer, setShowCorrectAnswer] = useState(false);
  const resultClass = result?.correct ? "correct" : "incorrect";
  const answerPlaceholder =
    question.unit === "%"
      ? formatMessage("table.math.placeholder.percent")
      : question.unit === "ratio"
        ? formatMessage("table.math.placeholder.ratio")
        : question.unit === "outs"
          ? formatMessage("table.math.placeholder.outs")
          : formatMessage("table.math.placeholder.chips");

  useEffect(() => {
    setActiveGlossary(undefined);
    setExpandedGlossary(undefined);
    setShowCorrectAnswer(false);
  }, [scenario.id]);

  return (
    <aside
      className="training-panel training-panel--math"
      aria-label={formatMessage("table.math.ariaLabel")}
      data-math-elo={mathElo}
    >
      <p className="math-question">
        {pokerMathQuestionSegments(question.prompt).map((segment, index) =>
          segment.glossary ? (
            <button
              className="math-vocab-term"
              type="button"
              key={`${segment.glossary.term}-${index}`}
              aria-expanded={activeGlossary?.term === segment.glossary.term}
              aria-controls="math-vocabulary-popover"
              onClick={() =>
                setActiveGlossary((current) =>
                  current?.term === segment.glossary?.term
                    ? undefined
                    : segment.glossary,
                )
              }
            >
              {segment.text}
            </button>
          ) : (
            segment.text
          ),
        )}
      </p>

      {activeGlossary ? (
        <div
          className="math-vocab-popover"
          id="math-vocabulary-popover"
          role="status"
        >
          <span>
            <strong>{activeGlossary.term}</strong>
            {activeGlossary.definition}
            <button
              className="math-vocab-learn-more"
              type="button"
              onClick={() => setExpandedGlossary(activeGlossary)}
            >
              Learn more
            </button>
          </span>
          <button
            type="button"
            onClick={() => setActiveGlossary(undefined)}
            aria-label={`Close ${activeGlossary.term} definition`}
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {expandedGlossary ? (
        <div className="math-vocab-detail-scrim" role="presentation">
          <section
            className="math-vocab-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="math-vocab-detail-title"
          >
            <header>
              <h3 id="math-vocab-detail-title">{expandedGlossary.term}</h3>
              <button
                type="button"
                onClick={() => setExpandedGlossary(undefined)}
                aria-label={`Close ${expandedGlossary.term} details`}
              >
                <X size={16} />
              </button>
            </header>
            <p>{expandedGlossary.learnMore}</p>
          </section>
        </div>
      ) : null}

      <div className="math-answer-row">
        <label className="visually-hidden" htmlFor="training-math-answer">
          {formatMessage("table.math.answerLabel")}
        </label>
        <div className="math-answer-field">
          <input
            id="training-math-answer"
            type="text"
            inputMode="decimal"
            value={answer}
            disabled={result !== null}
            onFocus={onFocus}
            onChange={(event) => onAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSubmit();
            }}
            placeholder={answerPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
          <b>{question.unit}</b>
        </div>
        {!result ? (
          <button
            className="secondary-button math-submit"
            type="button"
            onClick={onSubmit}
            disabled={answer.trim() === ""}
          >
            {formatMessage("table.math.checkEstimate")}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="math-input-error" role="alert">
          <X size={15} aria-hidden="true" /> {error}
        </p>
      ) : null}

      {result ? (
        <div
          className={`math-result math-result--${resultClass}`}
          aria-live="polite"
        >
          <span>{result.correct ? <Check /> : <X />}</span>
          <div>
            <strong>
              {result.correct
                ? formatMessage("table.math.result.correct")
                : result.close
                  ? formatMessage("table.math.result.close")
                  : formatMessage("table.math.result.incorrect")}
            </strong>
            {!result.correct ? (
              <>
                <button
                  className="math-correct-answer-toggle"
                  type="button"
                  aria-expanded={showCorrectAnswer}
                  onClick={() => setShowCorrectAnswer((visible) => !visible)}
                >
                  {showCorrectAnswer ? "Hide correct answer" : "See correct answer"}
                </button>
                {showCorrectAnswer ? (
                  <span className="math-correct-answer">
                    {formatFixedDecimal(result.correctValue, 2)} {question.unit}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export interface FeedbackPanelProps {
  action: PokerAction;
  graded: GradedTrainingAttempt;
  mathAttempted: boolean;
  onNext: () => void;
  onReview: () => void;
}

export interface TrainingFeedbackMath {
  potBefore: number;
  costToCall: number;
  potAfterCall: number;
  /** Cost to call as a share of the pot it would create. */
  potOdds?: number;
  requiredEquity?: number;
  /**
   * Hero equity against a uniformly random opponent hand. Training scenarios
   * author no villain range, so this is the stated assumption rather than an
   * invented one — see `estimateTrainingEquity`.
   */
  estimatedEquity: number;
  equitySimulations: number;
  actionEvs: readonly [PokerAction, number][];
}

/** The public arithmetic behind the recommendation; no hidden-card data is used. */
export function trainingFeedbackMath(
  scenario: RatedTrainingScenario,
): TrainingFeedbackMath {
  const costToCall = scenario.amountToCall;
  const potAfterCall = scenario.pot + costToCall;
  const equity = estimateTrainingEquity(scenario);
  return {
    potBefore: scenario.pot,
    costToCall,
    potAfterCall,
    potOdds: costToCall > 0 ? (costToCall / potAfterCall) * 100 : undefined,
    requiredEquity:
      costToCall > 0 ? (costToCall / potAfterCall) * 100 : undefined,
    estimatedEquity: equity.equity * 100,
    equitySimulations: equity.simulations,
    actionEvs: Object.entries(scenario.training.actionEvs)
      .filter((entry): entry is [PokerAction, number] => Number.isFinite(entry[1]))
      .sort(([left], [right]) => left.localeCompare(right)),
  };
}

/** Exported so its rendered markup (not raw source copy) can be asserted directly. */
export function FeedbackPanel({
  action,
  graded,
  mathAttempted,
  onNext,
  onReview,
}: FeedbackPanelProps) {
  const actionCorrect = graded.action.correct;
  const actionPositive = actionCorrect || graded.action.close;
  const mathLabel = !mathAttempted
    ? formatMessage("table.feedback.math.skipped")
    : graded.math.correct
      ? formatMessage("table.feedback.math.correct")
      : graded.math.close
        ? formatMessage("table.feedback.math.nearMiss")
        : formatMessage("table.feedback.math.incorrect");

  return (
    <aside className="feedback-panel feedback-panel--compact" aria-live="polite">
      <div className="feedback-grade">
        <span className={actionPositive ? "is-correct" : "is-wrong"}>
          {actionPositive ? <Check size={24} /> : <X size={24} />}
        </span>
        <div>
          <p className="eyebrow">{formatMessage("table.feedback.eyebrow")}</p>
          <h2>
            {actionCorrect
              ? formatMessage("table.feedback.strongDecision")
              : graded.action.close
                ? formatMessage("table.feedback.closeDecision")
                : formatMessage("table.feedback.needsAnotherLook")}
          </h2>
        </div>
      </div>

      <div className="feedback-summary">
        <span>
          {formatMessage("table.feedback.actionLabel")} <b>{action}</b>
        </span>
        <span>
          {formatMessage("table.feedback.recommendedAction")}:{" "}
          <b>{graded.action.bestAction}</b>
        </span>
        <span>
          {formatMessage("table.feedback.mathLabel")} <b>{mathLabel}</b>
        </span>
      </div>

      <div className="feedback-actions">
        <button className="secondary-button" type="button" onClick={onReview}>
          <RotateCcw size={16} /> {formatMessage("table.feedback.reviewButton")}
        </button>
        <button className="primary-button" type="button" onClick={onNext}>
          {formatMessage("table.feedback.nextHandButton")} <ChevronRight size={16} />
        </button>
      </div>
    </aside>
  );
}

function ModeSidePanel({
  mode,
  scenario,
  tournament,
}: {
  mode: Exclude<GameMode, "training">;
  scenario: TrainingScenario;
  tournament: TournamentTableControls;
}) {
  const hero = scenario.players.find(
    (player) => player.seat === scenario.heroSeat,
  );
  const timed = tournament.kind === "timed";
  const timeRemaining =
    tournament.durationMs === undefined
      ? undefined
      : Math.max(0, tournament.durationMs - tournament.elapsedMs);

  return (
    <aside className="training-panel mode-preview-panel">
      <div className="training-panel__heading">
        <span className="training-panel__icon">
          {mode === "rational" ? <Gauge size={20} /> : <Sparkles size={20} />}
        </span>
        <div>
          <p className="eyebrow">
            {timed
              ? formatMessage("modes.timed.name")
              : mode === "rational"
                ? formatMessage("modes.rationalTour")
                : formatMessage("modes.normalTour")}
          </p>
          <h2>
            {timed
              ? formatMessage("table.modePreview.timedHeading")
              : formatMessage("table.modePreview.tournamentHeading")}
          </h2>
        </div>
      </div>
      <p className="mode-preview-panel__copy">
        {timed
          ? formatMessage("table.modePreview.timedCopy")
          : mode === "rational"
          ? formatMessage("table.modePreview.rationalCopy")
          : formatMessage("table.modePreview.normalCopy")}
      </p>
      <div className="opponent-read">
        <span>{formatMessage("table.modePreview.yourSeat")}</span>
        <strong>{hero?.name ?? formatMessage("table.modePreview.playerFallback")}</strong>
        <small>
          {formatMessage("table.modePreview.handSummary", {
            handNumber: tournament.handNumber,
            tournamentPlayersRemaining: tournament.tournamentPlayersRemaining,
          })}
          <br />
          {formatMessage("table.modePreview.handPlayers", {
            playersDealtIn: tournament.playersDealtIn,
            activePlayersInHand: tournament.activePlayersInHand,
          })}
        </small>
      </div>
      {timeRemaining !== undefined && (
        <div className="opponent-read">
          <span>{formatMessage("table.modePreview.timeRemainingLabel")}</span>
          <strong>
            {Math.floor(timeRemaining / 60_000)}:
            {String(Math.floor((timeRemaining % 60_000) / 1000)).padStart(
              2,
              "0",
            )}
          </strong>
          <small>{formatMessage("table.modePreview.blindsRiseNote")}</small>
        </div>
      )}
      <div className="training-hint">
        <CircleHelp size={16} />
        <span>
          <strong>{formatMessage("table.modePreview.infoSetTitle")}</strong>
          {formatMessage("table.modePreview.infoSetMessage")}
        </span>
      </div>
    </aside>
  );
}

export interface ContextCoachPanelProps {
  prompt: ContextualPrompt;
  onGotIt: () => void;
  onTurnOff: () => void;
}

/**
 * The contextual-tip dialog shown after certain table events (all-in, side
 * pot, blind increase, ...). Exported so its rendered markup can be asserted
 * directly instead of scanning PokerTable.tsx's source for literal copy.
 */
export function ContextCoachPanel({
  prompt,
  onGotIt,
  onTurnOff,
}: ContextCoachPanelProps) {
  return (
    <aside
      className="context-coach"
      role="dialog"
      aria-labelledby="context-coach-title"
      aria-describedby="context-coach-message"
    >
      <span className="context-coach__badge">{formatMessage("table.coach.badge")}</span>
      <h2 id="context-coach-title">{prompt.title}</h2>
      <p id="context-coach-message">{prompt.message}</p>
      <div>
        <button type="button" onClick={onGotIt}>
          {formatMessage("table.coach.gotIt")}
        </button>
        <button type="button" onClick={onTurnOff}>
          {formatMessage("table.coach.turnOff")}
        </button>
      </div>
    </aside>
  );
}

export function PokerTable({
  mode,
  scenario,
  settings,
  progress,
  onProgressChange,
  onSettingsChange,
  onPauseChange,
  initialTrainingPresentation,
  onTrainingPresentationChange,
  onNextScenario,
  onExit,
  tournament,
}: PokerTableProps) {
  const isTwoDMode = !settings.spatialScene;
  type ActiveCameraFrame = {
    readonly position: readonly [number, number, number];
    readonly target: readonly [number, number, number];
    readonly yaw: number;
    readonly fov: number;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
  };
  const [peeked, setPeeked] = useState(false);
  const [foldProgress, setFoldProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [action, setAction] = useState<PokerAction | null>(null);
  const [actionError, setActionError] = useState<string>();
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(scenario.minimumRaise);
  const [mathAnswer, setMathAnswer] = useState("");
  const [mathError, setMathError] = useState<string>();
  const [mathResult, setMathResult] = useState<MathEvaluation | null>(null);
  const [gradedAttempt, setGradedAttempt] =
    useState<GradedTrainingAttempt | null>(null);
  const [cameraPan, setCameraPan] = useState(
    initialTrainingPresentation?.cameraPan ?? 0,
  );
  const cameraPanRef = useRef(cameraPan);
  cameraPanRef.current = cameraPan;
  // A temporary, player-controlled lens adjustment. Unlike the saved framing
  // preference, this follows the player through every hand in the round.
  const [cameraZoom, setCameraZoom] = useState(0);
  const cameraZoomRef = useRef(cameraZoom);
  cameraZoomRef.current = cameraZoom;
  const pendingCameraPanRef = useRef<number | null>(null);
  const cameraPanFrameRef = useRef<number | null>(null);
  const pendingCameraZoomRef = useRef<number | null>(null);
  const cameraZoomFrameRef = useRef<number | null>(null);

  const scheduleCameraPan = useCallback((next: number) => {
    cameraPanRef.current = next;
    pendingCameraPanRef.current = next;
    if (cameraPanFrameRef.current !== null) return;
    cameraPanFrameRef.current = window.requestAnimationFrame(() => {
      cameraPanFrameRef.current = null;
      const value = pendingCameraPanRef.current;
      pendingCameraPanRef.current = null;
      if (value !== null) {
        setCameraPan((current) => current === value ? current : value);
      }
    });
  }, []);

  const scheduleCameraZoom = useCallback((event: Pick<WheelEvent, "deltaY" | "deltaMode">) => {
    const current = cameraZoomRef.current;
    const next = cameraZoomFromWheel(current, event.deltaY, event.deltaMode);
    cameraZoomRef.current = next;
    pendingCameraZoomRef.current = next;
    if (cameraZoomFrameRef.current !== null) return;
    cameraZoomFrameRef.current = window.requestAnimationFrame(() => {
      cameraZoomFrameRef.current = null;
      const value = pendingCameraZoomRef.current;
      pendingCameraZoomRef.current = null;
      if (value !== null) {
        setCameraZoom((current) => current === value ? current : value);
      }
    });
  }, []);

  useEffect(() => () => {
    if (cameraPanFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraPanFrameRef.current);
      cameraPanFrameRef.current = null;
    }
    if (cameraZoomFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraZoomFrameRef.current);
      cameraZoomFrameRef.current = null;
    }
  }, []);
  const [activeCameraFrame, setActiveCameraFrame] = useState<ActiveCameraFrame | null>(null);
  const onCameraFrame = useCallback((frame: ActiveCameraFrame) => {
    // TableScene3D enriches the renderer pose with viewport dimensions, so it
    // necessarily hands us a fresh object on every draw. Preserve the current
    // identity when its numeric projection is unchanged: React can then bail
    // out instead of rerendering the entire table at the scene frame rate.
    // Actual interpolation steps still publish exactly, keeping DOM hit
    // targets and accessible controls aligned with the rendered camera.
    setActiveCameraFrame((current) =>
      current &&
      current.position.every((value, index) => value === frame.position[index]) &&
      current.target.every((value, index) => value === frame.target[index]) &&
      current.yaw === frame.yaw &&
      current.fov === frame.fov &&
      current.viewportWidth === frame.viewportWidth &&
      current.viewportHeight === frame.viewportHeight
        ? current
        : frame,
    );
  }, []);
  // Motion preferences govern *automatic* movement only.  A player turning
  // their view with the mouse is direct manipulation, so it must stay usable
  // even if an older saved profile has camera motion disabled.  That was the
  // source of the packaged regression: the stage received the drag but every
  // result was projected back to zero by `effectiveCameraPan`.
  const cameraMotionSuppressed =
    settings.reducedMotion || settings.cameraMotion === "off";
  const effectiveCameraPan = cameraPan;

  /*
    Drag anywhere on the felt to look around.

    The camera controls were three buttons and two arrow keys, which is a fine
    accessible path and a poor primary one -- turning your head is a continuous
    motion and the discrete controls made it feel like the view was on rails.
    `cameraPan` was already a float clamped to +/-2, so a drag needs no new
    camera model: it writes the same value the buttons step.

    A drag that starts on a control is not a camera drag. The DOM table is the
    interaction surface and it sits on top of the canvas, so the guard is what
    keeps "press Fold" from also swinging the view when the pointer wobbles.
  */
  const cameraDragRef = useRef<{
    pointerId: number;
    startX: number;
    startPan: number;
  } | null>(null);

  const beginCameraDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (
      event.target instanceof Element
      && event.target.closest('button, a, input, select, textarea, [role="button"], [role="slider"]')
    ) {
      return;
    }
    cameraDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startPan: cameraPanRef.current,
    };
    // Cancel the browser's native text-selection gesture at its source.  The
    // HUD is deliberately not an editable document, and selection can steal a
    // lower-felt drag before React receives its first move event.
    event.preventDefault();
    // The visual table has multiple DOM layers. Capture on their shared stage
    // so a look begun on open felt keeps updating even after the cursor crosses
    // a plaque or leaves the canvas bounds.
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const updateCameraDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = cameraDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Drag right, look right: the same direction the "Look right" control and
    // the right arrow key move the view.  This remains a continuous float,
    // rather than resolving the pointer to one of the old seat-view steps.
    const next = cameraPanFromHorizontalDrag(
      drag.startPan,
      drag.startX,
      event.clientX,
    );
    scheduleCameraPan(next);
    // Avoid selecting felt labels while panning, without consuming the initial
    // press that cards and action controls need for their own gestures.
    event.preventDefault();
  }, [scheduleCameraPan]);

  const endCameraDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = cameraDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    cameraDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const clearCameraDrag = useCallback(() => {
    cameraDragRef.current = null;
  }, []);

  const handleCameraWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    // The stage CSS owns scroll chaining and native gesture suppression. React's
    // delegated wheel listener may be passive in Chromium, so calling
    // preventDefault here produces a renderer warning and does not suppress the
    // browser gesture reliably.
    if (
      event.target instanceof Element
      && event.target.closest('button, a, input, select, textarea, [role="button"], [role="slider"]')
    ) {
      return;
    }
    scheduleCameraZoom(event);
  }, [scheduleCameraZoom]);
  const [sceneAvailability, setSceneAvailability] =
    useState<SceneAvailability>({ status: "idle" });
  /*
    Ready-mode seat plaques hang off the projected physical rail, so they need
    the scene's real pixel box. Observing the element rather than the window
    keeps the projection correct under the compact-height HUD bands, which
    reserve different amounts of height at different native sizes.
  */
  const sceneElementRef = useRef<HTMLDivElement | null>(null);
  const [sceneViewport, setSceneViewport] = useState<{ width: number; height: number }>(
    { width: 0, height: 0 },
  );
  useEffect(() => {
    const element = sceneElementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const box = element.getBoundingClientRect();
      setSceneViewport((current) =>
        current.width === box.width && current.height === box.height
          ? current
          : { width: box.width, height: box.height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  /* A prior renderer must not make a replacement request fade DOM for a frame. */
  const sceneRequestRef = useRef(settings.spatialScene);
  const sceneRequestChanged = sceneRequestRef.current !== settings.spatialScene;
  sceneRequestRef.current = settings.spatialScene;
  /* Exactly the condition that puts `data-spatial-scene="ready"` on the scene,
     so DOM plaques never project against a camera that is not on screen. */
  /*
    Which seat the hero occupies.

    Keyed on the hero's own player identity, which is constant for a whole event
    and reproduces exactly on replay. It was keyed on `scenario.id` -- but that
    is the *hand* id, not the table's, so the seat was re-drawn every hand and
    the player's whole view teleported around the table between deals. Nothing in
    the seating model was wrong; it was being asked the wrong question.
  */
  const heroPlayerId = scenario.players.find(
    (player) => player.seat === scenario.heroSeat,
  )?.id ?? "hero";
  /*
    A seat belongs to a tournament round, not to the permanent player profile
    and not to an individual hand.  `roundId` comes from the persisted runner
    session, so reload/replay keeps the same chair through a round while a
    freshly started or retried round gets its own deterministic draw.
  */
  const heroStationIndexForTable = heroStationIndex(
    tournament
      ? `${tournament.roundId ?? scenario.id}:${heroPlayerId}`
      : heroPlayerId,
  );
  const sceneReadyForPlaques = settings.spatialScene
    && !sceneRequestChanged
    && sceneAvailability.status === "ready";
  const [elapsedMs, setElapsedMs] = useState(
    initialTrainingPresentation?.elapsedMs ?? 0,
  );
  const [speed, setSpeed] = useState(1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [coachState, setCoachState] = useState<ContextualPromptState>(
    loadContextualPromptState,
  );
  const [activePrompt, setActivePrompt] =
    useState<ContextualPrompt | null>(null);
  const [arrivalVisible, setArrivalVisible] = useState(
    Boolean(tournament?.showArrival),
  );
  const [paused, setPaused] = useState(
    initialTrainingPresentation?.paused ?? false,
  );
  const [pausePage, setPausePage] = useState<
    "menu" | "controls" | "reference" | "settings" | "remap"
  >("menu");
  const [cardsDealtHandId, setCardsDealtHandId] = useState<string | null>(
    mode === "training" || !tournament ? scenario.id : null,
  );
  const [stagedBoard, setStagedBoard] = useState<Card[]>(() =>
    scenario.board.map((card) => ({ ...card })),
  );
  const [allInEquity, setAllInEquity] =
    useState<PublicAllInEquityEstimate>();
  const [displayedAllInEquity, setDisplayedAllInEquity] = useState<ReadonlyMap<string, number>>(new Map());
  const displayedAllInEquityRef = useRef<ReadonlyMap<string, number>>(new Map());
  const [sceneEventProgress, setSceneEventProgress] = useState(1);
  const sceneProgressCursorRef = useRef({ eventId: null as string | null, progress: 1 });
  const publishSceneEventProgress = useCallback((eventId: string, progress: number) => {
    const next = monotonicScenePresentationProgress(
      sceneProgressCursorRef.current,
      eventId,
      progress,
    );
    setSceneEventProgress(next);
  }, []);
  const presentationEventCompleteRef = useRef(tournament?.onPresentationEventComplete);
  presentationEventCompleteRef.current = tournament?.onPresentationEventComplete;
  const pendingTournamentAction = useRef<FreezableDelay | null>(null);
  const pendingPresentationEvent = useRef<FreezableDelay | null>(null);
  const actionGateRef = useRef(createTableActionGate());
  const previousTrainingScenarioIdRef = useRef(scenario.id);
  const previousSceneVersionRef = useRef(tournament?.sceneStateVersion);
  const previousHandIdRef = useRef(scenario.id);
  const arrivalDelayRef = useRef<FreezableDelay | null>(null);
  const freezeGroupRef = useRef<DelayFreezeGroup>(new DelayFreezeGroup());
  const pauseCoordinatorRef = useRef<LifecyclePauseCoordinator>(
    new LifecyclePauseCoordinator(),
  );
  const pauseReasonRef = useRef<LifecyclePauseReason>("manual");
  const [resumeRecap, setResumeRecap] = useState<ResumeRecap | null>(null);
  const pausedRef = useRef(false);
  const pauseDialogRef = useRef<HTMLElement | null>(null);
  const raiseComposerRef = useRef<HTMLDivElement | null>(null);
  const historyRef = useRef<HTMLElement | null>(null);
  const soundedPresentationEvents = useRef<Set<string>>(new Set());
  const gamepadActive = useIsGamepadActive();
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const elapsedStartedAt = useRef<number | null>(null);
  /*
    The authoritative feed for the blind schedule (E27-004), deliberately
    separate from `elapsedMs`. `elapsedMs` is the *display* and Training grading
    timer: it starts at the hand and is meant to show how long this decision is
    taking. Using it to advance the blind clock meant re-submitting the whole
    running total on every hero action. This clock is drained instead, so each
    millisecond of real, unpaused table time reaches the blind schedule once.
  */
  const blindClock = useRef(
    createTournamentDecisionClock({ now: () => performance.now() }),
  );
  const mathStartedAt = useRef<number | null>(null);
  const mathElapsedMs = useRef(0);
  const pauseStartedAt = useRef<number | null>(null);
  // Combined Elo captured when this table was entered. The table stays mounted
  // across Training scenarios, so this baseline remains stable for the whole
  // sitting and lets the coach detect the first Elo change once a graded
  // attempt resolves.
  const eloBaseline = useRef(progress.decisionElo + progress.mathElo);
  const ratedScenario = scenario as RatedTrainingScenario;
  const cameraStep =
    settings.cameraSensitivity === "low"
      ? 0.6
      : settings.cameraSensitivity === "high"
        ? 1.4
        : 1;

  const updateCoachState = useCallback(
    (next: ContextualPromptState) => {
      setCoachState(next);
      saveContextualPromptState(next);
      if (!next.enabled) setActivePrompt(null);
    },
    [],
  );

  // Situational prompts re-arm between sessions but must not repeat within
  // one, so this sitting's shown-set lives in a ref rather than the save.
  const promptsShownThisSession = useRef<ContextualPromptId[]>([]);

  const offerPrompt = useCallback(
    (id: ContextualPromptId) => {
      if (activePrompt) return;
      const prompt = nextContextualPrompt(
        coachState,
        [id],
        promptsShownThisSession.current,
      );
      if (prompt) {
        promptsShownThisSession.current = [
          ...promptsShownThisSession.current,
          prompt.id,
        ];
        setActivePrompt(prompt);
      }
    },
    [activePrompt, coachState],
  );

  useEffect(() => {
    if (activePrompt) return;
    const prompt = nextContextualPrompt(
      coachState,
      detectContextualPromptOccurrences({
        scenario,
        actionHistory: tournament?.actionHistory ?? [],
        minimumRaiseAvailable: Boolean(
          tournament?.legalActions.raise ?? tournament?.legalActions.bet,
        ),
        openingBigBlind: tournament?.openingBigBlind,
        currentBigBlind: scenario.blinds[1],
        fieldSize: tournament?.fieldSize,
        tournamentPlayersRemaining: tournament?.tournamentPlayersRemaining,
        qualifyingPlaces: tournament?.qualifyingPlaces,
        eloBaseline: eloBaseline.current,
        eloCurrent: progress.decisionElo + progress.mathElo,
      }),
      promptsShownThisSession.current,
    );
    if (prompt) {
      promptsShownThisSession.current = [
        ...promptsShownThisSession.current,
        prompt.id,
      ];
      setActivePrompt(prompt);
    }
  }, [
    activePrompt,
    coachState,
    scenario,
    tournament?.actionHistory,
    tournament?.legalActions,
    tournament?.openingBigBlind,
    tournament?.fieldSize,
    tournament?.tournamentPlayersRemaining,
    tournament?.qualifyingPlaces,
    progress.decisionElo,
    progress.mathElo,
  ]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    if (
      settings.autoCameraMovement &&
      settings.cameraMotion !== "off" &&
      tournament?.handNumber
    ) {
      setCameraPan(0);
    }
  }, [
    settings.autoCameraMovement,
    settings.cameraMotion,
    tournament?.handNumber,
  ]);

  // Latest public decision state for the resume recap, kept in a ref so the
  // pause bookkeeping effect below stays keyed only on the paused flag and never
  // re-runs (and re-stamps the inactive clock) on unrelated re-renders.
  const recapDataRef = useRef<{
    pot: number;
    amountToCall: number;
    street: string;
    tournamentPlayersRemaining?: number;
    handNumber?: number;
    lastAction?: string;
  }>({ pot: scenario.pot, amountToCall: scenario.amountToCall, street: scenario.street });
  recapDataRef.current = {
    pot: scenario.pot,
    amountToCall: scenario.amountToCall,
    street: scenario.street,
    ...(tournament
      ? { tournamentPlayersRemaining: tournament.tournamentPlayersRemaining }
      : {}),
    ...(tournament ? { handNumber: tournament.handNumber } : {}),
    ...(tournament?.actionHistory.at(-1)
      ? { lastAction: tournament.actionHistory.at(-1) }
      : {}),
  };

  useEffect(() => {
    gameAudio.setFocusMuted(paused);
    onPauseChange?.(paused);
    const coordinator = pauseCoordinatorRef.current;
    if (paused) {
      // Freeze the exact remaining AI-presentation and animation delays so the
      // remainder resumes precisely rather than restarting or draining while
      // hidden/minimized/suspended/locked.
      freezeGroupRef.current.freezeAll();
      coordinator.setReason(pauseReasonRef.current, true);
      pauseStartedAt.current = performance.now();
    } else {
      const transition = coordinator.setReason(pauseReasonRef.current, false);
      if (pauseStartedAt.current !== null) {
        const inactiveMs = performance.now() - pauseStartedAt.current;
        if (mathStartedAt.current !== null) {
          mathStartedAt.current += inactiveMs;
        }
        pauseStartedAt.current = null;
      }
      freezeGroupRef.current.resumeAll();
      if (transition.justResumed && transition.inactiveMs >= 400) {
        const data = recapDataRef.current;
        setResumeRecap(
          buildResumeRecap({
            reason: pauseReasonRef.current,
            inactiveMs: transition.inactiveMs,
            potChips: data.pot,
            ...(data.tournamentPlayersRemaining !== undefined
              ? { tournamentPlayersRemaining: data.tournamentPlayersRemaining }
              : {}),
            ...(data.lastAction ? { lastAction: data.lastAction } : {}),
            currentDecision:
              data.amountToCall > 0
                ? formatMessage("table.recap.callToContinue", {
                    amount: formatChips(data.amountToCall),
                  })
                : formatMessage("table.recap.checkBetOrFold"),
            ...(data.handNumber !== undefined
              ? { handNumber: data.handNumber }
              : {}),
            street: data.street,
            // Training and Timed Table pauses never count against the player.
            countsAgainstPlay: false,
          }),
        );
      }
    }
    return () => gameAudio.setFocusMuted(false);
  }, [onPauseChange, paused]);

  // Keep the parent-owned durable checkpoint current without writing a save on
  // every tenth-of-a-second clock tick. The app flushes this in-memory snapshot
  // at its existing lifecycle boundaries; pausing also commits immediately.
  useEffect(() => {
    if (mode !== "training") return;
    onTrainingPresentationChange?.({
      cameraPan: effectiveCameraPan,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      paused,
    });
  }, [effectiveCameraPan, elapsedMs, mode, onTrainingPresentationChange, paused]);

  // The shared modal focus contract: initial focus inside the dialog, a
  // wraparound Tab trap, and exact restoration of the pre-pause focus. Subpage
  // changes re-apply initial focus without disturbing the restore target.
  useModalFocusTrap({
    active: paused,
    containerRef: pauseDialogRef,
    focusKey: pausePage,
  });
  // The custom raise panel and hand-history popover follow the same modal focus
  // contract (initial focus, wraparound trap, restore) as the pause dialog.
  useModalFocusTrap({
    active: raiseOpen && !action && Boolean(settings.spatialScene),
    containerRef: raiseComposerRef,
  });
  useModalFocusTrap({ active: historyOpen, containerRef: historyRef });

  /*
    Keyed on `paused`, which every pause path funnels through -- manual, window
    blur, document hidden, minimize, system suspend, and screen lock all call
    `requestPause`. So the blind schedule stops whenever play stops, including
    while the player is away, without hooking each call site (E27-004).
  */
  useEffect(() => {
    if (paused) blindClock.current.pause();
    else blindClock.current.resume();
  }, [paused]);

  useEffect(() => {
    if (action || paused) return;
    // Do not key this effect to elapsedMs: that would recreate the interval ten
    // times a second. On each active/resume boundary derive a fresh base from
    // the frozen elapsed value, so inactive wall-clock time never leaks into a
    // player's decision time.
    elapsedStartedAt.current = performance.now() - elapsedMs;
    const timer = window.setInterval(
      () =>
        setElapsedMs(
          performance.now() - (elapsedStartedAt.current ?? performance.now()),
        ),
      100,
    );
    return () => window.clearInterval(timer);
  }, [action, paused]);

  const requestPause = useCallback((reason: LifecyclePauseReason) => {
    pauseReasonRef.current = reason;
    setResumeRecap(null);
    setPaused(true);
  }, []);

  /*
    Losing keyboard focus is not the same thing as walking away.

    Clicking a browser window on a second monitor, alt-tabbing to read something,
    or clicking the taskbar all fire `blur` while the table is still fully
    visible in front of the player -- and the table was freezing the hand and
    demanding an explicit resume every time. A multi-monitor player could not
    click anything else without interrupting their own game.

    Minimize, system suspend, screen lock and a hidden document all still pause:
    in every one of those the table has genuinely stopped being on screen, which
    is the condition the freeze policy exists for. Only bare focus loss is
    excluded, and audio still ducks on blur through its own focus policy.
  */
  useEffect(() => {
    const pauseForHiddenDocument = () => {
      if (document.hidden) requestPause("document-hidden");
    };
    document.addEventListener("visibilitychange", pauseForHiddenDocument);
    // Minimize, Windows suspend, and screen lock arrive from the Electron main
    // process via a narrow preload bridge. They freeze the same delays and use
    // the same explicit-resume policy as blur/hidden.
    const unsubscribe = window.desktop?.onLifecycleEvent?.((event) => {
      if (event.kind === "window-minimized" && event.minimized) {
        requestPause("window-minimized");
      } else if (event.kind === "system-suspend" && event.suspended) {
        requestPause("system-suspended");
      } else if (event.kind === "screen-lock" && event.locked) {
        requestPause("screen-locked");
      }
    });
    return () => {
      document.removeEventListener("visibilitychange", pauseForHiddenDocument);
      unsubscribe?.();
    };
  }, [requestPause]);

  useEffect(() => {
    if (!arrivalVisible) return;
    const group = freezeGroupRef.current;
    const delay = new FreezableDelay(
      realFreezableDelayHost,
      settings.reducedMotion || settings.transitionMotion === "off"
        ? 450
        : settings.transitionMotion === "reduced"
          ? 900
          : 1_650,
      () => setArrivalVisible(false),
    );
    arrivalDelayRef.current = delay;
    group.add(delay);
    return () => {
      delay.cancel();
      group.remove(delay);
      if (arrivalDelayRef.current === delay) arrivalDelayRef.current = null;
    };
  }, [arrivalVisible, settings.reducedMotion, settings.transitionMotion]);

  // Consume exactly one public runner event at a time. The delay is registered
  // with the same freeze group as arrival/action delays, so pause/resume keeps
  // its exact remaining duration instead of replaying or skipping the event.
  useEffect(() => {
    const event = tournament?.presentationEvent;
    const onComplete = presentationEventCompleteRef.current;
    if (!event || !onComplete) return;
    const group = freezeGroupRef.current;
    const delay = createPresentationEventDelay(
      realFreezableDelayHost,
      event,
      speed,
      settings,
      () => {
        if (pendingPresentationEvent.current === delay) {
          pendingPresentationEvent.current = null;
        }
        if (event.kind === "cards-collected") {
          // Keep the cleared hand from reappearing during the one React render
          // between the collection event and the next hand's opening event.
          setCardsDealtHandId(null);
          setStagedBoard([]);
        }
        onComplete();
      },
      // Betting is already closed once the all-in hands are face up, so the
      // remaining board cards run out on the slower suspense cadence.
      {
        allInRunout: Boolean(tournament?.allInReveal),
        twoDMode: isTwoDMode,
      },
    );
    pendingPresentationEvent.current = delay;
    group.add(delay);
    publishSceneEventProgress(
      event.id,
      settings.reducedMotion || settings.transitionMotion === "off" ? 1 : 0,
    );
    return () => {
      delay.cancel();
      group.remove(delay);
      if (pendingPresentationEvent.current === delay) {
        pendingPresentationEvent.current = null;
      }
    };
  }, [
    settings.reducedMotion,
    settings.transitionMotion,
    isTwoDMode,
    publishSceneEventProgress,
    speed,
    tournament?.presentationEvent?.id,
    tournament?.allInReveal,
  ]);

  useEffect(() => {
    const event = tournament?.presentationEvent;
    const delay = pendingPresentationEvent.current;
    if (!event || !delay || paused) return;
    const duration = presentationEventDelayMs(event, speed, settings, {
      allInRunout: Boolean(tournament?.allInReveal),
      twoDMode: isTwoDMode,
    });
    return sampleScenePresentationProgress(
      delay,
      duration,
      (progress) => publishSceneEventProgress(event.id, progress),
      // Browser frame functions require `window` as their receiver in Electron.
      // Passing the bare native methods works in fake-frame tests but throws
      // `Illegal invocation` in the live renderer before a table mounts.
      {
        request: (callback) => window.requestAnimationFrame(callback),
        cancel: (handle) => window.cancelAnimationFrame(handle),
      },
    );
  }, [
    paused,
    settings.reducedMotion,
    settings.transitionMotion,
    isTwoDMode,
    publishSceneEventProgress,
    speed,
    tournament?.allInReveal,
    tournament?.presentationEvent?.id,
  ]);

  useEffect(() => {
    const group = freezeGroupRef.current;
    return () => {
      pendingTournamentAction.current?.cancel();
      pendingTournamentAction.current = null;
      pendingPresentationEvent.current?.cancel();
      pendingPresentationEvent.current = null;
      group.cancelAll();
    };
  }, []);

  const resetHand = useCallback(() => {
    setPeeked(false);
    setFoldProgress(0);
    setDragging(false);
    setAction(null);
    setActionError(undefined);
    setRaiseOpen(false);
    setRaiseAmount(scenario.minimumRaise);
    setMathAnswer("");
    setMathError(undefined);
    setMathResult(null);
    setGradedAttempt(null);
    setElapsedMs(0);
    elapsedStartedAt.current = performance.now();
    setSpeed(1);
    mathStartedAt.current = null;
    mathElapsedMs.current = 0;
    setCardsDealtHandId(scenario.id);
    setStagedBoard(scenario.board.map((card) => ({ ...card })));
    actionGateRef.current.release();
  }, [scenario.board, scenario.id, scenario.minimumRaise]);

  useLayoutEffect(() => {
    if (mode !== "training") {
      previousTrainingScenarioIdRef.current = scenario.id;
      return;
    }
    if (previousTrainingScenarioIdRef.current === scenario.id) return;

    previousTrainingScenarioIdRef.current = scenario.id;
    resetHand();
    setHistoryOpen(false);
    setActivePrompt(null);
  }, [mode, resetHand, scenario.id]);

  // Authoritative table state changes must update this mounted scene rather
  // than recreate it. A hand transition clears only hand-specific visuals;
  // camera and pause remain player-owned scene state across every update.
  useEffect(() => {
    if (!tournament) return;
    const previousVersion = previousSceneVersionRef.current;
    const previousHandId = previousHandIdRef.current;
    const next = {
      handId: scenario.id,
      stateVersion: tournament.sceneStateVersion,
    };
    if (previousVersion === undefined) {
      previousSceneVersionRef.current = next.stateVersion;
      previousHandIdRef.current = next.handId;
      return;
    }
    const update = planTableSceneUpdate(
      { handId: previousHandId, stateVersion: previousVersion },
      next,
    );
    previousSceneVersionRef.current = next.stateVersion;
    previousHandIdRef.current = next.handId;
    /*
      `update.changed` must not gate the hand-boundary reset (E27-001).

      The refs are committed above, so returning here on a render where the hand
      id changed but the state version did not would advance the hand ref while
      skipping the reset -- and every later render then sees `handChanged:
      false`, so that boundary's reset is lost permanently. That is how a fold
      banner survived into the next hand in the packaged run.
    */
    if (!update.changed && !update.handChanged) return;

    if (update.clearDecisionTransientState) {
      setAction(null);
      setActionError(undefined);
      setRaiseOpen(false);
      setRaiseAmount(scenario.minimumRaise);
      actionGateRef.current.release();
    }
    if (update.resetHandVisualState) {
      setPeeked(false);
      setFoldProgress(0);
      setDragging(false);
      setElapsedMs(0);
      elapsedStartedAt.current = performance.now();
    }
  }, [scenario.id, scenario.minimumRaise, tournament]);

  useEffect(() => {
    if (mode === "training" || !tournament) {
      setCardsDealtHandId(scenario.id);
      return;
    }
    const presentationEvent = tournament.presentationEvent;
    if (
      presentationEvent
      && presentationEvent.kind !== "button-moved"
      && presentationEvent.kind !== "blinds-posted"
    ) {
      /*
       * The presentation queue and scenario snapshot commit independently at a
       * hand boundary.  A fast result/next-hand transition can therefore show
       * a new-hand event for one render while `scenario` still names the
       * previous hand.  Every event after the two pre-deal beats proves that
       * hand's cards have been dealt, and the public event already carries the
       * authoritative identity.
       */
      setCardsDealtHandId(presentationEvent.handId);
    } else if (!presentationEvent && tournament.heroDecision) {
      /*
       * Skip fast-forwards the remainder of the current hand to the next hero
       * decision.  That deliberately elides the intervening presentation
       * queue, including the next hand's deal event, so the legal decision is
       * also conclusive public evidence that both cards are already present.
       */
      setCardsDealtHandId(scenario.id);
    } else if (cardsDealtHandId !== scenario.id) {
      setCardsDealtHandId(null);
    }
  }, [cardsDealtHandId, mode, scenario.id, tournament]);

  useEffect(() => {
    const event = tournament?.presentationEvent;
    if (event?.kind === "board-card-dealt") {
      setStagedBoard((current) =>
        current.length > event.cardIndex
          ? current
          : [...current, { ...event.card }],
      );
      return;
    }
    if (event?.kind === "cards-collected") return;
    if (event && event.handId !== scenario.id) {
      setStagedBoard([]);
      return;
    }
    // After the terminal collection beat the runner briefly has no active
    // hand. Keep the just-cleared board empty during that bridge; restoring
    // `scenario.board` here would put the old hand back on the felt before the
    // next hand's opening event arrives.
    if (!event && tournament && cardsDealtHandId !== scenario.id) return;
    setStagedBoard((current) =>
      current.length === scenario.board.length
        ? current
        : scenario.board.map((card) => ({ ...card })),
    );
  }, [cardsDealtHandId, scenario.board, scenario.id, tournament]);

  useEffect(() => {
    if (tournament?.showArrival) setArrivalVisible(true);
  }, [tournament?.showArrival]);

  useEffect(() => {
    const event = tournament?.presentationEvent;
    if (!event || soundedPresentationEvents.current.has(event.id)) return;
    soundedPresentationEvents.current.add(event.id);
    // Event ids are monotonic for a live session. Keep the short-lived guard
    // bounded without ever replaying a current event.
    if (soundedPresentationEvents.current.size > 256) {
      soundedPresentationEvents.current = new Set([event.id]);
    }
    const sound = publicPresentationSound(event);
    if (sound) gameAudio.play(sound);
  }, [tournament?.presentationEvent]);

  const handleAction = useCallback(
    (nextAction: PokerAction, requestedRaiseTo = raiseAmount) => {
      if (
        action ||
        paused ||
        tournament?.presentationEvent ||
        (tournament !== undefined && tournament.heroDecision === false) ||
        actionGateRef.current.isLocked
      ) {
        return;
      }
      if (mode === "training" && !isTrainingActionLegal(ratedScenario, nextAction)) {
        setActionError(formatMessage("table.error.actionUnavailable"));
        gameAudio.play("error");
        return;
      }
      if (!actionGateRef.current.tryBegin()) return;
      setActionError(undefined);
      setAction(nextAction);
      setRaiseOpen(false);
      setPeeked(false);
      if (nextAction === "fold") {
        /*
          Deliberately does NOT write `foldProgress` (E27-001).

          It used to set it to 100 to drive the card-slide, borrowing the drag
          gesture's progress bar as an animation channel. But the "Release to
          fold" banner renders on `foldProgress > 10 && !action`, and `action`
          is cleared by the next engine update while `foldProgress` survives
          until the next hand -- so a button fold made the drag banner appear
          seconds later and stay through the showdown. The slide is now driven
          by the submitted action instead, and `foldProgress` means only what
          its name says: how far the player has dragged.
        */
        setDragging(false);
        gameAudio.play("fold");
      } else {
        gameAudio.play("chip");
      }
      if (nextAction === "all-in") offerPrompt("all-in");

      if (mode === "training") {
        const mathAttempted = mathResult !== null;
        const decisionElapsedMs = Math.max(
          0,
          Math.round(elapsedMs - mathElapsedMs.current),
        );
        const graded = gradeTrainingAttempt({
          scenario: ratedScenario,
          action: nextAction,
          mathAnswer: mathAttempted
            ? parseMathAnswer(mathAnswer, scenario.mathQuestion.unit)
            : undefined,
          decisionElo: progress.decisionElo,
          mathElo: progress.mathElo,
          actionElapsedMs: decisionElapsedMs,
          mathElapsedMs: mathElapsedMs.current,
          decisionAttempts: progress.results.length,
          mathAttempts: progress.results.filter(
            (result) => result.mathAnswer !== undefined,
          ).length,
        });
        const adjusted: GradedTrainingAttempt = mathAttempted
          ? graded
          : {
              ...graded,
              result: {
                ...graded.result,
                eloDelta: graded.decisionEloDelta,
              },
              mathEloDelta: 0,
              mathEloAfter: progress.mathElo,
            };
        const persistedResult = {
          ...adjusted.result,
          actionElapsedMs: adjusted.timing.actionMs,
          mathElapsedMs: adjusted.timing.mathMs,
          decisionEloDelta: adjusted.decisionEloDelta,
          mathEloDelta: adjusted.mathEloDelta,
          mathAttempted,
        };
        const attemptCorrect =
          adjusted.action.correct &&
          (!mathAttempted || adjusted.math.correct);
        const currentStreak = attemptCorrect ? progress.currentStreak + 1 : 0;
        const nextProgress: PlayerProgress = {
          ...progress,
          decisionElo: adjusted.decisionEloAfter,
          mathElo: adjusted.mathEloAfter,
          trainingCompleted: progress.trainingCompleted + 1,
          currentStreak,
          bestStreak: Math.max(progress.bestStreak, currentStreak),
          totalDecisionMs:
            progress.totalDecisionMs + adjusted.timing.actionMs,
          results: [...progress.results, persistedResult],
        };
        setGradedAttempt(adjusted);
        if (
          nextAction !== "all-in" &&
          !adjusted.action.correct &&
          !adjusted.action.close
        ) {
          offerPrompt("decision-mistake");
        }
        onProgressChange(nextProgress);
        gameAudio.play(
          adjusted.action.correct || adjusted.action.close
            ? "success"
            : "error",
        );
      } else if (tournament) {
        const request: HeroTournamentAction = {
          action: nextAction,
          ...(nextAction === "raise" ? { raiseTo: requestedRaiseTo } : {}),
          // Real unpaused time since the previous hero action, counted once --
          // not the running per-hand total this used to send (E27-004).
          decisionElapsedMs: blindClock.current.drain(),
        };
        /*
          In the 3D table the player's input is the start of the visible beat.
          Waiting here for the old AI-style thinking delay meant the DOM showed
          the action while the seated player and their chips stayed still. The
          2D table keeps its existing queue pacing; call/fold in 3D publish on
          the same input turn and the normal presentation clock still owns the
          movement duration after that.
        */
        if (!isTwoDMode && (nextAction === "call" || nextAction === "fold")) {
          tournament.onAction(request);
          return;
        }
        const publicPotOdds =
          scenario.amountToCall /
          Math.max(1, scenario.pot + scenario.amountToCall);
        const presentationDelay = calculateAiDecisionTiming({
          seed: scenario.id,
          decisionId: [
            tournament.handNumber,
            scenario.street,
            tournament.actionHistory.length,
            nextAction,
          ].join(":"),
          street: scenario.street,
          action: nextAction,
          cutoffCloseness: 1 - Math.min(1, Math.abs(publicPotOdds - 0.33) / 0.33),
          uncertainty: Math.min(
            1,
            scenario.board.length / 10 +
              tournament.tournamentPlayersRemaining / tournament.fieldSize / 2,
          ),
          tempo:
            mode === "rational"
              ? 0.08
              : ((tournament.handNumber * 37) % 5 - 2) / 2,
          presentationRate: speed,
          surface: "desktop",
        }).delayMs;
        // Freeze this exact presentation remainder if the app is paused mid-wait
        // instead of letting it drain in real time or restarting it on resume.
        const delay = new FreezableDelay(
          realFreezableDelayHost,
          presentationDelay,
          () => {
            pendingTournamentAction.current = null;
            tournament.onAction(request);
          },
        );
        pendingTournamentAction.current = delay;
        freezeGroupRef.current.add(delay);
      }
    },
    [
      action,
      elapsedMs,
      mathAnswer,
      mathResult,
      mode,
      onProgressChange,
      paused,
      progress,
      raiseAmount,
      scenario,
      speed,
      tournament,
      isTwoDMode,
      offerPrompt,
    ],
  );

  useEffect(() => {
    // All table hotkeys resolve through the shared action map, so remaps and
    // controller bindings stay consistent with the keyboard defaults.
    const bindings = resolveBindings(settings.controlBindings);

    const submitPresetRaise = (
      sizing: "double" | "two-five" | "triple" | "pot" | "all-in",
    ) => {
      const raiseAvailable =
        mode === "training"
          ? isTrainingActionLegal(scenario as RatedTrainingScenario, "raise") ||
            isTrainingActionLegal(scenario as RatedTrainingScenario, "all-in")
          : Boolean(
              tournament?.legalActions.raise ||
                tournament?.legalActions.bet ||
                tournament?.legalActions.allIn,
            );
      if (!raiseAvailable) return;
      if (sizing === "all-in") {
        handleAction("all-in");
        return;
      }
      const legalMinimum =
        tournament?.legalActions.raise?.minTo ??
        tournament?.legalActions.bet?.min ??
        scenario.minimumRaise;
      const legalMaximum =
        tournament?.legalActions.raise?.maxTo ??
        tournament?.legalActions.bet?.max ??
        tournament?.legalActions.allInTo ??
        scenario.players.find((player) => player.seat === scenario.heroSeat)
          ?.stack ??
        scenario.minimumRaise;
      const base =
        sizing === "pot"
          ? scenario.pot
          : scenario.blinds[1] *
            (sizing === "double"
              ? 2
              : sizing === "two-five"
                ? 2.5
                : 3);
      const target = Math.max(
        legalMinimum,
        Math.min(legalMaximum, Math.round(base / scenario.blinds[1]) * scenario.blinds[1]),
      );
      setRaiseAmount(target);
      handleAction(target >= legalMaximum ? "all-in" : "raise", target);
    };

    // Shared by keyboard and controller: run the resolved gameplay action.
    const runGameAction = (actionId: ActionId) => {
      switch (actionId) {
        case "game.pause":
          pauseReasonRef.current = "manual";
          setResumeRecap(null);
          setPausePage("menu");
          setPaused(true);
          break;
        case "game.peek":
          if (!action) setPeeked((value) => !value);
          break;
        case "game.fold":
          handleAction("fold");
          break;
        case "game.checkCall":
          handleAction(scenario.amountToCall > 0 ? "call" : "check");
          break;
        case "game.raiseCustom":
          if (
            !action &&
            (mode === "training"
              ? isTrainingActionLegal(scenario as RatedTrainingScenario, "raise") ||
                isTrainingActionLegal(scenario as RatedTrainingScenario, "all-in")
              : Boolean(
                  tournament?.legalActions.raise ||
                    tournament?.legalActions.bet ||
                    tournament?.legalActions.allIn,
                ))
          ) {
            setRaiseOpen((value) => !value);
          }
          break;
        case "game.raiseDouble":
          submitPresetRaise("double");
          break;
        case "game.raiseTwoFive":
          submitPresetRaise("two-five");
          break;
        case "game.raiseTriple":
          submitPresetRaise("triple");
          break;
        case "game.pot":
          submitPresetRaise("pot");
          break;
        case "game.allIn":
          submitPresetRaise("all-in");
          break;
        case "camera.left":
          setCameraPan((value) => Math.max(-2, value - cameraStep));
          break;
        case "camera.right":
          setCameraPan((value) => Math.min(2, value + cameraStep));
          break;
        case "camera.center":
          setCameraPan(0);
          break;
        case "game.history":
          setHistoryOpen((value) => !value);
          break;
        case "speed.down":
          setSpeed((value) => Math.max(0.5, value - 0.5));
          break;
        case "speed.up":
          setSpeed((value) => Math.min(3, value + 0.5));
          break;
        default:
          break;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // The remapping capture dialog owns input exclusively while listening.
      if (isInputCaptureActive()) return;
      // Escape is the one navigation key deliberately allowed through focused
      // controls: a checked pause-menu setting must never trap the player in
      // the dialog. Gameplay hotkeys below still remain blocked while editing.
      if (keyEventToken(event) === "escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (paused) {
          setPaused(false);
          setPausePage("menu");
        } else if (raiseOpen) {
          setRaiseOpen(false);
        } else {
          pauseReasonRef.current = "manual";
          setResumeRecap(null);
          setPaused(true);
        }
        return;
      }
      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (
        shouldCancelQueuedActionShortcut({
          key: event.key,
          hasQueuedAction: Boolean(pendingTournamentAction.current?.isPending),
          isEditableTarget,
          paused,
          trainingMode: mode === "training",
        })
      ) {
        const queuedAction = pendingTournamentAction.current;
        // The reference is cleared by the delay callback immediately before
        // `onAction`, so this branch can only retract a move that has not yet
        // crossed into authoritative tournament state.
        if (!queuedAction) return;
        event.preventDefault();
        queuedAction.cancel();
        freezeGroupRef.current.remove(queuedAction);
        pendingTournamentAction.current = null;
        setAction(null);
        setActionError(undefined);
        actionGateRef.current.release();
        return;
      }

      if (isEditableTarget) return;
      if (paused) return;

      const actionId = resolveKeyboardAction(bindings, "game", event);
      if (!actionId) return;
      // Peek uses Space by default; keep the page from scrolling.
      if (keyEventToken(event) === "space") event.preventDefault();
      runGameAction(actionId);
    };

    const handleControllerAction = (event: Event) => {
      if (isInputCaptureActive() || paused) return;
      const detail = (event as CustomEvent<GameActionEventDetail>).detail;
      if (detail?.actionId) runGameAction(detail.actionId as ActionId);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(GAME_ACTION_EVENT, handleControllerAction);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(GAME_ACTION_EVENT, handleControllerAction);
    };
  }, [
    action,
    handleAction,
    onExit,
    paused,
    raiseOpen,
    mode,
    scenario.amountToCall,
    scenario.blinds,
    scenario.minimumRaise,
    scenario.pot,
    scenario.heroSeat,
    scenario.players,
    settings.controlBindings,
    tournament?.legalActions,
    cameraStep,
  ]);

  /*
    A short click toggles the same private peek as the Space shortcut. Dragging
    toward the dealer remains reserved for folding, so a player never has to
    keep a mouse button depressed just to read their own two cards.
  */
  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // Reading a live hand is allowed once the public deal beat has completed;
    // the action gate also disables this surface while a submitted action is
    // being presented so a peek cannot race the authoritative update.
    if (heroFolded) return;
    dragStart.current = null;
    didDrag.current = false;
    /*
      In ready 3D the button is a semantic overlay, not the painted cards. Its
      rectangular CSS box is only the smallest box enclosing both projected
      card silhouettes, so validate the browser's CSS-pixel point against those
      silhouettes before beginning a peek/fold gesture. `clientX/Y` and the
      canvas parent rect deliberately stay in CSS pixels; the WebGL drawing
      buffer's device-pixel ratio must never enter DOM hit testing.
    */
    if (heroHoleCardHitTarget) {
      const viewport = sceneElementRef.current?.getBoundingClientRect();
      if (
        !viewport
        || !heroHoleCardClientPointHits(
          heroHoleCardHitTarget,
          event.clientX,
          event.clientY,
          viewport,
        )
      ) {
        return;
      }
    }
    // The semantic card target sits above the canvas. Stop this private-card
    // gesture from becoming a table-look drag after the stage has already
    // rejected button targets in its capture handler.
    event.stopPropagation();
    dragStart.current = { x: event.clientX, y: event.clientY };
    didDrag.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!dragStart.current || action) return;
    const deltaX = event.clientX - dragStart.current.x;
    const deltaY = event.clientY - dragStart.current.y;
    if (Math.hypot(deltaX, deltaY) > 7) {
      didDrag.current = true;
      setDragging(true);
      setPeeked(false);
    }
    if (!didDrag.current) return;
    const nextProgress = Math.max(0, Math.min(100, (-deltaY / 125) * 100));
    setFoldProgress(nextProgress);
  };

  const endPointerGesture = (
    event: ReactPointerEvent<HTMLElement>,
    cancelled = false,
  ) => {
    // A pointer in the enclosing rectangle but outside both physical card
    // polygons never started a card gesture and therefore cannot toggle peek.
    if (!dragStart.current) return;
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const shouldFold = !cancelled && didDrag.current && foldProgress >= 82;
    dragStart.current = null;
    setDragging(false);
    if (shouldFold) {
      setPeeked(false);
      handleAction("fold");
    } else if (didDrag.current || cancelled) {
      setPeeked(false);
      setFoldProgress(0);
    } else {
      // Pointer release without a drag is a normal click: mirror Space.
      setPeeked((value) => !value);
    }
    didDrag.current = false;
  };

  const submitMath = () => {
    if (mathAnswer.trim() === "" || mathResult) return;
    const value = parseMathAnswer(mathAnswer, scenario.mathQuestion.unit);
    if (value === undefined) {
      setMathError(
        scenario.mathQuestion.unit === "%"
          ? formatMessage("table.error.mathEstimatePercent")
          : formatMessage("table.error.mathEstimateGeneric", {
              unit: scenario.mathQuestion.unit,
            }),
      );
      gameAudio.play("error");
      return;
    }
    setMathError(undefined);
    const evaluation = evaluateMathAnswer(ratedScenario, value);
    const startedAt = mathStartedAt.current ?? performance.now();
    mathElapsedMs.current = Math.max(
      0,
      Math.round(performance.now() - startedAt),
    );
    setMathResult(evaluation);
    gameAudio.play(
      evaluation.correct || evaluation.close ? "success" : "error",
    );
  };

  const beginMath = () => {
    if (mathStartedAt.current === null) {
      mathStartedAt.current = performance.now();
    }
  };

  const tableStyle = {
    "--camera-pan": `${effectiveCameraPan * -18}px`,
    "--camera-zoom":
      settings.cameraView === "close"
        ? "1.06"
        : settings.cameraView === "wide"
          ? "0.94"
          : "1",
    "--deal-multiplier":
      settings.dealSpeed === "cinematic"
        ? "1.35"
        : settings.dealSpeed === "quick"
          ? "0.62"
          : "1",
  } as CSSProperties;

  const modeTitle =
    mode === "training"
      ? formatMessage("table.modeTitle.training")
      : mode === "rational"
        ? formatMessage("table.modeTitle.rational")
        : formatMessage("table.modeTitle.normal");
  const scenarioNumber =
    trainingScenarios.findIndex((item) => item.id === scenario.id) + 1;
  const heroPlayer = scenario.players.find(
    (player) => player.seat === scenario.heroSeat,
  );
  const skipTerminalFoldedPlayerIds = new Set(
    tournament?.skipTerminalFoldedPlayerIds,
  );
  const heroStack = heroPlayer?.stack ?? scenario.minimumRaise;
  const fallbackTournamentPlayersRemaining = scenario.players.filter(
    (player) => player.status !== "out",
  ).length;
  const fallbackHandCounts = heroPlayer
    ? derivePlayerCountSemantics(
        scenario.players
          .filter((player) => player.status !== "out")
          .map((player) => ({ id: player.id, status: player.status })),
        heroPlayer.id,
        tournament?.tournamentPlayersRemaining ??
          fallbackTournamentPlayersRemaining,
      )
    : {
        tournamentPlayersRemaining:
          tournament?.tournamentPlayersRemaining ??
          fallbackTournamentPlayersRemaining,
        playersDealtIn: scenario.players.filter(
          (player) => player.status !== "out",
        ).length,
        activePlayersInHand: scenario.players.filter(
          (player) => player.status === "active" || player.status === "all-in",
        ).length,
        activeOpponents: Math.max(
          0,
          scenario.players.filter(
            (player) => player.status === "active" || player.status === "all-in",
          ).length - 1,
        ),
      };
  const activePlayersInHand =
    tournament?.activePlayersInHand ?? fallbackHandCounts.activePlayersInHand;
  /*
    Whether the hero has folded is read from the authoritative seat status, not
    from the local `action` state (E27-001). `action` is transient -- it is
    cleared by the next engine update, which is why folded hero cards used to
    come back face-up and interactive for the rest of the hand. Seat status is
    owned by the engine and resets with the hand, which is exactly the lifetime
    this needs. `action === "fold"` is still ORed in so the muck begins on the
    submitting frame rather than waiting for the engine to answer.
  */
  /*
    The facts a Training decision cannot be judged without (E27-013). Derived
    for every mode -- it is cheap and the numbers are the same ones the table
    already holds -- but surfaced as a strip only in Training, where the player
    is being asked to justify a choice rather than just make one.
  */
  const trainingContext = describeTrainingContext(scenario);

  const heroFoldState: HeroFoldState = {
    dragging,
    foldProgress,
    action,
    seatStatus: heroPlayer?.status as HeroFoldState["seatStatus"],
  };
  const heroFolded = areHeroCardsMucked(heroFoldState) ||
    (heroPlayer !== undefined && skipTerminalFoldedPlayerIds.has(heroPlayer.id));
  const heroStreetCommitted = heroPlayer?.bet ?? 0;
  const heroTotalCommitted = heroPlayer?.totalCommitted ?? heroStreetCommitted;
  const positionLabelForSeat = (seat: number): string =>
    tablePositionLabelForSeat({
      seat,
      buttonSeat: scenario.buttonSeat,
      smallBlindSeat: scenario.smallBlindSeat,
      bigBlindSeat: scenario.bigBlindSeat,
      tableSize: scenario.players.length,
    });
  const heroPositionLabel = positionLabelForSeat(scenario.heroSeat);
  const dealerMoveEvent =
    tournament?.presentationEvent?.kind === "button-moved"
      ? tournament.presentationEvent
      : undefined;
  const dealerMoveCoordinates = [
    [50, 86], [12, 73], [18, 30], [50, 12], [82, 30], [88, 73],
  ];
  const dealerMoveFrom = dealerMoveCoordinates[scenario.buttonSeat] ?? dealerMoveCoordinates[0];
  const dealerMoveTo = dealerMoveCoordinates[dealerMoveEvent?.buttonSeat ?? scenario.buttonSeat] ?? dealerMoveFrom;
  const minimumRaise =
    mode !== "training" && tournament
      ? (tournament.legalActions.raise?.minTo ??
        tournament.legalActions.bet?.min ??
        tournament.legalActions.allInTo)
      : scenario.minimumRaise;
  const allInAmount =
    mode !== "training" && tournament
      ? tournament.legalActions.allInTo
      : Math.max(scenario.minimumRaise, heroStack);
  const raisePresets = Array.from(
    new Set(
      [
        minimumRaise,
        scenario.pot * 0.5,
        scenario.pot * 0.75,
        scenario.pot,
        allInAmount,
      ].map((amount) =>
        snapRaiseSliderToAmount(amount, {
          minimumRaiseTo: minimumRaise,
          allInTo: allInAmount,
          chipStep: scenario.blinds[1],
        }),
      ),
    ),
  );
  const canRaise =
    mode === "training"
      ? isTrainingActionLegal(ratedScenario, "raise") ||
        isTrainingActionLegal(ratedScenario, "all-in")
      : Boolean(
          tournament?.legalActions.raise ||
            tournament?.legalActions.bet ||
            tournament?.legalActions.allIn,
        );
  const presentationActive = Boolean(tournament?.presentationEvent);
  /*
    The next hand is computed before its snapshot is committed so the public
    button/blind/deal beats can play continuously. During the result/collection
    bridge and the opening button/blind beats, the scenario still contains the
    previous hand, but its cards and board have already been collected; keep
    them out of both renderers immediately. When the deal beat begins, App
    supplies the viewer-safe next-hand snapshot so the arriving private card is
    sourced from the hand being presented.
  */
  const newHandPresentation = Boolean(
    tournament?.presentationEvent &&
      tournament.presentationEvent.handId !== scenario.id,
  );
  const displayedBoard = newHandPresentation
    ? EMPTY_DISPLAYED_BOARD
    : stagedBoard;
  const sceneHandId =
    tournament?.presentationEvent?.handId ??
    (tournament ? `tournament:hand-${tournament.handNumber}` : scenario.id);
  const cardsDealt = !newHandPresentation && cardsDealtHandId === scenario.id;
  const heroDecisionActive =
    mode === "training" || tournament?.heroDecision !== false;
  const callAction = scenario.amountToCall > 0 ? "call" : "check";
  /*
    The label is derived from the hero's stack as well as the bet, so a call
    that commits their last chip says "All in" (E27-005). The legal action is
    unchanged -- the engine still resolves this as a call and still caps the
    main pot -- only what the player is told about it changes.
  */
  const callDescription = describeCallAction({
    amountToCall: scenario.amountToCall,
    heroStack,
  });
  const callControlLabel =
    callDescription.kind === "check"
      ? formatMessage("table.action.check")
      : callDescription.kind === "all-in"
        ? formatMessage("table.action.allInAmount", {
            amount: formatChips(callDescription.committed),
          })
        : formatMessage("table.action.callAmount", {
            amount: formatChips(callDescription.committed),
          });
  const callControlAriaLabel =
    callDescription.kind === "check"
      ? formatMessage("table.action.checkAriaLabel")
      : callDescription.kind === "all-in"
        ? callDescription.shortOfCall
          ? formatMessage("table.action.allInShortAriaLabel", {
              amount: formatChips(callDescription.committed),
              facing: formatChips(callDescription.facing),
            })
          : formatMessage("table.action.allInAriaLabel", {
              amount: formatChips(callDescription.committed),
            })
        : formatMessage("table.action.callAriaLabel", {
            amount: formatChips(callDescription.committed),
          });
  const tablePlayers = [...scenario.players].sort((left, right) => {
    if (left.seat === scenario.heroSeat) return -1;
    if (right.seat === scenario.heroSeat) return 1;
    const leftDistance = (left.seat - scenario.heroSeat + 10) % 10;
    const rightDistance = (right.seat - scenario.heroSeat + 10) % 10;
    return leftDistance - rightDistance;
  });
  const twoDPlayerIdentities = unique2DPlayerIdentities(
    scenario.players.map((player) => ({ id: player.id, name: player.name })),
  );

  /*
    The 3D scene's view of the table, derived from exactly the same scenario the
    DOM layer renders. Nothing here is scene-only state: if the two ever
    disagree, the DOM is right, because it is the layer the engine and the
    accessibility audits both talk to.
  */
  const activeEventProgress = tournament?.presentationEvent
    ? presentationProgressForEvent(
        sceneProgressCursorRef.current,
        tournament.presentationEvent.id,
        sceneEventProgress,
      )
    : sceneEventProgress;
  const baseSceneTransition = tournament?.presentationEvent
    ? createSceneTransition(
      tournament.presentationEvent,
      activeEventProgress,
      settings.reducedMotion || settings.transitionMotion === "off",
    )
    : undefined;
  const sceneTransition = baseSceneTransition
    ? retainSceneTerminalFoldedPlayers(
      baseSceneTransition,
      tournament?.skipTerminalFoldedPlayerIds,
    )
    : undefined;
  const sceneActions = Object.fromEntries(tablePlayers.map((player) => {
    const presentation = seatPresentationUpdate(
      tournament?.presentationEvent,
      player.id,
    );
    return [player.id, sceneTransition?.action && sceneTransition.playerIds.includes(player.id)
      ? sceneTransition.action
      : presentation.sceneAction
        ? presentation.sceneAction
        : presentation.action ? sceneActionForCommand(presentation.action) : undefined];
  }));
  const sceneSnapshot = createTableSceneSnapshot({
    // The presentation event is intentionally short-lived; handNumber is the
    // stable identity that keeps both physical packs and every dealt back in
    // lockstep for the entire round.
    handId: sceneHandId,
    players: scenario.players.map((player) => ({ id: player.id, canonicalSeat: player.seat, stack: player.stack, bet: player.bet ?? 0, status: player.status })),
    heroId: scenario.players.find((player) => player.seat === scenario.heroSeat)?.id ?? "",
    actingPlayerId: scenario.actingPlayerId,
    publicActions: sceneActions,
    pot: scenario.pot,
    pots: (scenario.potBreakdown?.length
      ? scenario.potBreakdown
      : [{ id: "main", kind: "main", amount: scenario.pot }]
    ).map((pot, index) => ({
      id: `${pot.kind}-${index}`,
      kind: pot.kind === "side" ? "side" as const : "main" as const,
      amount: pot.amount,
    })),
    boardCards: displayedBoard.length,
    publicBoardCardCodes: displayedBoard.map(cardLabel),
    heroCardCodes: scenario.heroCards.map(cardLabel),
    revealedCardCodesByPlayer: tournament?.presentationEvent?.kind === "showdown"
      ? Object.fromEntries(tournament.presentationEvent.reveals.map((reveal) => [reveal.playerId, reveal.cards.map(cardLabel)]))
      : tournament?.presentationEvent?.kind === "all-in-reveal"
        ? Object.fromEntries(tournament.presentationEvent.reveals.map((reveal) => [reveal.playerId, reveal.cards.map(cardLabel)]))
        : {},
    cameraPan: effectiveCameraPan,
    cameraZoom,
    heroStationIndex: heroStationIndexForTable,
    /* Only the squeeze. A showdown reveal turns the hand over through
       `revealedCardCodesByPlayer`, which the snapshot already honours for every
       seat including this one. */
    heroPeeked: peeked,
    privateCardsDealt: cardsDealt,
    cameraView: settings.cameraView,
    // A disabled automatic camera still accepts the player's own free-look;
    // keep renderer interpolation immediate in that mode instead of discarding
    // the manual yaw in the DOM layer.
    cameraMotion: cameraMotionSuppressed ? "off" : settings.cameraMotion,
    reducedMotion: settings.reducedMotion || settings.transitionMotion === "off",
    buttonCanonicalSeat: scenario.buttonSeat,
    smallBlindCanonicalSeat: scenario.smallBlindSeat,
    bigBlindCanonicalSeat: scenario.bigBlindSeat,
    revealedPlayerIds: tournament?.presentationEvent?.kind === "showdown"
      ? tournament.presentationEvent.reveals.map((reveal) => reveal.playerId)
      : tournament?.presentationEvent?.kind === "all-in-reveal"
        ? tournament.presentationEvent.reveals.map((reveal) => reveal.playerId)
        : [],
    tier: tournament?.tier === "circuit" ? "regional" : tournament?.tier === "championship" ? "national" : tournament?.tier === "world" ? "championship" : "local",
    transition: sceneTransition,
  });
  /*
   * DOM affordances use the same two-circuit physical clock as the renderer.
   * A first card therefore becomes peekable when that card reaches the owner;
   * the second cannot appear merely because the overall deal event has begun.
   * Geometry is immaterial to this projection, so zero anchors keep it pure and
   * avoid introducing a second scene-layout source into the accessible layer.
   */
  const holeDealAvailabilityFrame = sceneTransition?.kind === "hole-cards-dealt"
    ? sampleHoleCardDeal(
        createHoleCardDealPlan(
          sceneSnapshot.seats
            .filter((seat) => sceneTransition.playerIds.includes(seat.id))
            .map((seat) => ({
              id: seat.id,
              clockwiseIndex: seat.relativeSeat,
              cardAnchor: [0, 0, 0] as const,
              facingRadians: 0,
            })),
          {
            surfaceY: 0,
            deckAnchor: [0, 0, 0],
            rightHandRest: [0, 0, 0],
          },
          { firstRecipientId: sceneSnapshot.smallBlindPlayerId },
        ),
        sceneTransition.progress,
      )
    : undefined;
  const dealtCardCountForPlayer = (playerId: string): number => holeDealAvailabilityFrame
    ? holeDealAvailabilityFrame.cards.filter(
        (card) => card.assignment.recipientId === playerId && card.viewable,
      ).length
    : cardsDealt ? 2 : 0;
  const heroDealtCardCount = dealtCardCountForPlayer(heroPlayerId);
  const heroHitProjectionWidth = activeCameraFrame?.viewportWidth || sceneViewport.width;
  const heroHitProjectionHeight = activeCameraFrame?.viewportHeight || sceneViewport.height;
  const heroHoleCardHitTarget = sceneReadyForPlaques
    ? heroHoleCardProjectedHitTarget({
        pan: effectiveCameraPan,
        cameraView: settings.cameraView,
        wheelZoom: cameraZoom,
        viewportWidth: heroHitProjectionWidth,
        viewportHeight: heroHitProjectionHeight,
        heroIndex: heroStationIndexForTable,
        peeked,
        cardCount: heroDealtCardCount,
        camera: activeCameraFrame ?? undefined,
      })
    : undefined;
  const heroHoleCardHitBounds = heroHoleCardHitTarget?.bounds;
  const sceneSeatByPlayerId = new Map(
    sceneSnapshot.seats.map((seat) => [seat.id, seat]),
  );
  const tableSeatCoordinates = [
    [50, 86], [12, 73], [18, 30], [50, 12], [82, 30], [88, 73],
  ] as const;
  const tablePotCoordinate = [50, 58] as const;
  const chipTravel = (() => {
    const event = tournament?.presentationEvent;
    if (!event) return undefined;
    const playerIndex = (playerId: string) =>
      tablePlayers.findIndex((player) => player.id === playerId);
    if (
      event.kind === "action" &&
      ["bet", "raise", "call", "all-in"].includes(event.command.type)
    ) {
      const index = playerIndex(event.playerId);
      if (index >= 0) return { from: tableSeatCoordinates[index] ?? tablePotCoordinate, to: tablePotCoordinate, direction: "to-pot" as const };
    }
    if (event.kind === "bets-collected") {
      return { from: [50, 78] as const, to: tablePotCoordinate, direction: "to-pot" as const };
    }
    if (event.kind === "pot-awarded") {
      const index = playerIndex(event.playerId);
      if (index >= 0) return { from: tablePotCoordinate, to: tableSeatCoordinates[index] ?? tablePotCoordinate, direction: "to-winner" as const };
    }
    return undefined;
  })();
  const showdownEvent =
    tournament?.presentationEvent?.kind === "showdown"
      ? tournament.presentationEvent
      : undefined;
  const handResultEvent =
    tournament?.presentationEvent?.kind === "hand-result"
      ? tournament.presentationEvent
      : undefined;
  const resultEvent = showdownEvent ?? handResultEvent;
  const sidePotEvent =
    tournament?.presentationEvent?.kind === "side-pot-formed"
      ? tournament.presentationEvent
      : undefined;
  const liveSidePots = scenario.potBreakdown?.filter((pot) => pot.kind === "side") ?? [];
  /*
    Pots to draw on the felt. Falls back to a single synthetic main pot when the
    engine reports no breakdown, so the ordinary single-pot hand renders exactly
    as it always did and only a genuine side pot splits the pile (E27-002).
  */
  const potGroups = (
    scenario.potBreakdown && scenario.potBreakdown.length > 0
      ? scenario.potBreakdown
      : [
          {
            id: "main",
            kind: "main" as const,
            amount: scenario.pot,
            eligiblePlayerIds: scenario.players.map((player) => player.id),
          },
        ]
  ).map((pot) => ({
    id: pot.id,
    kind: pot.kind,
    amount: pot.amount,
    /*
      The full public explanation still exists -- it is just no longer printed
      on the felt. Side pots carry `describeLiveSidePot`, which derives its
      wording only from committed chips and declared eligibility and so cannot
      leak a hand; main pots carry the contender list. Both reach assistive
      technology, and neither occupies the table.
    */
    description:
      pot.kind === "side"
        ? describeLiveSidePot(pot, scenario.players)
        : formatMessage("table.pot.eligibleAriaLabel", {
            players: pot.eligiblePlayerIds
              .map(
                (playerId) =>
                  scenario.players.find((player) => player.id === playerId)
                    ?.name ?? playerId,
              )
              .join(", "),
          }),
  }));
  const allInEvent =
    tournament?.presentationEvent?.kind === "action" &&
    tournament.presentationEvent.command.type === "all-in"
      ? tournament.presentationEvent
      : undefined;
  const allInPlayer = allInEvent
    ? scenario.players.find((player) => player.id === allInEvent.playerId)
    : undefined;
  const allInRevealEvent = tournament?.allInReveal ??
    (tournament?.presentationEvent?.kind === "all-in-reveal"
      ? tournament.presentationEvent
      : undefined);
  const allInRevealPlayerIds = new Set(
    allInRevealEvent?.reveals.map((reveal) => reveal.playerId) ?? [],
  );
  const allInRevealBeat =
    isTwoDMode && tournament?.presentationEvent?.kind === "all-in-reveal";
  useEffect(() => {
    if (!allInRevealEvent || allInRevealEvent.reveals.length < 2) {
      setAllInEquity(undefined);
      return;
    }
    // A real abort, not just an ignored promise: the estimator re-checks this
    // at each deterministic slice boundary, so a new board card stops the
    // superseded run instead of leaving it to finish against a stale board.
    const controller = new AbortController();
    setAllInEquity(undefined);
    const publicCardSeed = [
      allInRevealEvent.handId,
      ...displayedBoard.map(cardLabel),
      ...allInRevealEvent.reveals.flatMap((reveal) => [
        reveal.playerId,
        ...reveal.cards.map(cardLabel),
      ]),
    ].join(":");
    void estimatePublicAllInEquitySliced(
      {
        players: allInRevealEvent.reveals,
        board: displayedBoard,
        seed: `public-all-in:${publicCardSeed}`,
        simulations: 500,
        simulationsPerSlice: 25,
      },
      { signal: controller.signal },
    ).then((estimate) => {
      if (!controller.signal.aborted) setAllInEquity(estimate);
    }).catch(() => {
      // A stale/cancelled visual calculation is intentionally silent. The
      // authoritative engine is already progressing independently.
    });
    return () => { controller.abort(); };
  }, [allInRevealEvent, displayedBoard]);
  useEffect(() => {
    if (!allInEquity) {
      const empty = new Map<string, number>();
      displayedAllInEquityRef.current = empty;
      setDisplayedAllInEquity(empty);
      return;
    }
    const target = allInEquity.players.map((player) => ({ playerId: player.playerId, equity: player.equity }));
    if (settings.reducedMotion || settings.transitionMotion === "off") {
      const instant = new Map(target.map((entry) => [entry.playerId, entry.equity]));
      displayedAllInEquityRef.current = instant;
      setDisplayedAllInEquity(instant);
      return;
    }
    let frame = 0;
    const startedAt = performance.now();
    const initial = displayedAllInEquityRef.current.size > 0
      ? displayedAllInEquityRef.current
      : new Map(target.map((entry) => [entry.playerId, 0]));
    const tick = (now: number) => {
      const elapsed = now - startedAt;
      const next = interpolateAllInEquities(initial, target, elapsed);
      displayedAllInEquityRef.current = next;
      setDisplayedAllInEquity(next);
      if (elapsed < ALL_IN_EQUITY_TRANSITION_MS) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [allInEquity, settings.reducedMotion, settings.transitionMotion]);
  const rememberedShowdownRef = useRef<
    Extract<TournamentPresentationEvent, { kind: "showdown" }> | null
  >(null);
  useEffect(() => {
    if (showdownEvent) rememberedShowdownRef.current = showdownEvent;
  }, [showdownEvent?.id]);
  const presentationHandId =
    tournament?.presentationEvent?.handId ?? scenario.id;
  const rememberedShowdownEvent =
    rememberedShowdownRef.current?.handId === presentationHandId
      ? rememberedShowdownRef.current
      : undefined;
  /*
    The runner advances from `showdown` through side-pot and payout milestones
    without changing the authoritative snapshot. Keep the already-public
    showdown event attached to that same hand so the cards do not vanish while
    the result is being paid out. A new hand id automatically drops this view.
  */
  const showdownEventForDisplay = showdownEvent ?? rememberedShowdownEvent;
  const revealedCardsByPlayer = new Map(
    (showdownEventForDisplay?.reveals ??
      publicRevealsForPresentation(
        tournament?.presentationEvent,
        allInRevealEvent,
      )
    ).map((reveal) => [reveal.playerId, reveal.cards]),
  );
  const winningCardLabels = winningCardLabelsForAwards(
    showdownEventForDisplay?.awards ?? [],
  );
  const winningShowdownHands = winningHandsForShowdown(
    showdownEventForDisplay,
    displayedBoard,
  );
  /*
    Who won this hand, held for as long as the hand is paying out (E27-003).

    `lastPotAwards` is derived from `session.lastHand`, which is not populated
    until the hand is over -- so during the `pot-awarded` milestones, which are
    the payout of the very result being shown, the awards array is empty and the
    winner strip blanked. Remembering the last non-empty awards for this hand id
    keeps the outcome on screen while its chips are still moving, and drops it
    automatically when a new hand starts.
  */
  const liveAwards =
    resultEvent?.awards ??
    showdownEventForDisplay?.awards ??
    tournament?.lastPotAwards ??
    [];
  const rememberedAwards = useRef<{
    handId: string;
    awards: typeof liveAwards;
  } | null>(null);
  useEffect(() => {
    if (liveAwards.length > 0) {
      rememberedAwards.current = { handId: scenario.id, awards: liveAwards };
    }
  }, [liveAwards, scenario.id]);
  const showdownAwards =
    liveAwards.length > 0
      ? liveAwards
      : rememberedAwards.current?.handId === scenario.id
        ? rememberedAwards.current.awards
        : [];
  /*
    The stretch of the queue that belongs to "who won this hand": the result
    itself and every milestone that pays it out. Keeping the winner on screen
    across all of them is what makes the outcome readable (E27-003).
  */
  const resultPhaseKind = tournament?.presentationEvent?.kind;
  const resultPhaseActive =
    Boolean(resultEvent) ||
    resultPhaseKind === "pot-awarded" ||
    resultPhaseKind === "side-pot-formed" ||
    resultPhaseKind === "cards-collected";
  const showdownVisualActive =
    Boolean(showdownEventForDisplay) && resultPhaseKind !== "cards-collected";
  const showdownWinnerIds = new Set(
    showdownAwards.map((award) => award.playerId),
  );
  const showdownHeroRevealed = revealedCardsByPlayer.has(heroPlayer?.id ?? "");
  const heroAllInRevealed =
    isTwoDMode &&
    allInRevealPlayerIds.has(heroPlayerId) &&
    showdownHeroRevealed;
  const heroAllInWinProbability = heroAllInRevealed
    ? displayedAllInEquity.get(heroPlayerId)
    : undefined;
  const tableAnnouncement = buildPokerTableAnnouncement({
    action,
    latestPublicAction: tournament?.actionHistory.at(-1),
    scenario,
  });

  // Public result of the hand that just finished, resolved from the same
  // engine pot-award data the "Won pot" seat badge already uses -- never
  // guessed from a stack-size delta. Undefined until a hand has resolved.
  const potResultSnapshot: TableAnnouncerSnapshot["potResult"] =
    showdownAwards.length
      ? {
          id: resultEvent?.handId ?? `previous-${tournament?.handNumber ?? 0}`,
          winnerNames: Array.from(
            new Set(showdownAwards.map((award) => award.playerId)),
          ).map((playerId) => {
            const winner = scenario.players.find(
              (player) => player.id === playerId,
            );
            if (!winner) return playerId;
            return winner.seat === scenario.heroSeat
              ? formatMessage("table.seat.you")
              : winner.name;
          }),
          amount: showdownAwards.reduce(
            (sum, award) => sum + award.amount,
            0,
          ),
          hadSidePot:
            Boolean(tournament?.lastHandHadSidePot) ||
            new Set(showdownAwards.map((award) => award.potId)).size > 1,
        }
      : undefined;

  const { politeMessage: liveEventPolite, assertiveMessage: liveEventAssertive } =
    useTableAnnouncer({
      bigBlind: scenario.blinds[1],
      smallBlind: scenario.blinds[0],
      handNumber: tournament?.handNumber,
      heroAction: action,
      heroAllInAmount: allInAmount,
      latestPublicAction: tournament?.actionHistory.at(-1),
      potResult: potResultSnapshot,
    });

  return (
    <div
      className={`table-screen ${isTwoDMode ? "table-screen--2d" : "table-screen--3d"}`}
      data-game-mode={mode}
      data-training-step={
        mode === "training"
          ? gradedAttempt
            ? "feedback"
            : "question"
          : undefined
      }
      data-event-tier={tournament?.tier ?? "local"}
      data-camera-motion={settings.cameraMotion}
      data-table-motion={settings.tableMotion}
      data-transition-motion={settings.transitionMotion}
      {...(showdownVisualActive ? { "data-table-phase": "showdown" } : {})}
      style={tableStyle}
      {...localeTextAttributes()}
    >
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {tableAnnouncement}
      </p>
      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {presentationActive
          ? presentationEventLabel(tournament?.presentationEvent as TournamentPresentationEvent)
          : ""}
      </p>
      {/*
        Discrete LIVE event announcements (timers/blind changes, hand
        results, all-in) layered on top of the per-render summary above --
        see src/lib/tableAnnouncer.ts for the transition logic. Errors are
        deliberately not duplicated here; they already speak through the
        `role="alert"` elements below (table-action-alert / math-input-error).
      */}
      <p
        className="visually-hidden live-event-announcer live-event-announcer--polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveEventPolite}
      </p>
      <p
        className="visually-hidden live-event-announcer live-event-announcer--assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {liveEventAssertive}
      </p>
      <header className="table-topbar">
        <button className="table-exit" type="button" onClick={onExit}>
          <ArrowLeft size={18} /> {formatMessage("table.exit")}
        </button>
        <div className="table-session">
          <p className="eyebrow">{modeTitle}</p>
          {mode !== "training" && <strong>{scenario.title}</strong>}
          <span>
            {/*
              The scenario counter is gone from the player interface
              (E27-013 / §18). "Scenario 6 of 12" framed Training as a
              twelve-question content pack with an end, which is the opposite of
              what the mode is for. Training now reports the street and the
              field, exactly as every other mode does.
            */}
            {mode === "training"
              ? formatMessage("table.status.streetPlayersInHand", {
                  street: `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`,
                  playersInHand: trainingContext.activePlayersInHand,
                })
              : formatMessage("table.status.streetPlayersInHand", {
                  street: `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`,
                  playersInHand: activePlayersInHand,
                })}
          </span>
        </div>
        <div className="table-tools">
          <span
            className="decision-clock"
            role="timer"
            aria-label={decisionClockAriaLabel(elapsedMs)}
          >
            <Clock3 size={15} />
            {formatMessage("table.decisionClock.visibleLabel", {
              seconds: formatFixedDecimal(elapsedMs / 1000, 1),
            })}
          </span>
          {tournament && (
            <label className="table-speed-control">
              <FastForward size={15} />
              <span>{formatFixedDecimal(speed, 1)}×</span>
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.5"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                aria-label={formatMessage("shared.opponentPresentationSpeed")}
              />
            </label>
          )}
          <button
            type="button"
            aria-label={formatMessage("table.pauseButton.ariaLabel")}
            onClick={() => {
              pauseReasonRef.current = "manual";
              setResumeRecap(null);
              setPausePage("menu");
              setPaused(true);
            }}
          >
            <Pause size={17} />
          </button>
          <button
            type="button"
            aria-label={
              settings.muted
                ? formatMessage("table.audio.unmute")
                : formatMessage("table.audio.mute")
            }
            aria-pressed={settings.muted}
            onClick={() =>
              onSettingsChange({ ...settings, muted: !settings.muted })
            }
          >
            <Volume2 size={17} />
          </button>
        </div>
      </header>

      <div className="table-layout">
        {/*
          Drag-to-look is bound to the whole stage, not to the scene element.

          It was on `.poker-scene`, which is only the canvas -- and the DOM table
          is a *sibling* that covers it completely. So every drag a player could
          actually make landed on a seat, a card or the felt overlay and never
          reached the handler: the feature was wired to the one part of the play
          area nothing is ever on top of. The stage is the common ancestor of the
          canvas and the table, so the drag works wherever the view being turned
          is visible. Controls are still excluded inside `beginCameraDrag`.
        */}
        <section
          className="table-stage"
          aria-label={formatMessage("table.stageAriaLabel")}
          onPointerDownCapture={isTwoDMode ? undefined : beginCameraDrag}
          onPointerMoveCapture={isTwoDMode ? undefined : updateCameraDrag}
          onPointerUpCapture={isTwoDMode ? undefined : endCameraDrag}
          onPointerCancelCapture={isTwoDMode ? undefined : endCameraDrag}
          onLostPointerCaptureCapture={isTwoDMode ? undefined : clearCameraDrag}
          onWheelCapture={isTwoDMode ? undefined : handleCameraWheel}
        >
          {/*
            The hero's state lives at the hero's seat, not in a floating panel
            (E27-008). A panel titled "Your stack" in the top-left corner is a
            dashboard widget; a poker player reads their stack from the chips in
            front of them. Stack, chips, committed wager, position marker and
            big-blind depth are all on the seat now, with an accessible summary
            that carries the same facts in one utterance.

            What remains up here is the tournament HUD below: global state only,
            in a corner, no paragraphs.
          */}
          <aside
            className="tournament-hud"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={heroStackAriaLabel({
              stack: heroStack,
              streetCommitted: heroStreetCommitted,
              totalCommitted: heroTotalCommitted,
              position: heroPositionLabel || undefined,
            })}
          >
            <span>
              <b>{formatMessage("table.hud.blinds")}</b>
              {formatChips(scenario.blinds[0])}/{formatChips(scenario.blinds[1])}
            </span>
            {tournament?.blindLevel ? (
              <span>
                <b>{formatMessage("table.hud.level")}</b>
                {tournament.blindLevel}
              </span>
            ) : null}
            {tournament?.nextLevelInMs !== undefined ? (
              <span>
                <b>{formatMessage("table.hud.nextLevel")}</b>
                {/* `formatClock` takes milliseconds; dividing first turned four
                    minutes into 240 ms and printed 0:00. */}
                {formatClock(Math.max(0, tournament.nextLevelInMs))}
              </span>
            ) : null}
            <span>
              <b>{formatMessage("table.hud.handPlayers")}</b>
              {activePlayersInHand}
            </span>
            {tournament ? (
              <span>
                <b>{formatMessage("table.hud.tournamentPlayers")}</b>
                {tournament.tournamentPlayersRemaining}
              </span>
            ) : null}
          </aside>
          {/*
            The situation, stated (E27-013). The reported ace-five all-in could
            not be judged because none of this was on screen: eleven thousand
            chips means nothing without the blind beside it, and it is eleven
            big blinds -- push/fold depth -- which is what makes the shove
            ordinary. Short labels beside numbers, never prose; the explanation
            belongs in the feedback after the decision, not around the table.
          */}
          {mode === "training" ? (
            <aside
              className="training-context"
              aria-label={formatMessage("table.context.ariaLabel", {
                stack: formatChips(trainingContext.stackChips),
                bigBlinds: trainingContext.stackBigBlinds ?? 0,
                blinds: `${formatChips(trainingContext.smallBlind)}/${formatChips(trainingContext.bigBlind)}`,
                pot: formatChips(trainingContext.pot),
                toCall: formatChips(trainingContext.amountToCall),
                activePlayersInHand: trainingContext.activePlayersInHand,
              })}
            >
              <span>
                <b>{formatMessage("table.context.stack")}</b>
                {formatChips(trainingContext.stackChips)}
                {trainingContext.stackBigBlinds !== null ? (
                  <em>
                    {formatMessage("table.context.bigBlinds", {
                      count: trainingContext.stackBigBlinds,
                    })}
                  </em>
                ) : null}
              </span>
              <span>
                <b>{formatMessage("table.context.effective")}</b>
                {formatChips(trainingContext.effectiveStackChips)}
                {trainingContext.effectiveStackBigBlinds !== null ? (
                  <em>
                    {formatMessage("table.context.bigBlinds", {
                      count: trainingContext.effectiveStackBigBlinds,
                    })}
                  </em>
                ) : null}
              </span>
              <span>
                <b>{formatMessage("table.context.blinds")}</b>
                {formatChips(trainingContext.smallBlind)}/
                {formatChips(trainingContext.bigBlind)}
              </span>
              <span>
                <b>{formatMessage("table.context.activePlayers")}</b>
                {trainingContext.activePlayersInHand}
              </span>
              <span>
                <b>{formatMessage("table.context.dealtIn")}</b>
                {trainingContext.playersDealtIn}
              </span>
              <span>
                <b>{formatMessage("table.context.pot")}</b>
                {formatChips(trainingContext.pot)}
              </span>
              {trainingContext.amountToCall > 0 ? (
                <span>
                  <b>{formatMessage("table.context.toCall")}</b>
                  {formatChips(trainingContext.amountToCall)}
                </span>
              ) : null}
              {trainingContext.shortStacked ? (
                <span className="training-context__flag">
                  {formatMessage("table.context.pushFold")}
                </span>
              ) : null}
            </aside>
          ) : null}
          {/*
            The result stays up through the whole payout, not just the single
            `showdown` frame (E27-003). It used to be gated on `resultEvent`
            alone, so the moment the queue moved to `side-pot-formed` or
            `pot-awarded` the winner disappeared -- measured in the packaged
            build as the result being on screen for about one second while the
            chips it was describing were still moving. Those events *are* the
            result being paid out, so they belong to the same readable moment.
          */}
          {showdownAwards.length > 0 && (resultPhaseActive || arrivalVisible) ? (
            <aside className="showdown-result-strip" role="status" aria-live="polite" aria-atomic="true">
              <span>
                {showdownEvent
                  ? "Showdown result"
                  : handResultEvent || resultPhaseActive
                    ? // Still paying out: the hand is resolving, not history.
                      "Hand result"
                    : "Previous hand result"}
              </span>
              {showdownAwards.map((award) => {
                const winner = scenario.players.find((player) => player.id === award.playerId);
                const winnerName = winner?.seat === scenario.heroSeat ? "You" : (winner?.name ?? award.playerId);
                return (
                  <p key={`${award.potId}:${award.playerId}`}>
                    <b>{award.potId}</b> · <strong>{winnerName}</strong> wins {formatChips(award.amount)}
                    {award.hand ? ` with ${award.hand.displayName}` : ""}
                  </p>
                );
              })}
            </aside>
          ) : null}
          {/*
            A fold has an award but no public hand.  Only a genuine showdown
            gets this lifted five-card tableau, and every card in it comes from
            the engine's already-public award payload.
          */}
          {!isTwoDMode && showdownVisualActive && winningShowdownHands.length > 0 ? (
            <section className="showdown-tableau" aria-label="Winning poker hands">
              {winningShowdownHands.map((hand) => {
                const winner = scenario.players.find((player) => player.id === hand.playerId);
                const winnerName = winner?.seat === scenario.heroSeat ? "You" : (winner?.name ?? hand.playerId);
                return (
                  <div className="showdown-tableau__hand" key={`${hand.potId}:${hand.playerId}`}>
                    <header>
                      <strong>{hand.handName}</strong>
                      <span>{winnerName} wins {formatChips(hand.amount)}</span>
                    </header>
                    <div className="showdown-tableau__cards" aria-label={`${hand.handName} winning cards`}>
                      {hand.cards.map(({ card, source }, index) => (
                        <span
                          className={`showdown-tableau__card showdown-tableau__card--${source}`}
                          style={{ "--showdown-index": index } as CSSProperties}
                          key={cardLabel(card)}
                        >
                          <PlayingCard card={card} className="showdown-card is-winning" />
                        </span>
                      ))}
                    </div>
                    <small>Dealer presents the winning five</small>
                  </div>
                );
              })}
            </section>
          ) : null}
          {sidePotEvent ? (
            <aside className="side-pot-strip" role="status" aria-live="polite" aria-atomic="true">
              <span>{formatMessage("table.sidePot.label")}</span>
              <strong>{formatChips(sidePotEvent.amount)}</strong>
              <p>
                {formatMessage("table.sidePot.eligible", {
                  players: sidePotEvent.eligiblePlayerIds
                    .map((playerId) => scenario.players.find((player) => player.id === playerId)?.name ?? playerId)
                    .join(", "),
                })}
              </p>
              <small>
                Chips above an all-in player's cap form a separate pot. Only
                the eligible players can win it.
              </small>
            </aside>
          ) : null}
          {/*
            The persistent live-pot panel that used to sit here is gone
            (E27-002). It listed every pot and a full eligibility roster as
            standing prose, appeared before the hero had acted, and stayed up for
            the whole hand -- explaining in text what the felt should be showing
            in chips. Pot structure is now grouped chip stacks on the table (see
            `.pot-groups` below); the transient `side-pot-formed` announcement
            above still marks the moment a side pot appears, and the eligibility
            detail is available on demand rather than permanently.
          */}
          {allInEvent ? (
            <aside className="all-in-banner" role="status" aria-live="assertive" aria-atomic="true">
              <span>{formatMessage("table.allIn.label")}</span>
              <strong>
                {formatMessage("table.allIn.player", {
                  player:
                    allInPlayer?.seat === scenario.heroSeat
                      ? formatMessage("table.seat.you")
                      : (allInPlayer?.name ?? allInEvent.playerId),
                })}
              </strong>
              <small>{formatMessage("table.allIn.runoutHint")}</small>
            </aside>
          ) : null}
          {!isTwoDMode && allInRevealEvent ? (
            <>
            <section className="all-in-showdown-stage" aria-label="All-in hands revealed">
              {allInRevealEvent.reveals.map((reveal) => {
                const player = scenario.players.find((seat) => seat.id === reveal.playerId);
                return (
                  <div key={reveal.playerId} className="all-in-showdown-hand">
                    <b>{player?.seat === scenario.heroSeat ? "You" : (player?.name ?? reveal.playerId)}</b>
                    <span>{reveal.cards.map((card) => <PlayingCard key={cardLabel(card)} card={card} small className="all-in-reveal-card" />)}</span>
                  </div>
                );
              })}
            </section>
            <aside className="all-in-equity-strip" role="status" aria-live="polite" aria-atomic="true">
              <span>All-in showdown odds</span>
              {allInEquity ? allInEquity.players.map((player) => {
                const name = scenario.players.find((seat) => seat.id === player.playerId)?.name ?? player.playerId;
                const win = formatFixedDecimal((player.wins / allInEquity.simulations) * 100, 1);
                const tie = formatFixedDecimal((player.ties / allInEquity.simulations) * 100, 1);
                const lose = formatFixedDecimal((player.losses / allInEquity.simulations) * 100, 1);
                return (
                  <p key={player.playerId}>
                    <b>{name}</b> <strong>{formatFixedDecimal((displayedAllInEquity.get(player.playerId) ?? 0) * 100, 1)}%</strong>
                    <small> win {win}% · tie {tie}% · lose {lose}%</small>
                  </p>
                );
              }) : <p>Calculating public odds…</p>}
              <small>
                {allInEquity
                  ? `From ${allInEquity.unseenCards} unseen cards · ${allInEquity.simulations} simulations`
                  : "From the remaining unseen cards"}
              </small>
            </aside>
            </>
          ) : null}
          {actionError ? (
            <p className="table-action-alert" role="alert">
              <X size={16} aria-hidden="true" /> {actionError}
            </p>
          ) : null}
          {arrivalVisible && tournament && (
            <div className="room-progress-overlay" aria-live="polite">
              <div>
                <span>{formatMessage("table.arrival.progressLabel")}</span>
                <strong>
                  {formatMessage("table.arrival.handRemain", {
                    handNumber: tournament.handNumber,
                    tournamentPlayersRemaining:
                      tournament.tournamentPlayersRemaining,
                  })}
                </strong>
              </div>
              <i>
                <b
                  style={{
                    width: `${Math.max(
                      4,
                      ((tournament.fieldSize -
                        tournament.tournamentPlayersRemaining) /
                        Math.max(1, tournament.fieldSize - 1)) *
                        100,
                    )}%`,
                  }}
                />
              </i>
              <small>{formatMessage("table.arrival.settling")}</small>
            </div>
          )}
          {/*
            Depth layers behind the table. Each moves at a different fraction
            of the camera pan (see --camera-pan consumers in styles.css), which
            is what turns a flat sideways slide into a look. Purely decorative:
            no table state is conveyed here, and the whole group is hidden from
            assistive technology.
          */}
          {!isTwoDMode && (
            <div className="room-depth" aria-hidden="true">
              <div className="room-depth__far">
                <i /><i /><i /><i /><i /><i />
              </div>
              <div className="room-depth__mid">
                <i /><i /><i /><i />
              </div>
            </div>
          )}
          {!isTwoDMode && (
            <div className="room-lights" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          )}

          {/*
            Camera is controlled by drag and keyboard. Keep the button controls
            in the semantic DOM for assistive technology, but do not paint a
            persistent top-right table-view HUD over the felt.
          */}
          {!isTwoDMode && <div className="camera-controls" aria-label={formatMessage("table.camera.viewLabel")}>
            <button
              type="button"
              onClick={() => setCameraPan((value) => Math.max(-2, value - cameraStep))}
              aria-label={formatMessage("table.camera.left")}
            >
              <ChevronLeft size={17} />
            </button>
            {/*
              Recenter was previously keyboard-only (X), so a pointer player
              had no way back to a square view except panning by eye. It is
              also the live readout of where the camera is pointing, and it
              disables itself when already centred rather than disappearing.
            */}
            <button
              type="button"
              className="camera-controls__center"
              onClick={() => setCameraPan(0)}
              disabled={effectiveCameraPan === 0}
              aria-label={formatMessage("table.camera.center")}
            >
            </button>
            <button
              type="button"
              onClick={() => setCameraPan((value) => Math.min(2, value + cameraStep))}
              aria-label={formatMessage("table.camera.right")}
            >
              <ChevronRight size={17} />
            </button>
          </div>}

            <div
              ref={sceneElementRef}
              className="poker-scene motion-vestibular"
              {...(settings.spatialScene && !sceneRequestChanged && sceneAvailability.status === "ready"
                ? { "data-spatial-scene": "ready" }
                : {})}
            >
              {/*
                The 3D room, drawn behind everything else (E09-001 M1). It is
                lazily loaded so three.js never enters the initial bundle, and
                it is decorative: the DOM table below stays mounted and remains
                the interaction and accessibility surface, so nothing here can
                take the game away from a player whose device cannot draw it.
              */}
              {settings.spatialScene && (
                <DecorativeSceneErrorBoundary
                  onFailure={() =>
                    setSceneAvailability({ status: "failed", reason: "blocked" })
                  }
                >
                  <Suspense fallback={null}>
                    <TableScene3D
                      seats={sceneSnapshot.seats}
                      pot={sceneSnapshot.pot}
                      boardCards={sceneSnapshot.boardCards}
                      cameraPan={sceneSnapshot.cameraPan}
                      cameraView={sceneSnapshot.cameraView}
                      cameraMotion={sceneSnapshot.cameraMotion}
                      reducedMotion={sceneSnapshot.reducedMotion}
                      snapshot={sceneSnapshot}
                      suspended={paused}
                      onAvailabilityChange={setSceneAvailability}
                      onCameraFrame={onCameraFrame}
                    />
                  </Suspense>
                </DecorativeSceneErrorBoundary>
              )}
              {/*
                Skip lives over the table, where the player is already looking
                (E27-015). It used to be a small secondary button in the bottom
                dock next to the 2x toggle, which is why a player who folded
                reported being unable to find it -- and why the two were easy to
                confuse. They promise different things: 2x changes how fast the
                hand is presented, Skip goes to the outcome. So they are now
                different sizes, in different places, and worded differently.

                It renders whenever the hero has no decision to make, which is
                the same frame their fold is accepted, rather than waiting for
                the next presentation event to arrive.
              */}
              {!heroDecisionActive || action ? (
                <button
                  type="button"
                  className="skip-hand"
                  onPointerDown={() => {
                    // CDP/gamepad-style input can release after the current
                    // queue item completes. Start the deterministic skip on
                    // press so the button cannot turn into a later event's
                    // click target during that release.
                    if (presentationActive && tournament?.onSkipPresentation) {
                      tournament.onSkipPresentation();
                    }
                  }}
                  onMouseDown={() => {
                    // Electron's low-level CDP mouse path is guaranteed to
                    // produce mousedown; keep the same early capture for
                    // physical mouse input.
                    if (presentationActive && tournament?.onSkipPresentation) {
                      tournament.onSkipPresentation();
                    }
                  }}
                  onClick={() => {
                    if (presentationActive && tournament?.onSkipPresentation) {
                      tournament.onSkipPresentation();
                      return;
                    }
                    pendingTournamentAction.current?.finish();
                    pendingPresentationEvent.current?.finish();
                  }}
                  aria-label={formatMessage("table.spectator.skipAriaLabel")}
                >
                  <FastForward size={19} aria-hidden="true" />
                  <span>{formatMessage("table.spectator.skip")}</span>
                </button>
              ) : null}
              {chipTravel && !sceneReadyForPlaques && (
                <span
                  key={tournament?.presentationEvent?.id}
                  className={`chip-travel chip-travel--${chipTravel.direction}`}
                  aria-hidden="true"
                  style={{
                    "--chip-from-x": `${chipTravel.from[0]}%`,
                    "--chip-from-y": `${chipTravel.from[1]}%`,
                    "--chip-to-x": `${chipTravel.to[0]}%`,
                    "--chip-to-y": `${chipTravel.to[1]}%`,
                  } as CSSProperties}
                >
                  <ChipStack bet />
                </span>
              )}
              {dealerMoveEvent && !sceneReadyForPlaques && (
                <span
                  className="dealer-button-travel"
                  role="img"
                  aria-label="Dealer button moves to its next seat"
                  style={{
                    "--dealer-from-x": `${dealerMoveFrom[0]}%`,
                    "--dealer-from-y": `${dealerMoveFrom[1]}%`,
                    "--dealer-to-x": `${dealerMoveTo[0]}%`,
                    "--dealer-to-y": `${dealerMoveTo[1]}%`,
                  } as CSSProperties}
                >D</span>
              )}
            <div
              className={`poker-table ${
                tournament?.presentationEvent?.kind === "hole-cards-dealt"
                  ? "is-dealing-hole-cards"
                  : ""
              }`}
              data-table-hand-id={scenario.id}
              data-table-street={scenario.street}
              data-scene-pot={String(sceneSnapshot.pot)}
              /*
                The effective camera yaw step, so packaged evidence can prove
                pointer, keyboard, and controller reach identical camera states.
                Reading the recenter button's label instead would assert a
                translation, and the canvas is unreadable by design.
              */
              data-table-camera-pan={String(effectiveCameraPan)}
              /*
                Marks that the 3D room is drawing the furniture, so the DOM's
                own felt, chairs, and avatars can recede rather than being drawn
                on top of the same table a second time. Only decoration fades:
                names, stacks, bets, cards, and every control stay exactly where
                they were, because this layer is still the one the player clicks
                and the one assistive technology reads.
              */
              {...(settings.spatialScene && !sceneRequestChanged && sceneAvailability.status === "ready"
                ? { "data-spatial-scene": "ready" }
                : {})}
              {...(tournament
                ? { "data-table-state-version": tournament.sceneStateVersion }
                : {})}
            >
              <div className="felt-ring">
                <span className="felt-brand">{formatMessage("table.felt.brand")}</span>
                <div className="dealer">
                  <span className="dealer__head" />
                  <span className="dealer__body" />
                  <b>{formatMessage("table.felt.dealerLabel")}</b>
                </div>

                <div
                  className="table-readout"
                  role="img"
                  aria-label={`Pot ${formatChips(scenario.pot)}`}
                >
                  <strong>{formatChips(scenario.pot)}</strong>
                </div>

                <div
                  className="community-cards"
                  data-card-count={displayedBoard.length}
                  role="group"
                  aria-label={formatMessage("table.communityCards.ariaLabel")}
                >
                  {displayedBoard.map((card, index) => {
                    const boardCardIsWinning =
                      showdownVisualActive && winningCardLabels.has(cardLabel(card));
                    const boardCardIsEntering =
                      tournament?.presentationEvent?.kind === "board-card-dealt" &&
                      tournament.presentationEvent.cardIndex === index;
                    return (
                      <span
                        className={[
                          boardCardIsEntering ? "board-card-entering" : "",
                          boardCardIsWinning ? "board-card-winning" : "",
                        ].filter(Boolean).join(" ") || undefined}
                        key={`${card.rank}-${index}`}
                      >
                        <PlayingCard
                          card={card}
                          className={
                            showdownVisualActive
                              ? boardCardIsWinning
                                ? "showdown-card is-winning"
                                : "showdown-card is-unused"
                              : undefined
                          }
                        />
                      </span>
                    );
                  })}
                  {Array.from({ length: 5 - displayedBoard.length }).map(
                    (_, index) => (
                      <span
                        className="community-placeholder"
                        key={`placeholder-${index}`}
                      />
                    ),
                  )}
                </div>

                {/*
                  Pot structure as chips rather than a paragraph (E27-002).
                  With one pot this is the single centre pile it always was.
                  With side pots each pot becomes its own labelled pile, so a
                  player can watch which chips form which pot and, at the award,
                  which pile goes to whom -- the thing the old text panel was
                  trying to say. Amounts sit with their chips; eligibility is
                  carried by the accessible name rather than printed on the felt.
                */}
                <div
                  className={`pot-groups ${potGroups.length > 1 ? "pot-groups--split" : ""}`}
                  role="group"
                  aria-label={formatMessage("table.pot.groupsAriaLabel")}
                >
                  {potGroups.map((group) => (
                    <div
                      className={`pot-group pot-group--${group.kind}`}
                      key={group.id}
                      data-pot-kind={group.kind}
                      data-pot-amount={group.amount}
                    >
                      <div
                        className="center-pot"
                        aria-hidden="true"
                        data-chip-stacks={potChipStackCount(group.amount)}
                      >
                        {Array.from({
                          length: potChipStackCount(group.amount),
                        }).map((_, index) => (
                          <ChipStack bet key={index} />
                        ))}
                      </div>
                      {/*
                        Per-pile amounts appear only once the pot has actually
                        split. With a single pot the felt readout above already
                        says "Pot 125", and repeating it under the chips would
                        be the same number twice.
                      */}
                      {potGroups.length > 1 && (
                        <span className="pot-group__amount">
                          {formatChips(group.amount)}
                        </span>
                      )}
                      <span className="visually-hidden">
                        {group.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {tablePlayers.slice(0, 6).map((player, index) => {
              const presentation = seatPresentationUpdate(
                tournament?.presentationEvent,
                player.id,
              );
              const seatSceneSeat = sceneSeatByPlayerId.get(player.id);
              const projectionWidth = activeCameraFrame?.viewportWidth || sceneViewport.width;
              const projectionHeight = activeCameraFrame?.viewportHeight || sceneViewport.height;
              return (
                <PlayerSeat
                  key={player.id}
                  player={player}
                  position={seatPositions[index]}
                  bigBlind={scenario.blinds[1]}
                  isHero={player.seat === scenario.heroSeat}
                  dealer={player.seat === scenario.buttonSeat}
                  wonPot={
                    presentation.wonPot ||
                    (showdownVisualActive && showdownWinnerIds.has(player.id)) ||
                    (arrivalVisible &&
                      Boolean(tournament?.lastPotWinnerIds?.includes(player.id)))
                  }
                  recentAction={presentation.action}
                  recentActionLabel={presentation.label}
                  dealtCardCount={dealtCardCountForPlayer(player.id)}
                  justDealt={
                    tournament?.presentationEvent?.kind === "hole-cards-dealt"
                  }
                  isActing={scenario.actingPlayerId === player.id}
                  eliminated={presentation.eliminated}
                  terminalFolded={skipTerminalFoldedPlayerIds.has(player.id)}
                  positionLabel={positionLabelForSeat(player.seat)}
                  revealedCards={revealedCardsByPlayer.get(player.id)}
                  winningCardLabels={winningCardLabels}
                  showdownRevealed={
                    isTwoDMode &&
                    showdownVisualActive &&
                    revealedCardsByPlayer.has(player.id)
                  }
                  allInRevealed={
                    isTwoDMode && allInRevealPlayerIds.has(player.id)
                  }
                  allInRevealBeat={allInRevealBeat}
                  allInWinProbability={
                    isTwoDMode && allInRevealPlayerIds.has(player.id)
                      ? displayedAllInEquity.get(player.id)
                      : undefined
                  }
                  sceneSeat={seatSceneSeat}
                  railAnchor={
                    sceneReadyForPlaques && seatSceneSeat
                      ? seatPlaqueViewportAnchor(
                          seatSceneSeat.relativeSeat,
                          effectiveCameraPan,
                          projectionWidth,
                          projectionHeight,
                          heroStationIndexForTable,
                          cameraZoom,
                          settings.cameraView,
                      )
                      : undefined
                  }
                  stackAnchor={
                    sceneReadyForPlaques && seatSceneSeat
                      ? activeCameraFrame
                        ? seatStackAmountViewportAnchorFromCamera(
                            seatSceneSeat.relativeSeat,
                            projectionWidth,
                            projectionHeight,
                            heroStationIndexForTable,
                            activeCameraFrame,
                            player.stack,
                          )
                        : seatStackAmountViewportAnchor(
                            seatSceneSeat.relativeSeat,
                            effectiveCameraPan,
                            projectionWidth,
                            projectionHeight,
                            heroStationIndexForTable,
                            cameraZoom,
                            settings.cameraView,
                            player.stack,
                          )
                      : undefined
                  }
                  betAnchor={
                    sceneReadyForPlaques && seatSceneSeat
                      ? activeCameraFrame
                        ? seatBetViewportAnchorFromCamera(
                            seatSceneSeat.relativeSeat,
                            projectionWidth,
                            projectionHeight,
                            heroStationIndexForTable,
                            activeCameraFrame,
                          )
                        : seatBetViewportAnchor(
                            seatSceneSeat.relativeSeat,
                            effectiveCameraPan,
                            projectionWidth,
                            projectionHeight,
                            heroStationIndexForTable,
                            cameraZoom,
                            settings.cameraView,
                          )
                      : undefined
                  }
                  displayName={isTwoDMode ? twoDPlayerIdentities.get(player.id)?.displayName : undefined}
                  avatarModel={isTwoDMode ? twoDPlayerIdentities.get(player.id)?.model : undefined}
                  showCurrentBet={isTwoDMode}
                />
              );
            })}

            {/*
              Gated on an active drag, not on a progress number alone. Any
              non-drag fold path -- button, keyboard, controller -- must never
              raise a gesture affordance (E27-001).
            */}
            {shouldShowFoldRelease(heroFoldState) && (
              <div
                className={`fold-release-zone ${
                  isFoldReleaseArmed(heroFoldState) ? "is-ready" : ""
                }`}
              >
                <span>
                  {isFoldReleaseArmed(heroFoldState)
                    ? formatMessage("table.fold.release")
                    : formatMessage("table.fold.keepDragging")}
                </span>
                <i style={{ width: `${foldProgress}%` }} />
              </div>
            )}

            <button
              className={`hero-hole-cards hero-hole-cards-visual ${peeked ? "is-peeked" : ""} ${
                dragging ? "is-dragging" : ""
              } ${heroFolded ? "is-folded" : ""} ${
                heroAllInRevealed ? "is-all-in-revealed" : ""
              } ${
                showdownVisualActive && showdownHeroRevealed
                  ? "is-showdown-revealed"
                  : ""
              } ${
                heroHoleCardHitBounds ? "has-spatial-hit-target" : ""
              }`}
              type="button"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => endPointerGesture(event)}
              onPointerCancel={(event) => endPointerGesture(event, true)}
              style={
                {
                  // The drag drives the offset while dragging; once folded the
                  // cards sit at the full offset regardless of how the fold was
                   // submitted, so button and gesture folds look the same.
                   "--fold-offset": `${foldOffsetProgress(heroFoldState) * -0.55}px`,
                   ...(heroHoleCardHitBounds
                     ? {
                         "--hero-card-hit-left": `${heroHoleCardHitBounds.xMin}%`,
                         "--hero-card-hit-top": `${heroHoleCardHitBounds.yMin}%`,
                         "--hero-card-hit-width": `${heroHoleCardHitBounds.xMax - heroHoleCardHitBounds.xMin}%`,
                         "--hero-card-hit-height": `${heroHoleCardHitBounds.yMax - heroHoleCardHitBounds.yMin}%`,
                       }
                     : {}),
                 } as CSSProperties
              }
              aria-label={formatMessage("table.holeCards.ariaLabel", {
                state: peeked
                  ? formatMessage("table.holeCards.hide")
                  : formatMessage("table.holeCards.peek"),
              })}
              // A mucked hand is not interactive: no peeking, no dragging it
              // back onto the table for the rest of the hand.
              disabled={Boolean(action) || heroDealtCardCount === 0 || heroFolded}
            >
              {heroAllInWinProbability !== undefined && (
                <span className="all-in-win-probability">
                  {formatFixedDecimal(heroAllInWinProbability * 100, 1)}%
                </span>
              )}
              <span className="hero-hole-cards__cards">
                {scenario.heroCards.slice(0, heroDealtCardCount).map((card, index) => (
                  <span className="hero-card-wrap" key={cardLabel(card)}>
                    <PlayingCard
                      card={card}
                      hidden={!peeked && !showdownHeroRevealed}
                      className={[
                        "deal-card",
                        `deal-card--${index + 1}`,
                        showdownHeroRevealed
                          ? winningCardLabels.has(cardLabel(card))
                            ? "showdown-card is-winning"
                            : "showdown-card is-unused"
                          : "",
                        heroAllInRevealed && allInRevealBeat
                          ? "all-in-reveal-card"
                          : "",
                      ].filter(Boolean).join(" ")}
                    />
                    {(peeked || showdownHeroRevealed) && index === heroDealtCardCount - 1 && (
                      <small>{cardLabel(card)}</small>
                    )}
                  </span>
                ))}
              </span>
              {!action && (
                <span className="peek-label">
                  {peeked ? <EyeOff size={14} /> : <Eye size={14} />}
                  {peeked
                    ? formatMessage("table.holeCards.hideCardsLabel")
                    : formatMessage("table.holeCards.peekInstructions")}
                </span>
              )}
            </button>
            <button
              className={`hero-card-control ${peeked ? "is-peeked" : ""} ${heroFolded ? "is-folded" : ""}`}
              type="button"
              data-card-control="hero"
              onClick={(event) => {
                event.stopPropagation();
                if (!action && cardsDealt && !heroFolded) {
                  setPeeked((value) => !value);
                }
              }}
              aria-label={formatMessage("table.holeCards.ariaLabel", {
                state: peeked
                  ? formatMessage("table.holeCards.hide")
                  : formatMessage("table.holeCards.peek"),
              })}
              disabled={Boolean(action) || !cardsDealt || heroFolded}
            >
              {peeked ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>
                {peeked
                  ? formatMessage("table.holeCards.hideCardsLabel")
                  : formatMessage("table.holeCards.peekInstructions")}
              </span>
            </button>
          </div>

          <div className="action-context">
            <div>
              <span>{scenario.prompt}</span>
              <strong>
                {formatMessage("table.actionContext.toCall", {
                  amount: formatChips(scenario.amountToCall),
                })}
              </strong>
            </div>
            <button
              type="button"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <History size={15} /> {formatMessage("table.history.button")}
            </button>
          </div>

          {historyOpen && (
            <aside
              className="hand-history-popover"
              aria-label={formatMessage("table.history.ariaLabel")}
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              ref={historyRef}
            >
              <header>
                <strong>{formatMessage("table.history.heading")}</strong>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label={formatMessage("table.history.close")}
                >
                  <X size={15} />
                </button>
              </header>
              {tournament?.actionHistory.length ? (
                <ol>
                  {tournament.actionHistory.map((entry, index) => (
                    <li key={`${entry}-${index}`}>{entry}</li>
                  ))}
                </ol>
              ) : (
                <p>{formatMessage("table.history.empty")}</p>
              )}
            </aside>
          )}

          {!action && !presentationActive && heroDecisionActive ? (
            <div className="action-dock">
              <button
                className="action-button action-button--fold"
                type="button"
                disabled={
                  mode === "training"
                    ? !isTrainingActionLegal(ratedScenario, "fold")
                    : !tournament?.legalActions.fold || presentationActive
                }
                onClick={() => handleAction("fold")}
              >
                <span>F</span>
                <strong>{formatMessage("table.action.fold")}</strong>
              </button>
              <button
                className="action-button action-button--call"
                type="button"
                disabled={
                  mode === "training"
                    ? !isTrainingActionLegal(ratedScenario, callAction)
                    : callAction === "call"
                      ? !tournament?.legalActions.call || presentationActive
                      : !tournament?.legalActions.check || presentationActive
                }
                onClick={() => handleAction(callAction)}
                aria-label={callControlAriaLabel}
              >
                <span>C</span>
                <strong>{callControlLabel}</strong>
              </button>
              <button
                className={`action-button action-button--raise ${
                  raiseOpen ? "is-active" : ""
                }`}
                type="button"
                disabled={!canRaise || presentationActive}
                onClick={() => setRaiseOpen((value) => !value)}
              >
                <span>R</span>
                <strong>{formatMessage("table.action.raiseTo")}</strong>
              </button>
            </div>
          ) : (
            <div className="spectator-dock">
              <span>
                <Check size={16} />{" "}
                {presentationActive
                  ? presentationEventLabel(tournament?.presentationEvent as TournamentPresentationEvent)
                  : action
                    ? formatMessage("table.spectator.actionLocked", { action })
                    : "Waiting for opponent action"}
              </span>
              <div>
                <button
                  type="button"
                  className={speed === 2 ? "is-active" : ""}
                  onClick={() => setSpeed(speed === 2 ? 1 : 2)}
                >
                  <FastForward size={15} />{" "}
                  {speed === 2
                    ? formatMessage("table.spectator.returnTo1x")
                    : formatMessage("table.spectator.speed2x")}
                </button>
              </div>
            </div>
          )}

          {raiseOpen && !action && (
            <div
              className="bet-composer"
              role={isTwoDMode ? "region" : "dialog"}
              aria-modal={isTwoDMode ? undefined : true}
              aria-label={formatMessage("table.raise.heading")}
              tabIndex={-1}
              ref={raiseComposerRef as React.RefObject<HTMLDivElement>}
            >
              <header>
                <span>
                  <HandCoins size={17} /> {formatMessage("table.raise.heading")}
                </span>
                <button
                  type="button"
                  onClick={() => setRaiseOpen(false)}
                  aria-label={formatMessage("table.raise.close")}
                >
                  <X size={16} />
                </button>
              </header>
              <div className="bet-presets">
                {raisePresets.map((amount, index) => (
                  <button
                    key={amount}
                    type="button"
                    className={raiseAmount === amount ? "is-active" : ""}
                    onClick={() => {
                      setRaiseAmount(amount);
                      gameAudio.play("click");
                    }}
                  >
                    {amount === allInAmount
                      ? formatMessage("table.raise.presetAllIn")
                      : index === 0
                        ? formatMessage("table.raise.presetMin")
                        : formatMessage("table.raise.presetPercentPot", {
                            percent: Math.round((amount / scenario.pot) * 100),
                          })}
                  </button>
                ))}
              </div>
              <div className="bet-slider-row">
                <input
                  type="range"
                  min={minimumRaise}
                  max={allInAmount}
                  step="any"
                  value={raiseAmount}
                  onChange={(event) =>
                    setRaiseAmount(
                      snapRaiseSliderToAmount(Number(event.target.value), {
                        minimumRaiseTo: minimumRaise,
                        allInTo: allInAmount,
                        chipStep: scenario.blinds[1],
                      }),
                    )
                  }
                  aria-label={formatMessage("table.raise.amountAriaLabel")}
                />
                <output>
                  <strong>{formatChips(raiseAmount)}</strong>
                  <span>
                    {formatMessage("table.raise.bbSuffix", {
                      bb: Math.round(raiseAmount / scenario.blinds[1]),
                    })}
                  </span>
                </output>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    handleAction(raiseAmount >= allInAmount ? "all-in" : "raise")
                  }
                >
                  {raiseAmount >= allInAmount
                    ? formatMessage("table.raise.confirmAllIn")
                    : formatMessage("table.raise.raiseToAmount", {
                        amount: formatChips(raiseAmount),
                      })}
                </button>
              </div>
            </div>
          )}
        </section>

        {action && mode === "training" && gradedAttempt ? (
          <FeedbackPanel
            action={action}
            graded={gradedAttempt}
            mathAttempted={gradedAttempt.result.mathAnswer !== undefined}
            onNext={() => onNextScenario(scenario.id)}
            onReview={resetHand}
          />
        ) : mode === "training" ? (
          <MathPanel
            scenario={ratedScenario}
            answer={mathAnswer}
            error={mathError}
            result={mathResult}
            mathElo={progress.mathElo}
            onAnswer={(nextAnswer) => {
              setMathAnswer(nextAnswer);
              if (mathError) setMathError(undefined);
            }}
            onFocus={beginMath}
            onSubmit={submitMath}
          />
        ) : isTwoDMode ? null : (
          <ModeSidePanel
            mode={mode}
            scenario={scenario}
            tournament={tournament!}
          />
        )}
      </div>

      {activePrompt && !paused ? (
        <ContextCoachPanel
          prompt={activePrompt}
          onGotIt={() => {
            const next = markContextualPromptSeen(
              coachState,
              activePrompt.id,
            );
            updateCoachState(next);
            setActivePrompt(null);
          }}
          onTurnOff={() =>
            updateCoachState({ ...coachState, enabled: false })
          }
        />
      ) : null}

      {resumeRecap && !paused ? (
        <aside
          className="resume-recap"
          role="status"
          aria-live="polite"
          aria-labelledby="resume-recap-title"
        >
          <h2 id="resume-recap-title">{resumeRecap.title}</h2>
          <ul>
            {resumeRecap.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setResumeRecap(null)}>
            {formatMessage("common.continue")}
          </button>
        </aside>
      ) : null}

      {paused && (
        <div className="pause-scrim" role="presentation">
          <section
            className="pause-menu"
            role="dialog"
            ref={pauseDialogRef}
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="pause-title"
          >
            <p className="eyebrow">{formatMessage("table.pause.eyebrow")}</p>
            <h2 id="pause-title">
              {pausePage === "menu"
                ? formatMessage("table.pause.menuTitle")
                : pausePage === "controls"
                  ? formatMessage("table.pause.controlsTitle")
                  : pausePage === "settings"
                    ? formatMessage("table.pause.settingsTitle")
                    : pausePage === "remap"
                      ? formatMessage("table.pause.remapTitle")
                      : formatMessage("table.pause.referenceTitle")}
            </h2>

            {pausePage === "menu" ? (
              <div className="pause-menu__actions">
                <button
                  className="primary-button"
                  type="button"
                  autoFocus
                  onClick={() => setPaused(false)}
                >
                  {formatMessage("table.pause.resume")}
                </button>
                <button type="button" onClick={() => setPausePage("controls")}>
                  {formatMessage("table.pause.controlsLink")}
                </button>
                <button type="button" onClick={() => setPausePage("settings")}>
                  {formatMessage("common.settings")}
                </button>
                <button type="button" onClick={() => setPausePage("reference")}>
                  {formatMessage("table.pause.referenceLink")}
                </button>
                <label className="pause-menu__coach-toggle">
                  <input
                    type="checkbox"
                    checked={coachState.enabled}
                    onChange={(event) =>
                      updateCoachState({
                        ...coachState,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  {formatMessage("table.pause.showTips")}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    updateCoachState(resetContextualPromptState());
                    setActivePrompt(null);
                    setPaused(false);
                  }}
                >
                  {formatMessage("table.pause.replayTips")}
                </button>
                {mode === "training" ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetHand();
                      setPausePage("menu");
                      setPaused(false);
                    }}
                  >
                    {formatMessage("table.pause.restartPractice")}
                  </button>
                ) : null}
                <button className="pause-menu__leave" type="button" onClick={onExit}>
                  {tournament
                    ? formatMessage("table.pause.leaveTournament")
                    : formatMessage("table.pause.leavePractice")}
                </button>
              </div>
            ) : pausePage === "controls" ? (
              <>
                <dl className="pause-reference-grid">
                  <div><dt>F</dt><dd>{formatMessage("table.action.fold")}</dd></div>
                  <div><dt>C</dt><dd>{formatMessage("table.controls.checkCall")}</dd></div>
                  <div><dt>R</dt><dd>{formatMessage("table.controls.customRaise")}</dd></div>
                  <div><dt>2 / 5 / 3</dt><dd>{formatMessage("table.controls.quickRaiseSizes")}</dd></div>
                  <div><dt>P / A</dt><dd>{formatMessage("table.controls.potAllIn")}</dd></div>
                  <div><dt>Space</dt><dd>{formatMessage("table.controls.peekHide")}</dd></div>
                  <div><dt>Q / E / X</dt><dd>{formatMessage("table.controls.cameraLookDesc")}</dd></div>
                  <div><dt>[ / ]</dt><dd>{formatMessage("table.controls.opponentSpeedDesc")}</dd></div>
                </dl>
                <p className="pause-menu__hint">
                  {formatMessage("table.controls.controllerHint")}
                </p>
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("remap")}
                >
                  {formatMessage("table.pause.remapLink")}
                </button>
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("menu")}
                >
                  {formatMessage("table.pause.back")}
                </button>
              </>
            ) : pausePage === "remap" ? (
              <ControlsRemapPanel
                controlBindings={settings.controlBindings}
                onChange={(next) =>
                  onSettingsChange({ ...settings, controlBindings: next })
                }
                onClose={() => setPausePage("controls")}
              />
            ) : pausePage === "settings" ? (
              <>
                <div className="pause-settings">
                  <label>
                    <span>
                      {formatMessage("table.settings.masterVolumeLabel")}{" "}
                      <b>{settings.masterVolume}%</b>
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.masterVolume}
                      aria-label={formatMessage("table.settings.masterVolumeLabel")}
                      onChange={(event) =>
                        onSettingsChange({
                          ...settings,
                          masterVolume: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label className="pause-settings__toggle">
                    <input
                      type="checkbox"
                      checked={settings.muted}
                      onChange={(event) =>
                        onSettingsChange({
                          ...settings,
                          muted: event.target.checked,
                        })
                      }
                    />
                    {formatMessage("table.settings.muteAll")}
                  </label>
                  <label className="pause-settings__toggle">
                    <input
                      type="checkbox"
                      checked={settings.reducedMotion}
                      onChange={(event) =>
                        onSettingsChange({
                          ...settings,
                          reducedMotion: event.target.checked,
                        })
                      }
                    />
                    {formatMessage("table.settings.reduceMotion")}
                  </label>
                  <label className="pause-settings__toggle">
                    <input
                      type="checkbox"
                      checked={settings.colorAssist}
                      onChange={(event) =>
                        onSettingsChange({
                          ...settings,
                          colorAssist: event.target.checked,
                        })
                      }
                    />
                    {formatMessage("table.settings.highContrast")}
                  </label>
                </div>
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("menu")}
                >
                  {formatMessage("table.pause.back")}
                </button>
              </>
            ) : (
              <>
                {/* Shared with the menu-reachable reference screen so the
                    two can never drift apart. */}
                <PokerReferenceContent />
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("menu")}
                >
                  {formatMessage("table.pause.back")}
                </button>
              </>
            )}
            <small className="pause-menu__hint">{formatMessage("table.pause.escHint")}</small>
          </section>
        </div>
      )}

      {false && <footer className="table-footer-removed">
        {gamepadActive ? (
          <span className="table-footer__controller">
            <b>A</b> {formatMessage("table.footer.checkCall")} · <b>X</b>{" "}
            {formatMessage("table.action.fold")} · <b>Y</b>{" "}
            {formatMessage("table.footer.raise")} · <b>LB</b>{" "}
            {formatMessage("table.footer.peek")}
            · <b>View</b> {formatMessage("table.footer.pause")} · <b>D-pad</b>{" "}
            {formatMessage("table.footer.camera")}
          </span>
        ) : null}
        <span>
          <b>Space</b> {formatMessage("table.footer.peekCards")}
        </span>
        <span>
          <b>F</b> {formatMessage("table.action.fold")}
        </span>
        <span>
          <b>C</b> {formatMessage("table.footer.call")}
        </span>
        <span>
          <b>R</b> {formatMessage("table.footer.raise")}
        </span>
        <span>
          <b>2 / 5 / 3</b> {formatMessage(`table.footer.quick${"Raise"}`)}
        </span>
        <span>
          <b>A</b> {formatMessage("table.raise.presetAllIn")}
        </span>
        <span>
          <b>H</b> {formatMessage("table.footer.history")}
        </span>
        <span>
          <b>Q / E / X</b> {formatMessage("table.footer.camera")}
        </span>
      </footer>}
    </div>
  );
}
