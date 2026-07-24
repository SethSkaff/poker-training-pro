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
import type { HeroTournamentAction } from "../modes/tournamentRunner";
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
  kind: "career" | "timed";
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
  /** The latest public table action, for a brief, truthful character gesture. */
  lastPublicAction?: {
    playerId: string;
    type: BettingActionType;
  };
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
    ? `Board: ${scenario.board.map(cardAriaLabel).join(", ")}.`
    : "No community cards yet.";
  const decision = action
    ? `You submitted ${action.replace("-", " ")}.`
    : scenario.amountToCall > 0
      ? `${formatChips(scenario.amountToCall)} to call.`
      : "You may check or bet.";
  return [
    `${street}. Pot ${formatChips(scenario.pot)}.`,
    board,
    latestPublicAction ? `Latest public action: ${latestPublicAction}.` : "",
    decision,
  ]
    .filter(Boolean)
    .join(" ");
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
        aria-label="Face-down card"
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
}

function PlayerSeat({
  dealer,
  isHero,
  player,
  position,
  wonPot = false,
  recentAction,
}: PlayerSeatProps) {
  const isFolded = player.status === "folded";
  const isAllIn = player.status === "all-in";
  const isOut = player.status === "out";
  const isShowingCards = !isHero && !isOut;
  const shouldHoldCards = isShowingCards && player.status === "active";
  const gesture = wonPot
    ? "win"
    : isAllIn
      ? "all-in"
      : isFolded
        ? "fold"
        : player.bet > 0
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
      aria-label={`${isHero ? "You" : player.name}, ${formatChips(player.stack)} chips, ${player.status}${isShowingCards ? ", holding cards" : ""}${player.bet > 0 ? `, bet ${formatChips(player.bet)}` : ""}${dealer ? ", dealer button" : ""}`}
    >
      {dealer && <span className="dealer-button" aria-hidden="true">D</span>}
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
        {player.status === "active" && player.id === "maya" && (
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
        <strong>{isHero ? "You" : player.name}</strong>
        <span>
          <ChipStack /> {formatChips(player.stack)}
        </span>
      </div>
      {player.bet > 0 && (
        <div className="seat-bet" aria-hidden="true">
          <ChipStack bet />
          <b>{formatChips(player.bet)}</b>
        </div>
      )}
      {isFolded && <span className="seat-state" aria-hidden="true">Folded</span>}
      {player.status === "all-in" && !wonPot && (
        <span className="seat-state seat-state--all-in" aria-hidden="true">All-in</span>
      )}
      {isOut && <span className="seat-state seat-state--out" aria-hidden="true">Out</span>}
      {wonPot && <span className="seat-state seat-state--winner" aria-hidden="true">Won pot</span>}
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
      ? "33%, 1/3, or 2:1"
      : question.unit === "ratio"
        ? "0.6 or 3:5"
        : question.unit === "outs"
          ? "Number of outs"
          : "Chip amount";

  return (
    <aside className="training-panel" aria-label="Training math question">
      <div className="training-panel__heading">
        <span className="training-panel__icon">
          <Sigma size={20} />
        </span>
        <div>
          <p className="eyebrow">Show your work · Optional</p>
          <h2>{title}</h2>
        </div>
        <span className="xp-chip">Math Elo {mathElo}</span>
      </div>

      <div className="question-context">
        <span>
          <Info size={14} /> Use an estimate
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
                ? "Inside the range"
                : result.close
                  ? "Near miss"
                  : "Not quite"}
            </strong>
            <small>
              Accepted estimate: {formatFixedDecimal(lower, 2)}–{formatFixedDecimal(upper, 2)}
              {question.unit}
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
          Check estimate
        </button>
      )}

      <div className="training-hint">
        <Lightbulb size={16} />
        <span>
          <strong>One linked question</strong>
          Accepted tolerance: ±{question.tolerance}
          {question.unit}.
        </span>
      </div>
    </aside>
  );
}

interface FeedbackPanelProps {
  action: PokerAction;
  graded: GradedTrainingAttempt;
  mathAttempted: boolean;
  scenario: RatedTrainingScenario;
  onNext: () => void;
  onReview: () => void;
}

function FeedbackPanel({
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
    ? "skipped"
    : graded.math.correct
      ? "correct"
      : graded.math.close
        ? "near miss"
        : "incorrect";

  return (
    <aside className="feedback-panel" aria-live="polite">
      <div className="feedback-grade">
        <span className={actionPositive ? "is-correct" : "is-wrong"}>
          {actionPositive ? <Check size={24} /> : <X size={24} />}
        </span>
        <div>
          <p className="eyebrow">Decision review</p>
          <h2>
            {actionCorrect
              ? "Strong decision"
              : graded.action.close
                ? "Close decision"
                : "Needs another look"}
          </h2>
        </div>
      </div>

      <div className="rating-delta">
        <span>Decision Elo</span>
        <strong>{signed(decisionDelta)}</strong>
        <small>
          {graded.decisionEloAfter} · Math {mathEloAfter} ({signed(mathDelta)})
        </small>
      </div>

      <p className="feedback-lead">
        {actionCorrect || graded.action.close
          ? scenario.actionReason
          : `You chose ${action.replace("-", " ")} and gave up ${formatFixedDecimal(graded.action.regret, 2)}bb versus the modeled best action, ${graded.action.bestAction}.`}
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
          Action: <b>{action}</b>
        </span>
        <span>
          Math: <b>{mathLabel}</b>
        </span>
        <span>
          Time: <b>{formatFixedDecimal(graded.timing.totalMs / 1000, 1)}s</b>
        </span>
      </div>

      <div className="feedback-actions">
        <button className="secondary-button" type="button" onClick={onReview}>
          <RotateCcw size={16} /> Review
        </button>
        <button className="primary-button" type="button" onClick={onNext}>
          Next hand <ChevronRight size={16} />
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
              ? "Timed Table"
              : mode === "rational"
                ? "Rational Tour"
                : "Normal Tour"}
          </p>
          <h2>{timed ? "Beat the clock" : "Tournament table"}</h2>
        </div>
      </div>
      <p className="mode-preview-panel__copy">
        {timed
          ? "Normal opponents share one escalating table. The blind director increases pressure as your deadline approaches."
          : mode === "rational"
          ? "Opponents follow explicit range, equity, and pot-odds policies. Review their logic after the hand."
          : "Opponents stay fundamentally sound while changing tempo, bluff frequency, and pressure."}
      </p>
      <div className="opponent-read">
        <span>Your seat</span>
        <strong>{hero?.name ?? "Player"}</strong>
        <small>
          Hand {tournament.handNumber} · {tournament.playersRemaining} of{" "}
          {tournament.fieldSize} players remain
        </small>
      </div>
      {timeRemaining !== undefined && (
        <div className="opponent-read">
          <span>Scheduled time remaining</span>
          <strong>
            {Math.floor(timeRemaining / 60_000)}:
            {String(Math.floor((timeRemaining % 60_000) / 1000)).padStart(
              2,
              "0",
            )}
          </strong>
          <small>
            Blinds only rise; deadline pressure forces the field toward heads-up.
          </small>
        </div>
      )}
      <div className="training-hint">
        <CircleHelp size={16} />
        <span>
          <strong>Information-set play</strong>
          Opponents cannot inspect hidden cards.
        </span>
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
  const pendingTournamentAction = useRef<FreezableDelay | null>(null);
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
                ? `Call ${formatChips(data.amountToCall)} to continue, raise, or fold.`
                : "Check, bet, or fold.",
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

  useEffect(() => {
    const group = freezeGroupRef.current;
    return () => {
      pendingTournamentAction.current?.cancel();
      pendingTournamentAction.current = null;
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
  }, [scenario.minimumRaise]);

  const handleAction = useCallback(
    (nextAction: PokerAction, requestedRaiseTo = raiseAmount) => {
      if (action || paused) return;
      if (
        mode === "training" &&
        trainingMeta?.actionEvs[nextAction] === undefined
      ) {
        setActionError("That action is not available in this practice scenario.");
        gameAudio.play("error");
        return;
      }
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
        `Enter a valid ${scenario.mathQuestion.unit === "%" ? "percentage, fraction, or ratio" : scenario.mathQuestion.unit} estimate.`,
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
      ? "Training Lab"
      : mode === "rational"
        ? "Rational Circuit"
        : "Normal Tournament";
  const scenarioNumber =
    trainingScenarios.findIndex((item) => item.id === scenario.id) + 1;
  const heroStack =
    scenario.players.find((player) => player.seat === scenario.heroSeat)?.stack ??
    scenario.minimumRaise;
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

  return (
    <div
      className="table-screen"
      data-camera-motion={settings.cameraMotion}
      data-table-motion={settings.tableMotion}
      data-transition-motion={settings.transitionMotion}
      style={tableStyle}
    >
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {tableAnnouncement}
      </p>
      <header className="table-topbar">
        <button className="table-exit" type="button" onClick={onExit}>
          <ArrowLeft size={18} /> Leave table
        </button>
        <div className="table-session">
          <p className="eyebrow">{modeTitle}</p>
          <strong>{scenario.title}</strong>
          <span>
            {mode === "training"
              ? `Scenario ${Math.max(1, scenarioNumber)} of ${trainingScenarios.length}`
              : `${scenario.street[0].toUpperCase()}${scenario.street.slice(1)} · ${
                  tournament?.playersRemaining ?? scenario.players.length
                } players remain`}
          </span>
        </div>
        <div className="table-tools">
          <span
            className="decision-clock"
            role="timer"
            aria-label={`Decision time ${formatFixedDecimal(elapsedMs / 1000, 1)} seconds`}
          >
            <Clock3 size={15} />
            {formatFixedDecimal(elapsedMs / 1000, 1)}s
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
                aria-label="Opponent presentation speed"
              />
            </label>
          )}
          <button
            type="button"
            aria-label="Pause table"
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
            aria-label={settings.muted ? "Unmute table audio" : "Mute table audio"}
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
        <section className="table-stage" aria-label="Six-seat poker table">
          {actionError ? (
            <p className="table-action-alert" role="alert">
              <X size={16} aria-hidden="true" /> {actionError}
            </p>
          ) : null}
          {arrivalVisible && tournament && (
            <div className="room-progress-overlay" aria-live="polite">
              <div>
                <span>Championship progress</span>
                <strong>
                  Hand {tournament.handNumber} · {tournament.playersRemaining} remain
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
              <small>Settling into the next hand</small>
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
              aria-label="Look one seat left"
            >
              <ChevronLeft size={17} />
            </button>
            <span>Table view</span>
            <button
              type="button"
              onClick={() =>
                setCameraPan((value) => Math.min(2, value + cameraStep))
              }
              aria-label="Look one seat right"
            >
              <ChevronRight size={17} />
            </button>
          </div>

            <div className="poker-scene">
            <div className="poker-table">
              <div className="felt-ring">
                <span className="felt-brand">PTP · CHAMPIONSHIP</span>
                <div className="dealer">
                  <span className="dealer__head" />
                  <span className="dealer__body" />
                  <b>DEALER</b>
                </div>

                <div className="table-readout">
                  <span>Pot</span>
                  <strong>{formatChips(scenario.pot)}</strong>
                  <small>
                    Blinds {formatChips(scenario.blinds[0])}/
                    {formatChips(scenario.blinds[1])}
                  </small>
                </div>

                <div
                  className="community-cards"
                  role="group"
                  aria-label="Community cards"
                >
                  {scenario.board.map((card, index) => (
                    <PlayingCard card={card} key={`${card.rank}-${index}`} />
                  ))}
                  {Array.from({ length: 5 - scenario.board.length }).map(
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

            {tablePlayers.slice(0, 6).map((player, index) => (
              <PlayerSeat
                key={player.id}
                player={player}
                position={seatPositions[index]}
                isHero={player.seat === scenario.heroSeat}
                dealer={player.seat === scenario.buttonSeat}
                wonPot={
                  arrivalVisible &&
                  Boolean(tournament?.lastPotWinnerIds?.includes(player.id))
                }
                recentAction={
                  tournament?.lastPublicAction?.playerId === player.id
                    ? tournament.lastPublicAction.type
                    : undefined
                }
              />
            ))}

            {foldProgress > 10 && !action && (
              <div
                className={`fold-release-zone ${
                  foldProgress >= 82 ? "is-ready" : ""
                }`}
              >
                <span>{foldProgress >= 82 ? "Release to fold" : "Keep dragging"}</span>
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
              aria-label={`${peeked ? "Hide" : "Peek"} hole cards. Drag toward the dealer to fold.`}
              disabled={Boolean(action)}
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
                  {peeked ? "Hide cards" : "Click to peek · Drag up to fold"}
                </span>
              )}
            </button>
          </div>

          <div className="action-context">
            <div>
              <span>{scenario.prompt}</span>
              <strong>{formatChips(scenario.amountToCall)} to call</strong>
            </div>
            <button
              type="button"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <History size={15} /> Prior action
            </button>
          </div>

          {historyOpen && (
            <aside
              className="hand-history-popover"
              aria-label="Public hand history"
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              ref={historyRef}
            >
              <header>
                <strong>Public action log</strong>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="Close hand history"
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
                <p>No prior public action this session.</p>
              )}
            </aside>
          )}

          {!action ? (
            <div className="action-dock">
              <button
                className="action-button action-button--fold"
                type="button"
                disabled={
                  mode === "training"
                    ? trainingMeta?.actionEvs.fold === undefined
                    : !tournament?.legalActions.fold
                }
                onClick={() => handleAction("fold")}
              >
                <span>F</span>
                <strong>Fold</strong>
              </button>
              <button
                className="action-button action-button--call"
                type="button"
                disabled={
                  mode === "training"
                    ? trainingMeta?.actionEvs[callAction] === undefined
                    : callAction === "call"
                      ? !tournament?.legalActions.call
                      : !tournament?.legalActions.check
                }
                onClick={() => handleAction(callAction)}
              >
                <span>C</span>
                <strong>
                  {scenario.amountToCall > 0
                    ? `Call ${formatChips(scenario.amountToCall)}`
                    : "Check"}
                </strong>
              </button>
              <button
                className={`action-button action-button--raise ${
                  raiseOpen ? "is-active" : ""
                }`}
                type="button"
                disabled={!canRaise}
                onClick={() => setRaiseOpen((value) => !value)}
              >
                <span>R</span>
                <strong>Raise to…</strong>
              </button>
            </div>
          ) : (
            <div className="spectator-dock">
              <span>
                <Check size={16} /> Action locked: {action}
              </span>
              <div>
                <button
                  type="button"
                  className={speed === 2 ? "is-active" : ""}
                  onClick={() => setSpeed(speed === 2 ? 1 : 2)}
                >
                  <FastForward size={15} /> {speed === 2 ? "Return to 1×" : "2×"}
                </button>
                <button
                  type="button"
                  onClick={() => pendingTournamentAction.current?.finish()}
                  aria-label="Skip opponent presentation and continue the hand"
                >
                  Skip to result
                </button>
              </div>
            </div>
          )}

          {raiseOpen && !action && (
            <div
              className="bet-composer"
              role="dialog"
              aria-modal="true"
              aria-label="Build your raise"
              tabIndex={-1}
              ref={raiseComposerRef as React.RefObject<HTMLDivElement>}
            >
              <header>
                <span>
                  <HandCoins size={17} /> Build your raise
                </span>
                <button
                  type="button"
                  onClick={() => setRaiseOpen(false)}
                  aria-label="Close raise controls"
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
                      ? "All-in"
                      : index === 0
                        ? "Min"
                        : `${Math.round((amount / scenario.pot) * 100)}% pot`}
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
                  aria-label="Raise amount"
                />
                <output>
                  <strong>{formatChips(raiseAmount)}</strong>
                  <span>{Math.round(raiseAmount / scenario.blinds[1])} BB</span>
                </output>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() =>
                    handleAction(raiseAmount >= allInAmount ? "all-in" : "raise")
                  }
                >
                  {raiseAmount >= allInAmount
                    ? "Confirm all-in"
                    : `Raise to ${formatChips(raiseAmount)}`}
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
        <aside
          className="context-coach"
          role="dialog"
          aria-labelledby="context-coach-title"
          aria-describedby="context-coach-message"
        >
          <span className="context-coach__badge">Table tip</span>
          <h2 id="context-coach-title">{activePrompt.title}</h2>
          <p id="context-coach-message">{activePrompt.message}</p>
          <div>
            <button
              type="button"
              onClick={() => {
                const next = markContextualPromptSeen(
                  coachState,
                  activePrompt.id,
                );
                updateCoachState(next);
                setActivePrompt(null);
              }}
            >
              Got it
            </button>
            <button
              type="button"
              onClick={() =>
                updateCoachState({ ...coachState, enabled: false })
              }
            >
              Turn off tips
            </button>
          </div>
        </aside>
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
            Continue
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
            <p className="eyebrow">Table paused</p>
            <h2 id="pause-title">
              {pausePage === "menu"
                ? "Take your time"
                : pausePage === "controls"
                  ? "Table controls"
                  : pausePage === "settings"
                    ? "Table settings"
                    : pausePage === "remap"
                      ? "Remap controls"
                      : "Poker quick reference"}
            </h2>

            {pausePage === "menu" ? (
              <div className="pause-menu__actions">
                <button
                  className="primary-button"
                  type="button"
                  autoFocus
                  onClick={() => setPaused(false)}
                >
                  Resume table
                </button>
                <button type="button" onClick={() => setPausePage("controls")}>
                  Controls & hotkeys
                </button>
                <button type="button" onClick={() => setPausePage("settings")}>
                  Settings
                </button>
                <button type="button" onClick={() => setPausePage("reference")}>
                  Hand & math reference
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
                  Show first-time table tips
                </label>
                <button
                  type="button"
                  onClick={() => {
                    updateCoachState(resetContextualPromptState());
                    setActivePrompt(null);
                    setPaused(false);
                  }}
                >
                  Replay contextual tips
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
                    Restart practice scenario (unscored)
                  </button>
                ) : null}
                <button className="pause-menu__leave" type="button" onClick={onExit}>
                  {tournament
                    ? "Leave scored tournament and return to menu"
                    : "Leave practice and return to menu"}
                </button>
              </div>
            ) : pausePage === "controls" ? (
              <>
                <dl className="pause-reference-grid">
                  <div><dt>F</dt><dd>Fold</dd></div>
                  <div><dt>C</dt><dd>Check / call</dd></div>
                  <div><dt>R</dt><dd>Custom raise</dd></div>
                  <div><dt>2 / 5 / 3</dt><dd>2× / 2.5× / 3× BB</dd></div>
                  <div><dt>P / A</dt><dd>Pot / all-in</dd></div>
                  <div><dt>Space</dt><dd>Peek / hide cards</dd></div>
                  <div><dt>Q / E / X</dt><dd>Look left / right / center</dd></div>
                  <div><dt>[ / ]</dt><dd>Opponent speed</dd></div>
                </dl>
                <p className="pause-menu__hint">
                  Controller: A check/call, X fold, Y raise, LB peek, View pause,
                  d-pad camera. B goes back in menus.
                </p>
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("remap")}
                >
                  Remap controls…
                </button>
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("menu")}
                >
                  Back
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
                    <span>Master volume <b>{settings.masterVolume}%</b></span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={settings.masterVolume}
                      aria-label="Master volume"
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
                    Mute all audio
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
                    Reduce motion
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
                    High contrast and four-color deck
                  </label>
                </div>
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("menu")}
                >
                  Back
                </button>
              </>
            ) : (
              <>
                <ol className="hand-ranking-list">
                  <li>Royal flush</li><li>Straight flush</li><li>Four of a kind</li>
                  <li>Full house</li><li>Flush</li><li>Straight</li>
                  <li>Three of a kind</li><li>Two pair</li><li>Pair</li><li>High card</li>
                </ol>
                <div className="pause-formulas">
                  <p><strong>Pot odds</strong> Call ÷ (pot after your call)</p>
                  <p><strong>Equity</strong> Your estimated share of the pot at showdown</p>
                  <p><strong>SPR</strong> Effective stack divided by the pot at the start of the street</p>
                  <p><strong>Minimum raise</strong> At least the size of the last full bet or raise</p>
                  <p><strong>Side pot</strong> Separate chips contested only by players who matched them</p>
                  <p><strong>Bubble</strong> The last finish before a qualification or prize cutoff</p>
                  <p>
                    <strong>Worked call</strong> Calling 200 into a final pot of
                    800 costs 25%. Continue when estimated equity is above 25%,
                    before tournament-risk adjustments.
                  </p>
                  <p>
                    <strong>Shortcut</strong> Nine flush outs from the flop are roughly 36% to improve by the river.
                  </p>
                  <p><strong>Rule of 2 & 4</strong> Outs × 2 for one card; × 4 from the flop</p>
                  <p><strong>Expected value</strong> Win value − loss cost, weighted by probability</p>
                </div>
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("menu")}
                >
                  Back
                </button>
              </>
            )}
            <small className="pause-menu__hint">Esc resumes without changing the hand.</small>
          </section>
        </div>
      )}

      <footer className="table-footer">
        {gamepadActive ? (
          <span className="table-footer__controller">
            <b>A</b> Check/Call · <b>X</b> Fold · <b>Y</b> Raise · <b>LB</b> Peek
            · <b>View</b> Pause · <b>D-pad</b> Camera
          </span>
        ) : null}
        <span>
          <b>Space</b> Peek cards
        </span>
        <span>
          <b>F</b> Fold
        </span>
        <span>
          <b>C</b> Call
        </span>
        <span>
          <b>R</b> Raise
        </span>
        <span>
          <b>2 / 5 / 3</b> Quick raise
        </span>
        <span>
          <b>A</b> All-in
        </span>
        <span>
          <b>H</b> History
        </span>
        <span>
          <b>Q / E / X</b> Camera
        </span>
      </footer>
    </div>
  );
}
