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
  Info,
  Lightbulb,
  Pause,
  RotateCcw,
  Sigma,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  trainingScenarios,
  type RatedTrainingScenario,
} from "../data/trainingScenarios";
import type { BettingActionType, LegalActionSet } from "../engine";
import {
  cardAriaLabel,
  cardLabel,
  formatChips,
  formatFixedDecimal,
} from "../lib/format";
import { gameAudio } from "../lib/audio";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
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
import { createPresentationEventDelay } from "../lib/tournamentPresentationClock";
import type {
  Card,
  GameMode,
  GameSettings,
  PlayerProgress,
  PokerAction,
  SeatPlayer,
  TrainingScenario,
} from "../types/poker";
import type { TrainingPresentationCheckpoint } from "../lib/trainingCheckpoint";

interface TournamentTableControls {
  legalActions: LegalActionSet;
  onAction: (request: HeroTournamentAction) => void;
  /** True only while the engine is waiting for a legal hero action. */
  heroDecision?: boolean;
  /** The one public event currently being presented, if the table is busy. */
  presentationEvent?: TournamentPresentationEvent;
  onPresentationEventComplete?: () => void;
  onSkipPresentation?: () => void;
  kind: "career" | "timed";
  /** Monotonic authoritative state revision; never a React subtree key. */
  sceneStateVersion: number;
  handNumber: number;
  fieldSize: number;
  playersRemaining: number;
  elapsedMs: number;
  durationMs?: number;
  actionHistory: string[];
  showArrival: boolean;
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
  lastPotAwards?: readonly { playerId: string; amount: number }[];
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
    case "side-pot-formed":
      return `Side pot formed: ${formatChips(event.amount)}`;
    case "pot-awarded":
      return `Pot awarded: ${formatChips(event.amount)}`;
    case "eliminated":
      return "Player eliminated";
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

export interface SeatPresentationUpdate {
  action?: BettingActionType;
  label?: string;
  wonPot?: boolean;
  eliminated?: boolean;
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
  if (event.kind === "pot-awarded" && event.playerId === playerId) {
    return { label: `Wins ${formatChips(event.amount)}`, wonPot: true };
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

const suitGlyph: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

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

/** Accessible copy for the persistent stack HUD, announced when it changes. */
export function heroStackAriaLabel(stack: number): string {
  return `Your remaining stack: ${formatChips(stack)} chips`;
}

function PlayingCard({
  card,
  hidden = false,
  small = false,
}: {
  card: Card;
  hidden?: boolean;
  small?: boolean;
}) {
  if (hidden) {
    return (
      <span
        className={`playing-card playing-card--back ${small ? "playing-card--small" : ""}`}
        role="img"
        aria-label={formatMessage("cards.faceDown")}
      >
        <i />
      </span>
    );
  }

  return (
    <span
      className={`playing-card playing-card--${card.suit} ${
        small ? "playing-card--small" : ""
      }`}
      role="img"
      aria-label={cardAriaLabel(card)}
    >
      <b>{card.rank}</b>
      <i>{suitGlyph[card.suit]}</i>
    </span>
  );
}

function ChipStack({ bet = false }: { bet?: boolean }) {
  return (
    <span className={`chip-stack ${bet ? "chip-stack--bet" : ""}`} aria-hidden>
      <i />
      <i />
      <i />
      {!bet && <i />}
    </span>
  );
}

interface PlayerSeatProps {
  dealer: boolean;
  isHero: boolean;
  player: SeatPlayer;
  position: (typeof seatPositions)[number];
  wonPot?: boolean;
  /** Only a public action can drive a character gesture; no card data is read. */
  recentAction?: BettingActionType;
  recentActionLabel?: string;
  cardsDealt: boolean;
  isActing: boolean;
  eliminated?: boolean;
  positionLabel?: string;
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

function PlayerSeat({
  dealer,
  isHero,
  player,
  position,
  wonPot = false,
  recentAction,
  recentActionLabel,
  cardsDealt,
  isActing,
  eliminated = false,
  positionLabel,
}: PlayerSeatProps) {
  const isMucking = player.status === "folded" || recentAction === "fold";
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
  const isShowingCards = !isHero && !isOut && cardsDealt;
  const shouldHoldCards = isShowingCards && player.status === "active" && !isMucking;
  const gesture = wonPot
    ? "win"
    : isAllIn
      ? "all-in"
      : isFolded
        ? "fold"
        : player.bet > 0 || recentAction === "bet" || recentAction === "raise"
          ? "bet"
          : recentAction === "check"
            ? "check"
            : recentAction === "call"
              ? "call"
              : shouldHoldCards
                ? "hold"
                : undefined;

  return (
    <div
      className={`player-seat player-seat--${position} ${
        isHero ? "player-seat--hero" : ""
      } ${isFolded ? "is-folded" : ""} ${isAllIn ? "is-all-in" : ""} ${
        isOut ? "is-out" : ""
      } ${wonPot ? "is-winner" : ""}`}
      role="group"
      aria-label={playerSeatAriaLabel({
        isHero,
        name: player.name,
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
        <div className="opponent-cards" aria-hidden="true">
          {shouldHoldCards && <i className="opponent-card-hand" aria-hidden="true" />}
          <PlayingCard
            card={{ rank: "A", suit: "spades" }}
            hidden
            small
          />
          <PlayingCard
            card={{ rank: "K", suit: "hearts" }}
            hidden
            small
          />
        </div>
      )}
      <div className="seat-avatar" aria-hidden="true">
        <span>{player.name.slice(0, 1)}</span>
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
      <div className="seat-label" aria-hidden="true">
        <strong>{isHero ? formatMessage("table.seat.you") : player.name}</strong>
        <span>
          <ChipStack /> {formatChips(player.stack)}
        </span>
      </div>
      {!isHero && (
        <div className="seat-bet" aria-hidden="true">
          <ChipStack bet />
          <span>In</span>
          <b>{formatChips(player.bet)}</b>
        </div>
      )}
      {isFolded && (
        <span className="seat-state" aria-hidden="true">
          {formatMessage("table.seat.folded")}
        </span>
      )}
      {player.status === "all-in" && !wonPot && (
        <span className="seat-state seat-state--all-in" aria-hidden="true">
          {formatMessage("table.seat.allIn")}
        </span>
      )}
      {isOut && (
        <span className="seat-state seat-state--out" aria-hidden="true">
          {formatMessage("table.seat.out")}
        </span>
      )}
      {wonPot && (
        <span className="seat-state seat-state--winner" aria-hidden="true">
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
  const lower = question.correctValue - question.tolerance;
  const upper = question.correctValue + question.tolerance;
  const title = question.topic
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
  const resultClass = result?.correct ? "correct" : "incorrect";
  const answerPlaceholder =
    question.unit === "%"
      ? formatMessage("table.math.placeholder.percent")
      : question.unit === "ratio"
        ? formatMessage("table.math.placeholder.ratio")
        : question.unit === "outs"
          ? formatMessage("table.math.placeholder.outs")
          : formatMessage("table.math.placeholder.chips");

  return (
    <aside className="training-panel" aria-label={formatMessage("table.math.ariaLabel")}>
      <div className="training-panel__heading">
        <span className="training-panel__icon">
          <Sigma size={20} />
        </span>
        <div>
          <p className="eyebrow">{formatMessage("table.math.eyebrow")}</p>
          <h2>{title}</h2>
        </div>
        <span className="xp-chip">
          {formatMessage("table.math.eloChip", { mathElo })}
        </span>
      </div>

      <div className="question-context">
        <span>
          <Info size={14} /> {formatMessage("table.math.useEstimate")}
        </span>
        <p>{scenario.prompt}</p>
      </div>

      <label className="math-input">
        <span>{question.prompt}</span>
        <div>
          <input
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
      </label>

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
            <small>
              {formatMessage("table.math.acceptedEstimate", {
                lower: formatFixedDecimal(lower, 2),
                upper: formatFixedDecimal(upper, 2),
                unit: question.unit,
              })}
            </small>
          </div>
        </div>
      ) : (
        <button
          className="secondary-button secondary-button--wide"
          type="button"
          onClick={onSubmit}
          disabled={answer.trim() === ""}
        >
          {formatMessage("table.math.checkEstimate")}
        </button>
      )}

      <div className="training-hint">
        <Lightbulb size={16} />
        <span>
          <strong>{formatMessage("table.math.hintTitle")}</strong>
          {formatMessage("table.math.tolerance", {
            tolerance: question.tolerance,
            unit: question.unit,
          })}
        </span>
      </div>
    </aside>
  );
}

export interface FeedbackPanelProps {
  action: PokerAction;
  graded: GradedTrainingAttempt;
  mathAttempted: boolean;
  scenario: RatedTrainingScenario;
  onNext: () => void;
  onReview: () => void;
}

/** Exported so its rendered markup (not raw source copy) can be asserted directly. */
export function FeedbackPanel({
  action,
  graded,
  mathAttempted,
  scenario,
  onNext,
  onReview,
}: FeedbackPanelProps) {
  const actionCorrect = graded.action.correct;
  const actionPositive = actionCorrect || graded.action.close;
  const decisionDelta = graded.decisionEloDelta;
  const mathDelta = mathAttempted ? graded.mathEloDelta : 0;
  const mathEloAfter = mathAttempted
    ? graded.mathEloAfter
    : graded.mathEloAfter - graded.mathEloDelta;
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
  const mathLabel = !mathAttempted
    ? formatMessage("table.feedback.math.skipped")
    : graded.math.correct
      ? formatMessage("table.feedback.math.correct")
      : graded.math.close
        ? formatMessage("table.feedback.math.nearMiss")
        : formatMessage("table.feedback.math.incorrect");

  return (
    <aside className="feedback-panel" aria-live="polite">
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

      <div className="rating-delta">
        <span>{formatMessage("table.feedback.decisionEloLabel")}</span>
        <strong>{signed(decisionDelta)}</strong>
        <small>
          {formatMessage("table.feedback.eloSummary", {
            decisionEloAfter: graded.decisionEloAfter,
            mathEloAfter,
            mathDelta: signed(mathDelta),
          })}
        </small>
      </div>

      <p className="feedback-lead">
        {actionCorrect || graded.action.close
          ? scenario.actionReason
          : formatMessage("table.feedback.chooseRegret", {
              action: action.replace("-", " "),
              regret: formatFixedDecimal(graded.action.regret, 2),
              bestAction: graded.action.bestAction,
            })}
      </p>

      <div className="feedback-math">
        <span className="feedback-math__formula">
          <b>{formatFixedDecimal(scenario.mathQuestion.correctValue, 2)}</b>
          <i>±</i>
          <strong>
            {scenario.mathQuestion.tolerance}
            {scenario.mathQuestion.unit}
          </strong>
        </span>
        <p>{scenario.mathQuestion.explanation}</p>
      </div>

      <div className="feedback-tags">
        <span>
          {formatMessage("table.feedback.actionLabel")} <b>{action}</b>
        </span>
        <span>
          {formatMessage("table.feedback.mathLabel")} <b>{mathLabel}</b>
        </span>
        <span>
          {formatMessage("table.feedback.timeLabel")}{" "}
          <b>{formatFixedDecimal(graded.timing.totalMs / 1000, 1)}s</b>
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
            playersRemaining: tournament.playersRemaining,
            fieldSize: tournament.fieldSize,
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
  const pendingTournamentAction = useRef<FreezableDelay | null>(null);
  const pendingPresentationEvent = useRef<FreezableDelay | null>(null);
  const actionGateRef = useRef(createTableActionGate());
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
  const gamepadActive = useIsGamepadActive();
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const elapsedStartedAt = useRef<number | null>(null);
  const mathStartedAt = useRef<number | null>(null);
  const mathElapsedMs = useRef(0);
  const pauseStartedAt = useRef<number | null>(null);
  // Combined Elo captured when this table was entered. The table remounts per
  // scenario/hand, so this baseline is stable within a scenario and lets the
  // coach detect the first Elo change once a graded attempt resolves.
  const eloBaseline = useRef(progress.decisionElo + progress.mathElo);
  const ratedScenario = scenario as RatedTrainingScenario;
  const trainingMeta =
    "training" in scenario ? scenario.training : undefined;
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

  const offerPrompt = useCallback(
    (id: ContextualPromptId) => {
      if (activePrompt) return;
      const prompt = nextContextualPrompt(coachState, [id]);
      if (prompt) setActivePrompt(prompt);
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
        playersRemaining: tournament?.playersRemaining,
        qualifyingPlaces: tournament?.qualifyingPlaces,
        eloBaseline: eloBaseline.current,
        eloCurrent: progress.decisionElo + progress.mathElo,
      }),
    );
    if (prompt) setActivePrompt(prompt);
  }, [
    activePrompt,
    coachState,
    scenario,
    tournament?.actionHistory,
    tournament?.legalActions,
    tournament?.openingBigBlind,
    tournament?.fieldSize,
    tournament?.playersRemaining,
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
    playersRemaining?: number;
    handNumber?: number;
    lastAction?: string;
  }>({ pot: scenario.pot, amountToCall: scenario.amountToCall, street: scenario.street });
  recapDataRef.current = {
    pot: scenario.pot,
    amountToCall: scenario.amountToCall,
    street: scenario.street,
    ...(tournament ? { playersRemaining: tournament.playersRemaining } : {}),
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
            ...(data.playersRemaining !== undefined
              ? { playersRemaining: data.playersRemaining }
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
      cameraPan,
      elapsedMs: Math.max(0, Math.round(elapsedMs)),
      paused,
    });
  }, [cameraPan, elapsedMs, mode, onTrainingPresentationChange, paused]);

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
    active: raiseOpen && !action,
    containerRef: raiseComposerRef,
  });
  useModalFocusTrap({ active: historyOpen, containerRef: historyRef });

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

  useEffect(() => {
    const pauseForInactiveWindow = () => requestPause("window-blurred");
    const pauseForHiddenDocument = () => {
      if (document.hidden) requestPause("document-hidden");
    };
    window.addEventListener("blur", pauseForInactiveWindow);
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
      } else if (event.kind === "window-focus" && !event.focused) {
        requestPause("window-blurred");
      }
    });
    return () => {
      window.removeEventListener("blur", pauseForInactiveWindow);
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
    const onComplete = tournament?.onPresentationEventComplete;
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
        onComplete();
      },
    );
    pendingPresentationEvent.current = delay;
    group.add(delay);
    return () => {
      delay.cancel();
      group.remove(delay);
      if (pendingPresentationEvent.current === delay) {
        pendingPresentationEvent.current = null;
      }
    };
  }, [
    settings,
    speed,
    tournament?.onPresentationEventComplete,
    tournament?.presentationEvent,
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
    actionGateRef.current.release();
  }, [scenario.minimumRaise]);

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
    if (!update.changed) return;

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
    if (tournament.presentationEvent?.kind === "hole-cards-dealt") {
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
    setStagedBoard((current) =>
      current.length === scenario.board.length
        ? current
        : scenario.board.map((card) => ({ ...card })),
    );
  }, [scenario.board, tournament?.presentationEvent]);

  useEffect(() => {
    if (tournament?.showArrival) setArrivalVisible(true);
  }, [tournament?.showArrival]);

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
      if (
        mode === "training" &&
        trainingMeta?.actionEvs[nextAction] === undefined
      ) {
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
        setFoldProgress(100);
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
          decisionElapsedMs: Math.max(0, Math.round(elapsedMs)),
        };
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
              tournament.playersRemaining / tournament.fieldSize / 2,
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
      trainingMeta,
      tournament,
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
          ? trainingMeta?.actionEvs.raise !== undefined ||
            trainingMeta?.actionEvs["all-in"] !== undefined
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
              ? trainingMeta?.actionEvs.raise !== undefined ||
                trainingMeta?.actionEvs["all-in"] !== undefined
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
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
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
    trainingMeta,
    tournament?.legalActions,
    cameraStep,
  ]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (action) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    didDrag.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
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
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const shouldFold = !cancelled && didDrag.current && foldProgress >= 82;
    dragStart.current = null;
    setDragging(false);
    if (shouldFold) handleAction("fold");
    else if (!didDrag.current && !cancelled) setPeeked((value) => !value);
    else setFoldProgress(0);
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
    "--camera-pan": `${cameraPan * -18}px`,
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
  const heroStack = heroPlayer?.stack ?? scenario.minimumRaise;
  const heroStreetCommitted = heroPlayer?.bet ?? 0;
  const heroTotalCommitted = heroPlayer?.totalCommitted ?? heroStreetCommitted;
  const positionLabelForSeat = (seat: number): string => {
    if (seat === scenario.buttonSeat) return "BTN";
    if (seat === scenario.smallBlindSeat) return "SB";
    if (seat === scenario.bigBlindSeat) return "BB";
    if (scenario.bigBlindSeat === undefined) return "";
    const distance = (seat - scenario.bigBlindSeat + scenario.players.length) % scenario.players.length;
    if (distance === 1) return "UTG";
    if (distance === scenario.players.length - 1) return "CO";
    return distance === 2 ? "HJ" : "MP";
  };
  const heroPositionLabel = positionLabelForSeat(scenario.heroSeat);
  const dealerMoveEvent =
    tournament?.presentationEvent?.kind === "button-moved"
      ? tournament.presentationEvent
      : undefined;
  const minimumRaise =
    mode !== "training" && tournament
      ? (tournament.legalActions.raise?.minTo ??
        tournament.legalActions.bet?.min ??
        tournament.legalActions.allInTo)
      : scenario.minimumRaise;
  const maximumRaise =
    mode !== "training" && tournament
      ? (tournament.legalActions.raise?.maxTo ??
        tournament.legalActions.bet?.max ??
        tournament.legalActions.allInTo)
      : heroStack;
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
        Math.max(
          minimumRaise,
          Math.min(
            maximumRaise,
            Math.round(amount / scenario.blinds[1]) * scenario.blinds[1],
          ),
        ),
      ),
    ),
  );
  const canRaise =
    mode === "training"
      ? trainingMeta?.actionEvs.raise !== undefined ||
        trainingMeta?.actionEvs["all-in"] !== undefined
      : Boolean(
          tournament?.legalActions.raise ||
            tournament?.legalActions.bet ||
            tournament?.legalActions.allIn,
        );
  const presentationActive = Boolean(tournament?.presentationEvent);
  const cardsDealt = cardsDealtHandId === scenario.id;
  const heroDecisionActive =
    mode === "training" || tournament?.heroDecision !== false;
  const callAction = scenario.amountToCall > 0 ? "call" : "check";
  const tablePlayers = [...scenario.players].sort((left, right) => {
    if (left.seat === scenario.heroSeat) return -1;
    if (right.seat === scenario.heroSeat) return 1;
    const leftDistance = (left.seat - scenario.heroSeat + 10) % 10;
    const rightDistance = (right.seat - scenario.heroSeat + 10) % 10;
    return leftDistance - rightDistance;
  });
  const tableAnnouncement = buildPokerTableAnnouncement({
    action,
    latestPublicAction: tournament?.actionHistory.at(-1),
    scenario,
  });

  // Public result of the hand that just finished, resolved from the same
  // engine pot-award data the "Won pot" seat badge already uses -- never
  // guessed from a stack-size delta. Undefined until a hand has resolved.
  const potResultSnapshot: TableAnnouncerSnapshot["potResult"] =
    tournament?.lastPotAwards?.length
      ? {
          winnerNames: Array.from(
            new Set(tournament.lastPotAwards.map((award) => award.playerId)),
          ).map((playerId) => {
            const winner = scenario.players.find(
              (player) => player.id === playerId,
            );
            if (!winner) return playerId;
            return winner.seat === scenario.heroSeat
              ? formatMessage("table.seat.you")
              : winner.name;
          }),
          amount: tournament.lastPotAwards.reduce(
            (sum, award) => sum + award.amount,
            0,
          ),
          hadSidePot: Boolean(tournament.lastHandHadSidePot),
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
      className="table-screen"
      data-camera-motion={settings.cameraMotion}
      data-table-motion={settings.tableMotion}
      data-transition-motion={settings.transitionMotion}
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
          <strong>{scenario.title}</strong>
          <span>
            {mode === "training"
              ? formatMessage("table.status.scenarioProgress", {
                  number: Math.max(1, scenarioNumber),
                  total: trainingScenarios.length,
                })
              : formatMessage("table.status.streetPlayersRemain", {
                  street: `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)}`,
                  playersRemaining:
                    tournament?.playersRemaining ?? scenario.players.length,
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
        <section
          className="table-stage"
          aria-label={formatMessage("table.stageAriaLabel")}
        >
          {/*
            The hero's physical cards occupy the near-camera table position.
            Keep the stack in a fixed HUD lane so it never competes with those
            cards or the action dock, while remaining available throughout
            every tournament presentation state.
          */}
          <aside
            className="hero-stack-hud"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={heroStackAriaLabel(heroStack)}
          >
            <span>Your stack</span>
            <strong>
              <ChipStack /> {formatChips(heroStack)}
            </strong>
            <span className="hero-stack-hud__commitment">
              In this round <b>{formatChips(heroStreetCommitted)}</b> · Total this hand{" "}
              <b>{formatChips(heroTotalCommitted)}</b>
            </span>
            {heroPositionLabel && <span className="hero-stack-hud__position">Position {heroPositionLabel}</span>}
          </aside>
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
                    playersRemaining: tournament.playersRemaining,
                  })}
                </strong>
              </div>
              <i>
                <b
                  style={{
                    width: `${Math.max(
                      4,
                      ((tournament.fieldSize - tournament.playersRemaining) /
                        Math.max(1, tournament.fieldSize - 1)) *
                        100,
                    )}%`,
                  }}
                />
              </i>
              <small>{formatMessage("table.arrival.settling")}</small>
            </div>
          )}
          <div className="room-lights" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>

          <div className="camera-controls">
            <button
              type="button"
              onClick={() =>
                setCameraPan((value) => Math.max(-2, value - cameraStep))
              }
              aria-label={formatMessage("table.camera.left")}
            >
              <ChevronLeft size={17} />
            </button>
            <span>{formatMessage("table.camera.viewLabel")}</span>
            <button
              type="button"
              onClick={() =>
                setCameraPan((value) => Math.min(2, value + cameraStep))
              }
              aria-label={formatMessage("table.camera.right")}
            >
              <ChevronRight size={17} />
            </button>
          </div>

            <div className="poker-scene">
              {dealerMoveEvent && (
                <span className="dealer-button-travel" role="img" aria-label="Dealer button moves to its next seat">D</span>
              )}
            <div
              className={`poker-table ${
                tournament?.presentationEvent?.kind === "hole-cards-dealt"
                  ? "is-dealing-hole-cards"
                  : ""
              }`}
              data-table-hand-id={scenario.id}
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

                <div className="table-readout">
                  <span>{formatMessage("table.readout.potLabel")}</span>
                  <strong>{formatChips(scenario.pot)}</strong>
                  <small>
                    {formatMessage("table.readout.blinds", {
                      smallBlind: formatChips(scenario.blinds[0]),
                      bigBlind: formatChips(scenario.blinds[1]),
                    })}
                  </small>
                </div>

                <div
                  className="community-cards"
                  role="group"
                  aria-label={formatMessage("table.communityCards.ariaLabel")}
                >
                  {stagedBoard.map((card, index) => (
                    <span
                      className={
                        tournament?.presentationEvent?.kind === "board-card-dealt" &&
                        tournament.presentationEvent.cardIndex === index
                          ? "board-card-entering"
                          : undefined
                      }
                      key={`${card.rank}-${index}`}
                    >
                      <PlayingCard card={card} />
                    </span>
                  ))}
                  {Array.from({ length: 5 - stagedBoard.length }).map(
                    (_, index) => (
                      <span
                        className="community-placeholder"
                        key={`placeholder-${index}`}
                      />
                    ),
                  )}
                </div>

                <div className="center-pot" aria-hidden="true">
                  <ChipStack bet />
                  <ChipStack bet />
                  <ChipStack bet />
                </div>
              </div>
            </div>

            {tablePlayers.slice(0, 6).map((player, index) => {
              const presentation = seatPresentationUpdate(
                tournament?.presentationEvent,
                player.id,
              );
              return (
                <PlayerSeat
                  key={player.id}
                  player={player}
                  position={seatPositions[index]}
                  isHero={player.seat === scenario.heroSeat}
                  dealer={player.seat === scenario.buttonSeat}
                  wonPot={
                    presentation.wonPot ||
                    (arrivalVisible &&
                      Boolean(tournament?.lastPotWinnerIds?.includes(player.id)))
                  }
                  recentAction={presentation.action}
                  recentActionLabel={presentation.label}
                  cardsDealt={cardsDealt}
                  isActing={scenario.actingPlayerId === player.id}
                  eliminated={presentation.eliminated}
                  positionLabel={positionLabelForSeat(player.seat)}
                />
              );
            })}

            {foldProgress > 10 && !action && (
              <div
                className={`fold-release-zone ${
                  foldProgress >= 82 ? "is-ready" : ""
                }`}
              >
                <span>
                  {foldProgress >= 82
                    ? formatMessage("table.fold.release")
                    : formatMessage("table.fold.keepDragging")}
                </span>
                <i style={{ width: `${foldProgress}%` }} />
              </div>
            )}

            <button
              className={`hero-hole-cards ${peeked ? "is-peeked" : ""} ${
                dragging ? "is-dragging" : ""
              } ${action === "fold" ? "is-folded" : ""}`}
              type="button"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => endPointerGesture(event)}
              onPointerCancel={(event) => endPointerGesture(event, true)}
              style={
                {
                  "--fold-offset": `${Math.min(foldProgress, 82) * -0.55}px`,
                } as CSSProperties
              }
              aria-label={formatMessage("table.holeCards.ariaLabel", {
                state: peeked
                  ? formatMessage("table.holeCards.hide")
                  : formatMessage("table.holeCards.peek"),
              })}
              disabled={Boolean(action) || !cardsDealt}
            >
              <span className="hero-hole-cards__cards">
                {scenario.heroCards.map((card, index) => (
                  <span className="hero-card-wrap" key={cardLabel(card)}>
                    <PlayingCard card={card} hidden={!peeked} />
                    {peeked && index === 1 && (
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
                    ? trainingMeta?.actionEvs.fold === undefined
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
                    ? trainingMeta?.actionEvs[callAction] === undefined
                    : callAction === "call"
                      ? !tournament?.legalActions.call || presentationActive
                      : !tournament?.legalActions.check || presentationActive
                }
                onClick={() => handleAction(callAction)}
              >
                <span>C</span>
                <strong>
                  {scenario.amountToCall > 0
                    ? formatMessage("table.action.callAmount", {
                        amount: formatChips(scenario.amountToCall),
                      })
                    : formatMessage("table.action.check")}
                </strong>
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
                <button
                  type="button"
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
                    // physical mouse input as a belt-and-suspenders path.
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
                  {formatMessage("table.spectator.skipToResult")}
                </button>
              </div>
            </div>
          )}

          {raiseOpen && !action && (
            <div
              className="bet-composer"
              role="dialog"
              aria-modal="true"
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
                  max={maximumRaise}
                  step={scenario.blinds[1]}
                  value={raiseAmount}
                  onChange={(event) => setRaiseAmount(Number(event.target.value))}
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
            scenario={ratedScenario}
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
        ) : (
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
                <ol className="hand-ranking-list">
                  <li>{formatMessage("table.handRank.royalFlush")}</li>
                  <li>{formatMessage("table.handRank.straightFlush")}</li>
                  <li>{formatMessage("table.handRank.fourOfAKind")}</li>
                  <li>{formatMessage("table.handRank.fullHouse")}</li>
                  <li>{formatMessage("table.handRank.flush")}</li>
                  <li>{formatMessage("table.handRank.straight")}</li>
                  <li>{formatMessage("table.handRank.threeOfAKind")}</li>
                  <li>{formatMessage("table.handRank.twoPair")}</li>
                  <li>{formatMessage("table.handRank.pair")}</li>
                  <li>{formatMessage("table.handRank.highCard")}</li>
                </ol>
                <div className="pause-formulas">
                  <p>
                    <strong>{formatMessage("table.formula.potOdds.label")}</strong>{" "}
                    {formatMessage("table.formula.potOdds.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.equity.label")}</strong>{" "}
                    {formatMessage("table.formula.equity.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.spr.label")}</strong>{" "}
                    {formatMessage("table.formula.spr.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.minRaise.label")}</strong>{" "}
                    {formatMessage("table.formula.minRaise.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.sidePot.label")}</strong>{" "}
                    {formatMessage("table.formula.sidePot.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.bubble.label")}</strong>{" "}
                    {formatMessage("table.formula.bubble.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.workedCall.label")}</strong>{" "}
                    {formatMessage("table.formula.workedCall.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.shortcut.label")}</strong>{" "}
                    {formatMessage("table.formula.shortcut.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.ruleOf2And4.label")}</strong>{" "}
                    {formatMessage("table.formula.ruleOf2And4.desc")}
                  </p>
                  <p>
                    <strong>{formatMessage("table.formula.expectedValue.label")}</strong>{" "}
                    {formatMessage("table.formula.expectedValue.desc")}
                  </p>
                </div>
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

      <footer className="table-footer">
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
          <b>2 / 5 / 3</b> {formatMessage("table.footer.quickRaise")}
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
      </footer>
    </div>
  );
}
