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
import type { LegalActionSet } from "../engine";
import { cardAriaLabel, cardLabel, formatChips } from "../lib/format";
import { gameAudio } from "../lib/audio";
import {
  detectTablePromptOccurrences,
  loadContextualPromptState,
  markContextualPromptSeen,
  nextContextualPrompt,
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
import type {
  Card,
  GameMode,
  GameSettings,
  PlayerProgress,
  PokerAction,
  SeatPlayer,
  TrainingScenario,
} from "../types/poker";

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
}

interface PokerTableProps {
  mode: GameMode;
  scenario: RatedTrainingScenario | TrainingScenario;
  settings: GameSettings;
  progress: PlayerProgress;
  onProgressChange: (progress: PlayerProgress) => void;
  onSettingsChange: (settings: GameSettings) => void;
  onPauseChange?: (paused: boolean) => void;
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
}

function PlayerSeat({
  dealer,
  isHero,
  player,
  position,
}: PlayerSeatProps) {
  const isFolded = player.status === "folded";

  return (
    <div
      className={`player-seat player-seat--${position} ${
        isHero ? "player-seat--hero" : ""
      } ${isFolded ? "is-folded" : ""}`}
      aria-label={`${player.name}, ${formatChips(player.stack)} chips, ${player.status}`}
    >
      {dealer && <span className="dealer-button">D</span>}
      {!isHero && (
        <div className="opponent-cards" aria-label="Two face-down cards">
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
      <div className="seat-avatar">
        <span>{player.name.slice(0, 1)}</span>
        {player.status === "active" && player.id === "maya" && (
          <i className="thinking-ring" />
        )}
      </div>
      <div className="seat-label">
        <strong>{isHero ? "You" : player.name}</strong>
        <span>
          <ChipStack /> {formatChips(player.stack)}
        </span>
      </div>
      {player.bet > 0 && (
        <div className="seat-bet">
          <ChipStack bet />
          <b>{formatChips(player.bet)}</b>
        </div>
      )}
      {isFolded && <span className="seat-state">Folded</span>}
      {player.status === "all-in" && (
        <span className="seat-state seat-state--all-in">All-in</span>
      )}
    </div>
  );
}

interface MathPanelProps {
  scenario: RatedTrainingScenario;
  answer: string;
  result: MathEvaluation | null;
  mathElo: number;
  onAnswer: (answer: string) => void;
  onFocus: () => void;
  onSubmit: () => void;
}

function MathPanel({
  scenario,
  answer,
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
              Accepted estimate: {lower.toFixed(2)}–{upper.toFixed(2)}
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
          : `You chose ${action.replace("-", " ")} and gave up ${graded.action.regret.toFixed(2)}bb versus the modeled best action, ${graded.action.bestAction}.`}
      </p>

      <div className="feedback-math">
        <span className="feedback-math__formula">
          <b>{scenario.mathQuestion.correctValue.toFixed(2)}</b>
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
          Time: <b>{(graded.timing.totalMs / 1000).toFixed(1)}s</b>
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
  onNextScenario,
  onExit,
  tournament,
}: PokerTableProps) {
  const [peeked, setPeeked] = useState(false);
  const [foldProgress, setFoldProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [action, setAction] = useState<PokerAction | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState(scenario.minimumRaise);
  const [mathAnswer, setMathAnswer] = useState("");
  const [mathResult, setMathResult] = useState<MathEvaluation | null>(null);
  const [gradedAttempt, setGradedAttempt] =
    useState<GradedTrainingAttempt | null>(null);
  const [cameraPan, setCameraPan] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
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
  const [paused, setPaused] = useState(false);
  const [pausePage, setPausePage] = useState<
    "menu" | "controls" | "reference" | "settings"
  >("menu");
  const pendingTournamentAction = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const pauseDialogRef = useRef<HTMLElement | null>(null);
  const focusBeforePause = useRef<HTMLElement | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);
  const mathStartedAt = useRef<number | null>(null);
  const mathElapsedMs = useRef(0);
  const pauseStartedAt = useRef<number | null>(null);
  const ratedScenario = scenario as RatedTrainingScenario;
  const trainingMeta =
    "training" in scenario ? scenario.training : undefined;

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
      detectTablePromptOccurrences(
        scenario,
        tournament?.actionHistory ?? [],
      ),
    );
    if (prompt) setActivePrompt(prompt);
  }, [activePrompt, coachState, scenario, tournament?.actionHistory]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    gameAudio.setFocusMuted(paused);
    onPauseChange?.(paused);
    if (paused) {
      pauseStartedAt.current = performance.now();
    } else if (pauseStartedAt.current !== null) {
      const inactiveMs = performance.now() - pauseStartedAt.current;
      if (mathStartedAt.current !== null) {
        mathStartedAt.current += inactiveMs;
      }
      pauseStartedAt.current = null;
    }
    return () => gameAudio.setFocusMuted(false);
  }, [onPauseChange, paused]);

  useEffect(() => {
    if (!paused) return;
    focusBeforePause.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = pauseDialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (controls.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      focusBeforePause.current?.focus();
      focusBeforePause.current = null;
    };
  }, [paused]);

  useEffect(() => {
    if (!paused) return;
    const frame = window.requestAnimationFrame(() => {
      pauseDialogRef.current
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled])',
        )
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pausePage, paused]);

  useEffect(() => {
    if (action || paused) return;
    const startedAt = performance.now() - elapsedMs;
    const timer = window.setInterval(
      () => setElapsedMs(performance.now() - startedAt),
      100,
    );
    return () => window.clearInterval(timer);
  }, [action, elapsedMs, paused]);

  useEffect(() => {
    const pauseForInactiveWindow = () => setPaused(true);
    const pauseForHiddenDocument = () => {
      if (document.hidden) setPaused(true);
    };
    window.addEventListener("blur", pauseForInactiveWindow);
    document.addEventListener("visibilitychange", pauseForHiddenDocument);
    return () => {
      window.removeEventListener("blur", pauseForInactiveWindow);
      document.removeEventListener("visibilitychange", pauseForHiddenDocument);
    };
  }, []);

  useEffect(() => {
    if (!arrivalVisible || paused) return;
    const timer = window.setTimeout(
      () => setArrivalVisible(false),
      settings.reducedMotion ? 450 : 1_650,
    );
    return () => window.clearTimeout(timer);
  }, [arrivalVisible, paused, settings.reducedMotion]);

  useEffect(
    () => () => {
      if (pendingTournamentAction.current !== null) {
        window.clearTimeout(pendingTournamentAction.current);
      }
    },
    [],
  );

  const resetHand = useCallback(() => {
    setPeeked(false);
    setFoldProgress(0);
    setDragging(false);
    setAction(null);
    setRaiseOpen(false);
    setRaiseAmount(scenario.minimumRaise);
    setMathAnswer("");
    setMathResult(null);
    setGradedAttempt(null);
    setElapsedMs(0);
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
        gameAudio.play("error");
        return;
      }
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
        const deliverAction = () => {
          if (pausedRef.current) {
            pendingTournamentAction.current = window.setTimeout(
              deliverAction,
              200,
            );
            return;
          }
          pendingTournamentAction.current = null;
          tournament.onAction(request);
        };
        pendingTournamentAction.current = window.setTimeout(
          deliverAction,
          presentationDelay,
        );
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
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (paused) {
          setPaused(false);
          setPausePage("menu");
        } else if (raiseOpen) {
          setRaiseOpen(false);
        } else {
          setPaused(true);
        }
        return;
      }
      if (paused) return;

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

      if (key === " ") {
        event.preventDefault();
        if (!action) setPeeked((value) => !value);
      } else if (key === "f") {
        handleAction("fold");
      } else if (key === "c") {
        handleAction(scenario.amountToCall > 0 ? "call" : "check");
      } else if (key === "r") {
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
      } else if (key === "2") {
        submitPresetRaise("double");
      } else if (key === "5") {
        submitPresetRaise("two-five");
      } else if (key === "3") {
        submitPresetRaise("triple");
      } else if (key === "p") {
        submitPresetRaise("pot");
      } else if (key === "a") {
        submitPresetRaise("all-in");
      } else if (key === "q") {
        setCameraPan((value) => Math.max(-2, value - 1));
      } else if (key === "e") {
        setCameraPan((value) => Math.min(2, value + 1));
      } else if (key === "x") {
        setCameraPan(0);
      } else if (key === "h") {
        setHistoryOpen((value) => !value);
      } else if (key === "[" || key === "-") {
        setSpeed((value) => Math.max(0.5, value - 0.5));
      } else if (key === "]" || key === "=" || key === "+") {
        setSpeed((value) => Math.min(3, value + 0.5));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
    trainingMeta,
    tournament?.legalActions,
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
      gameAudio.play("error");
      return;
    }
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
        : "Live Field";
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

  return (
    <div className="table-screen" style={tableStyle}>
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
          <span className="decision-clock">
            <Clock3 size={15} />
            {(elapsedMs / 1000).toFixed(1)}s
          </span>
          {tournament && (
            <label className="table-speed-control">
              <FastForward size={15} />
              <span>{speed.toFixed(1)}×</span>
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
              setPausePage("menu");
              setPaused(true);
            }}
          >
            <Pause size={17} />
          </button>
          <button type="button" aria-label="Toggle table audio">
            <Volume2 size={17} />
          </button>
        </div>
      </header>

      <div className="table-layout">
        <section className="table-stage" aria-label="Six-seat poker table">
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
              onClick={() => setCameraPan((value) => Math.max(-2, value - 1))}
              aria-label="Look one seat left"
            >
              <ChevronLeft size={17} />
            </button>
            <span>Table view</span>
            <button
              type="button"
              onClick={() => setCameraPan((value) => Math.min(2, value + 1))}
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

                <div className="community-cards" aria-label="Community cards">
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
            <aside className="hand-history-popover" aria-label="Public hand history">
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
                <button type="button">Skip to result</button>
              </div>
            </div>
          )}

          {raiseOpen && !action && (
            <div className="bet-composer">
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
            result={mathResult}
            mathElo={progress.mathElo}
            onAnswer={setMathAnswer}
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
                    updateCoachState({ enabled: true, seen: [] });
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
                <button
                  className="secondary-button secondary-button--wide"
                  type="button"
                  onClick={() => setPausePage("menu")}
                >
                  Back
                </button>
              </>
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
