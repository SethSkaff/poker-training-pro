import { useEffect, useMemo, useState } from "react";
import "./BlackjackTrainer.css";
import {
  answerTrainerSession,
  loadTrainerProgress,
  nextTrainerSession,
  saveTrainerProgress,
  trainerLevelLabel,
} from "../blackjack/trainer";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  RefreshCw,
  RotateCcw,
  Shuffle,
  TimerReset,
} from "lucide-react";
import {
  actionCode,
  actionLabel,
  BLACKJACK_RULES,
  cardFromRank,
  createSeededRng,
  createShoe,
  estimateActionEvLoss,
  formatCount,
  getAvailableActions,
  getHiLoTag,
  getInsuranceAction,
  getOptimalAction,
  getPlayingTrueCount,
  getRawTrueCount,
  getRunningCount,
  handValue,
  isNaturalBlackjack,
  shuffleShoe,
  type BlackjackAction,
  type BlackjackCard,
  type BlackjackHand,
  type InsuranceAction,
  type StrategyDecision,
} from "../blackjack/engine";
import {
  NightCircuitScene,
  ProductModeSelector,
  type ProductMode,
} from "./Dashboard";

interface BlackjackTrainerProps {
  onBack: () => void;
  onProductModeChange: (mode: ProductMode) => void;
}

type BlackjackSection = "quick-count" | "tables" | "trainer" | "guide";

const BLACKJACK_SECTIONS: readonly {
  id: BlackjackSection;
  label: string;
  kicker: string;
}[] = [
  { id: "quick-count", label: "Quick Count", kicker: "01" },
  { id: "tables", label: "Tables", kicker: "02" },
  { id: "trainer", label: "Trainer", kicker: "03" },
  { id: "guide", label: "Guide", kicker: "04" },
];

const DEAL_SPEEDS = [
  { value: 1.5, label: "Leisurely" },
  { value: 2.5, label: "Standard" },
  { value: 4, label: "Flash" },
] as const;

const COUNT_SEQUENCE_LENGTHS = [10, 25, 50] as const;

function signedUnits(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} u`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function cardClass(card: BlackjackCard): string {
  return card.suit === "♥" || card.suit === "♦" ? "is-red" : "is-black";
}

function BlackjackCardView({
  card,
  hidden = false,
  compact = false,
}: {
  card?: BlackjackCard;
  hidden?: boolean;
  compact?: boolean;
}) {
  if (hidden || !card) {
    return (
      <span
        className={`blackjack-card blackjack-card--back ${compact ? "blackjack-card--compact" : ""}`}
        aria-label="Hidden dealer card"
      >
        <span aria-hidden="true">♠</span>
      </span>
    );
  }
  return (
    <span
      className={`blackjack-card ${cardClass(card)} ${compact ? "blackjack-card--compact" : ""}`}
      aria-label={`${card.rank} of ${card.suit}`}
      data-rank={card.rank}
    >
      <strong>{card.rank}</strong>
      <span>{card.suit}</span>
    </span>
  );
}

function CardRow({ cards, compact = false }: { cards: readonly BlackjackCard[]; compact?: boolean }) {
  return (
    <div className="blackjack-card-row">
      {cards.map((card) => (
        <BlackjackCardView key={card.id ?? `${card.rank}-${card.suit}`} card={card} compact={compact} />
      ))}
    </div>
  );
}

function ProductHeader({
  onBack,
  onProductModeChange,
}: {
  onBack: () => void;
  onProductModeChange: (mode: ProductMode) => void;
}) {
  return (
    <header className="blackjack-header">
      <div className="blackjack-header__controls">
        <button className="night-back" type="button" onClick={onBack}>
          <ArrowLeft size={18} /> Back to table view
        </button>
        <ProductModeSelector value="blackjack" onChange={onProductModeChange} />
      </div>
      <div className="blackjack-header__title">
        <h1 id="blackjack-lab-title">Blackjack Lab<span aria-hidden="true">♠</span></h1>
      </div>
    </header>
  );
}

function SectionNav({
  activeSection,
  onChange,
}: {
  activeSection: BlackjackSection;
  onChange: (section: BlackjackSection) => void;
}) {
  return (
    <nav className="blackjack-section-nav" aria-label="Blackjack training modes">
      {BLACKJACK_SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className={activeSection === section.id ? "is-active" : ""}
          aria-current={activeSection === section.id ? "page" : undefined}
          onClick={() => onChange(section.id)}
        >
          <span>{section.kicker}</span>
          <strong>{section.label}</strong>
        </button>
      ))}
    </nav>
  );
}

function CountStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="blackjack-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

interface QuickAttempt {
  cards: BlackjackCard[];
  answer: number;
  correctCount: number;
  error: number;
  elapsedMs: number;
}

function QuickCountPanel() {
  const [length, setLength] = useState<number>(25);
  const [speed, setSpeed] = useState<number>(2.5);
  const [sequence, setSequence] = useState<BlackjackCard[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [phase, setPhase] = useState<"idle" | "dealing" | "holding" | "answer">("idle");
  const [answer, setAnswer] = useState("");
  const [attempt, setAttempt] = useState<QuickAttempt | null>(null);
  const [attempts, setAttempts] = useState<QuickAttempt[]>([]);
  const [startedAt, setStartedAt] = useState(0);

  useEffect(() => {
    if (phase !== "dealing") return;
    if (visibleCount >= sequence.length) {
      setPhase("holding");
      return;
    }
    const timer = window.setTimeout(
      () => setVisibleCount((current) => current + 1),
      1000 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [phase, sequence.length, speed, visibleCount]);

  useEffect(() => {
    if (phase !== "holding") return;
    const timer = window.setTimeout(() => setPhase("answer"), 1000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const startRound = () => {
    const nextSequence = shuffleShoe(createShoe(), Date.now() + length * 17).slice(0, length);
    setSequence(nextSequence);
    setVisibleCount(0);
    setAttempt(null);
    setAnswer("");
    setStartedAt(performance.now());
    setPhase("dealing");
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const numericAnswer = Number(answer);
    if (!answer.trim() || !Number.isInteger(numericAnswer) || phase !== "answer" || attempt) return;
    const correctCount = getRunningCount(sequence);
    const nextAttempt: QuickAttempt = {
      cards: sequence,
      answer: numericAnswer,
      correctCount,
      error: numericAnswer - correctCount,
      elapsedMs: Math.max(1, performance.now() - startedAt),
    };
    setAttempt(nextAttempt);
    setAttempts((current) => [...current.slice(-9), nextAttempt]);
  };

  const recentAccuracy = attempts.length
    ? attempts.filter((item) => item.error === 0).length / attempts.length
    : null;
  const averageSpeed = attempts.length
    ? attempts.reduce((sum, item) => sum + item.cards.length / (item.elapsedMs / 1000), 0) / attempts.length
    : null;
  let streak = 0;
  for (let index = attempts.length - 1; index >= 0 && attempts[index].error === 0; index -= 1) {
    streak += 1;
  }

  return (
    <section className="blackjack-panel quick-count-panel" aria-labelledby="quick-count-title">
      <div className="blackjack-panel__heading">
        <div>
          <p className="eyebrow">Raw count speed drill</p>
          <h2 id="quick-count-title">Quick Count</h2>
        </div>
        <div className="blackjack-panel__heading-mark">Hi-Lo</div>
      </div>

      <div className="blackjack-options blackjack-options--three">
        <fieldset>
          <legend>Sequence length</legend>
          <div className="blackjack-choice-row">
            {COUNT_SEQUENCE_LENGTHS.map((choice) => (
              <button
                key={choice}
                type="button"
                className={length === choice ? "is-selected" : ""}
                aria-pressed={length === choice}
                onClick={() => setLength(choice)}
              >
                {choice} cards
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Dealing speed</legend>
          <div className="blackjack-choice-row">
            {DEAL_SPEEDS.map((choice) => (
              <button
                key={choice.value}
                type="button"
                className={speed === choice.value ? "is-selected" : ""}
                aria-pressed={speed === choice.value}
                onClick={() => setSpeed(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="blackjack-option-action">
          <span>Hi-Lo tags</span>
          <strong>2–6 +1 · 7–9 0 · 10–A −1</strong>
          <button className="primary-button" type="button" onClick={startRound}>
            {phase === "dealing" || phase === "holding" ? <TimerReset size={17} /> : <Shuffle size={17} />}
            {phase === "dealing" || phase === "holding" ? "Restart sequence" : "Deal sequence"}
          </button>
        </div>
      </div>

      <div className="quick-count-stage" aria-live="polite">
        {phase === "idle" ? (
          <div className="quick-count-empty">
            <div className="quick-count-deck" aria-hidden="true"><BlackjackCardView hidden /><BlackjackCardView hidden /><BlackjackCardView hidden /></div>
            <strong>Ready to deal</strong>
          </div>
        ) : (
          <>
            <div className="quick-count-progress">
              <span>{phase === "dealing" ? "Counting the shoe…" : "Sequence complete"}</span>
              <strong>{visibleCount} / {sequence.length}</strong>
            </div>
            <div className="quick-count-cards">
              {phase === "answer" && !attempt ? (
                <form className="quick-count-answer" onSubmit={submit}>
                  <label htmlFor="quick-count-answer">Your final running count</label>
                  <div>
                    <input
                      id="quick-count-answer"
                      type="number"
                      step="1"
                      required
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      autoFocus
                    />
                    <button className="primary-button" type="submit">Grade count</button>
                  </div>
                </form>
              ) : sequence.slice(0, visibleCount).map((card, index) => (
                <BlackjackCardView key={`${card.id}-${index}`} card={card} compact />
              ))}
            </div>
          </>
        )}
      </div>

      {attempt ? (
        <div className={`blackjack-result blackjack-result--${attempt.error === 0 ? "correct" : "incorrect"}`}>
          <div>
            {attempt.error === 0 ? <Check size={21} /> : <Eye size={21} />}
            <strong>{attempt.error === 0 ? "Correct count" : "Count mismatch"}</strong>
            <span>
              You entered {formatCount(attempt.answer)} · correct RC {formatCount(attempt.correctCount)} · error {attempt.error > 0 ? "+" : ""}{attempt.error}
            </span>
          </div>
          <button className="secondary-button" type="button" onClick={startRound}>
            <RefreshCw size={16} /> Next sequence
          </button>
        </div>
      ) : null}

      <div className="blackjack-stat-grid blackjack-stat-grid--four">
        <CountStat label="Recent accuracy" value={percent(recentAccuracy)} detail={`${attempts.length} graded`} />
        <CountStat label="Effective speed" value={averageSpeed ? `${averageSpeed.toFixed(1)} cards/s` : "—"} detail="graded attempts" />
        <CountStat label="Current streak" value={streak > 0 ? String(streak) : "0"} detail="exact counts" />
        <CountStat label="Difficulty" value={length >= 50 ? "Advanced" : length >= 25 ? "Building" : "Foundation"} detail={`${DEAL_SPEEDS.find((item) => item.value === speed)?.label} pace`} />
      </div>

      {attempt ? <QuickCountReview attempt={attempt} /> : null}
    </section>
  );
}

function QuickCountReview({ attempt }: { attempt: QuickAttempt }) {
  let running = 0;
  return (
    <details className="blackjack-review-details" open>
      <summary>Review the dealt sequence and running-count progression</summary>
      <p className="blackjack-review-note">
        This is the objective progression. Because only the final count was submitted, it does not identify where your mental count changed.
      </p>
      <div className="quick-count-review-grid">
        {attempt.cards.map((card, index) => {
          running += getHiLoTag(card);
          return (
            <div key={`${card.id}-${index}`} className="quick-count-review-card">
              <span>{index + 1}</span>
              <BlackjackCardView card={card} compact />
              <em>{getHiLoTag(card) > 0 ? "+1" : getHiLoTag(card) < 0 ? "−1" : "0"}</em>
              <strong>{formatCount(running)}</strong>
            </div>
          );
        })}
      </div>
    </details>
  );
}

interface TableHandState {
  id: string;
  cards: BlackjackCard[];
  isSplitHand: boolean;
  bet: number;
  doubled: boolean;
  done: boolean;
  surrendered: boolean;
  result?: "win" | "loss" | "push" | "surrender";
  payout?: number;
}

interface TableRound {
  number: number;
  dealerUpcard: BlackjackCard;
  dealerHoleCard: BlackjackCard;
  dealerCards: BlackjackCard[];
  hands: TableHandState[];
  activeHandIndex: number;
  phase: "player" | "settled";
}

interface ExposedCardRecord {
  sequence: number;
  round: number;
  card: BlackjackCard;
  runningCount: number;
  reason: string;
}

interface TableDecisionRecord {
  id: string;
  round: number;
  hand: string;
  cards: BlackjackCard[];
  dealerUpcard: BlackjackCard;
  trueCount: number;
  rawTrueCount: number;
  action: BlackjackAction;
  recommendedAction: BlackjackAction;
  basicAction: BlackjackAction;
  deviationApplied: boolean;
  index?: number;
  explanation: string;
  followedBasic: boolean;
  evLoss: number | null;
}

interface CountCheckpoint {
  round: number;
  submitted: number;
  correctRunningCount: number;
  error: number;
  cardsSeen: number;
}

interface TablesState {
  shoe: BlackjackCard[];
  runningCount: number;
  timeline: ExposedCardRecord[];
  round: TableRound | null;
  completedRounds: number;
  handsPlayed: number;
  netUnits: number;
  decisions: TableDecisionRecord[];
  checkpoints: CountCheckpoint[];
  awaitingCheckpoint: boolean;
  review: boolean;
  lastFeedback: string;
}

function cloneTablesState(state: TablesState): TablesState {
  return {
    ...state,
    shoe: [...state.shoe],
    timeline: [...state.timeline],
    decisions: [...state.decisions],
    checkpoints: [...state.checkpoints],
    round: state.round
      ? {
          ...state.round,
          dealerCards: [...state.round.dealerCards],
          hands: state.round.hands.map((hand) => ({ ...hand, cards: [...hand.cards] })),
        }
      : null,
  };
}

function drawExposed(state: TablesState, roundNumber: number, reason: string): BlackjackCard {
  const card = state.shoe.shift();
  if (!card) throw new Error("Blackjack shoe exhausted unexpectedly");
  state.runningCount += getHiLoTag(card);
  state.timeline.push({
    sequence: state.timeline.length + 1,
    round: roundNumber,
    card,
    runningCount: state.runningCount,
    reason,
  });
  return card;
}

function drawHidden(state: TablesState): BlackjackCard {
  const card = state.shoe.shift();
  if (!card) throw new Error("Blackjack shoe exhausted unexpectedly");
  return card;
}

function revealDealerHole(state: TablesState, round: TableRound, reason: string) {
  if (round.dealerCards.some((card) => card.id === round.dealerHoleCard.id)) return;
  round.dealerCards.push(round.dealerHoleCard);
  state.runningCount += getHiLoTag(round.dealerHoleCard);
  state.timeline.push({
    sequence: state.timeline.length + 1,
    round: round.number,
    card: round.dealerHoleCard,
    runningCount: state.runningCount,
    reason,
  });
}

function finishDealer(state: TablesState, round: TableRound, playOut = true) {
  revealDealerHole(state, round, "Dealer hole card revealed");
  if (!playOut) return;
  while (true) {
    const value = handValue(round.dealerCards);
    const mustHit = value.total < 17 || (value.total === 17 && value.soft && BLACKJACK_RULES.dealerHitsSoft17);
    if (!mustHit) break;
    round.dealerCards.push(drawExposed(state, round.number, "Dealer draw"));
  }
}

function settleRound(state: TablesState, round: TableRound, playOut = true) {
  finishDealer(state, round, playOut);
  const dealerBlackjack = isNaturalBlackjack(round.dealerCards);
  const dealerTotal = handValue(round.dealerCards).total;
  let roundUnits = 0;
  round.hands = round.hands.map((hand) => {
    const wager = hand.bet * (hand.doubled ? 2 : 1);
    let payout = 0;
    let result: TableHandState["result"] = "push";
    if (hand.surrendered) {
      payout = -0.5 * hand.bet;
      result = "surrender";
    } else if (handValue(hand.cards).total > 21) {
      payout = -wager;
      result = "loss";
    } else if (dealerBlackjack && !isNaturalBlackjack(hand.cards, hand.isSplitHand)) {
      payout = -wager;
      result = "loss";
    } else if (isNaturalBlackjack(hand.cards, hand.isSplitHand) && !dealerBlackjack) {
      payout = BLACKJACK_RULES.blackjackPayout * hand.bet;
      result = "win";
    } else if (dealerTotal > 21 || handValue(hand.cards).total > dealerTotal) {
      payout = wager;
      result = "win";
    } else if (handValue(hand.cards).total === dealerTotal) {
      payout = 0;
      result = "push";
    } else {
      payout = -wager;
      result = "loss";
    }
    roundUnits += payout;
    return { ...hand, done: true, result, payout };
  });
  round.phase = "settled";
  state.completedRounds += 1;
  state.handsPlayed += round.hands.length;
  state.netUnits += roundUnits;
  state.awaitingCheckpoint = state.completedRounds % 3 === 0;
}

function startTableRound(state: TablesState) {
  if (state.shoe.length < BLACKJACK_RULES.cutCardCards) {
    state.review = true;
    state.round = null;
    return;
  }
  const number = state.completedRounds + 1;
  const playerOne = drawExposed(state, number, "Player initial card");
  const dealerUpcard = drawExposed(state, number, "Dealer upcard");
  const playerTwo = drawExposed(state, number, "Player initial card");
  const dealerHoleCard = drawHidden(state);
  const hand: TableHandState = {
    id: `hand-${number}-1`,
    cards: [playerOne, playerTwo],
    isSplitHand: false,
    bet: 1,
    doubled: false,
    done: false,
    surrendered: false,
  };
  const round: TableRound = {
    number,
    dealerUpcard,
    dealerHoleCard,
    dealerCards: [dealerUpcard],
    hands: [hand],
    activeHandIndex: 0,
    phase: "player",
  };
  state.round = round;
  const dealerBlackjack = isNaturalBlackjack([dealerUpcard, dealerHoleCard]);
  const playerBlackjack = isNaturalBlackjack(hand.cards);
  if (dealerBlackjack || playerBlackjack) {
    revealDealerHole(state, round, dealerBlackjack ? "Dealer peek" : "Natural hand settled");
    settleRound(state, round, false);
  }
}

function createTablesState(seed = Date.now()): TablesState {
  const state: TablesState = {
    shoe: shuffleShoe(createShoe(), seed),
    runningCount: 0,
    timeline: [],
    round: null,
    completedRounds: 0,
    handsPlayed: 0,
    netUnits: 0,
    decisions: [],
    checkpoints: [],
    awaitingCheckpoint: false,
    review: false,
    lastFeedback: "",
  };
  startTableRound(state);
  return state;
}

function advanceHand(state: TablesState, round: TableRound) {
  const nextIndex = round.hands.findIndex((hand) => !hand.done);
  if (nextIndex >= 0) {
    round.activeHandIndex = nextIndex;
    return;
  }
  settleRound(state, round);
}

function applyTableAction(
  source: TablesState,
  action: BlackjackAction,
): TablesState {
  const state = cloneTablesState(source);
  const round = state.round;
  if (!round || round.phase !== "player" || state.awaitingCheckpoint || state.review) return source;
  const hand = round.hands[round.activeHandIndex];
  const available = getAvailableActions(
    { cards: hand.cards, isSplitHand: hand.isSplitHand },
    round.dealerUpcard,
    BLACKJACK_RULES,
    {
      isSplitHand: hand.isSplitHand,
      splitHands: round.hands.length,
      canSurrender: !hand.isSplitHand,
    },
  );
  if (!available.includes(action)) return source;
  const decksRemaining = Math.max(state.shoe.length / 52, 1 / 52);
  const trueCount = getPlayingTrueCount(state.runningCount, decksRemaining);
  const rawTrueCount = getRawTrueCount(state.runningCount, decksRemaining);
  const decision = getOptimalAction(
    { cards: hand.cards, isSplitHand: hand.isSplitHand },
    round.dealerUpcard,
    trueCount,
    BLACKJACK_RULES,
    available,
  );
  const evLoss = estimateActionEvLoss({
    hand: { cards: hand.cards, isSplitHand: hand.isSplitHand },
    dealerUpcard: round.dealerUpcard,
    action,
    recommendedAction: decision.action,
    remainingShoe: state.shoe,
    seed: round.number * 1009 + state.decisions.length,
  });
  state.decisions.push({
    id: `${round.number}-${state.decisions.length + 1}`,
    round: round.number,
    hand: hand.id,
    cards: [...hand.cards],
    dealerUpcard: round.dealerUpcard,
    trueCount,
    rawTrueCount,
    action,
    recommendedAction: decision.action,
    basicAction: decision.basicAction,
    deviationApplied: decision.deviationApplied,
    index: decision.index,
    explanation: decision.explanation,
    followedBasic: action === decision.basicAction,
    evLoss,
  });
  state.lastFeedback = decision.deviationApplied
    ? `Recorded ${actionLabel(action)} · count deviation in scope: ${decision.deviationName ?? "index play"}.`
    : `Recorded ${actionLabel(action)} · basic-strategy comparison captured.`;

  if (action === "split") {
    const [first, second] = hand.cards;
    const firstDraw = drawExposed(state, round.number, "Split hand draw");
    const secondDraw = drawExposed(state, round.number, "Split hand draw");
    const firstHand: TableHandState = {
      ...hand,
      id: `${hand.id}-a`,
      cards: [first, firstDraw],
      isSplitHand: true,
      done: !BLACKJACK_RULES.hitSplitAces && first.rank === "A",
    };
    const secondHand: TableHandState = {
      ...hand,
      id: `${hand.id}-b`,
      cards: [second, secondDraw],
      isSplitHand: true,
      done: !BLACKJACK_RULES.hitSplitAces && second.rank === "A",
    };
    round.hands.splice(round.activeHandIndex, 1, firstHand, secondHand);
    advanceHand(state, round);
    return state;
  }

  if (action === "surrender") {
    hand.surrendered = true;
    hand.done = true;
    advanceHand(state, round);
    return state;
  }
  if (action === "stand") {
    hand.done = true;
    advanceHand(state, round);
    return state;
  }
  if (action === "double") {
    hand.doubled = true;
    hand.cards.push(drawExposed(state, round.number, "Double-down card"));
    hand.done = true;
    advanceHand(state, round);
    return state;
  }
  hand.cards.push(drawExposed(state, round.number, "Player hit"));
  const value = handValue(hand.cards);
  if (value.total >= 21) hand.done = true;
  advanceHand(state, round);
  return state;
}

function TablesPanel() {
  const [table, setTable] = useState<TablesState>(() => createTablesState());
  const [checkpointInput, setCheckpointInput] = useState("");

  const round = table.round;
  const activeHand = round && round.phase === "player" ? round.hands[round.activeHandIndex] : null;
  const availableActions = activeHand && round
    ? getAvailableActions(
        { cards: activeHand.cards, isSplitHand: activeHand.isSplitHand },
        round.dealerUpcard,
        BLACKJACK_RULES,
        {
          isSplitHand: activeHand.isSplitHand,
          splitHands: round.hands.length,
          canSurrender: !activeHand.isSplitHand,
        },
      )
    : [];

  const submitCheckpoint = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitted = Number(checkpointInput);
    if (!Number.isInteger(submitted) || !table.awaitingCheckpoint) return;
    setTable((source) => {
      const state = cloneTablesState(source);
      const correctRunningCount = state.runningCount;
      state.checkpoints.push({
        round: state.completedRounds,
        submitted,
        correctRunningCount,
        error: submitted - correctRunningCount,
        cardsSeen: state.timeline.length,
      });
      state.awaitingCheckpoint = false;
      state.lastFeedback = submitted === correctRunningCount
        ? "Exact checkpoint. The shoe count is holding."
        : `Checkpoint recorded: true RC ${formatCount(correctRunningCount)}. Review will show the first divergence.`;
      return state;
    });
    setCheckpointInput("");
  };

  const nextRound = () => {
    setTable((source) => {
      const state = cloneTablesState(source);
      if (state.review) return createTablesState();
      if (!state.round || state.round.phase !== "settled" || state.awaitingCheckpoint) return source;
      startTableRound(state);
      return state;
    });
  };

  if (table.review) {
    return <BlackjackGameReview table={table} onNewShoe={() => setTable(createTablesState())} />;
  }

  return (
    <section className="blackjack-panel blackjack-tables-panel" aria-labelledby="tables-title">
      <div className="blackjack-panel__heading">
        <div>
          <p className="eyebrow">Full-table execution</p>
          <h2 id="tables-title">Tables</h2>
        </div>
        <div className="blackjack-shoe-status">
          <span>Shoe depth · {BLACKJACK_RULES.decks} decks</span>
          <strong>{table.shoe.length} cards</strong>
          <meter aria-label="Cards remaining in shoe" min={0} max={BLACKJACK_RULES.decks * 52} value={table.shoe.length} />
          <small>{BLACKJACK_RULES.dealerHitsSoft17 ? "H17" : "S17"} · {BLACKJACK_RULES.doubleAfterSplit ? "DAS" : "No DAS"} · {BLACKJACK_RULES.lateSurrender ? "LS" : "No LS"}</small>
        </div>
      </div>

      {round ? (
        <div className="blackjack-felt" data-table-phase={round.phase}>
          <div className="blackjack-table-rail"><span>Round {round.number}</span><span>{table.handsPlayed} hands · {signedUnits(table.netUnits)}</span></div>
          <div className="blackjack-felt__dealer">
            <span className="blackjack-felt__label">Dealer</span>
            <div className="blackjack-card-row">
              {round.phase === "settled" ? round.dealerCards.map((card) => <BlackjackCardView key={card.id} card={card} />) : <><BlackjackCardView card={round.dealerUpcard} /><BlackjackCardView hidden /></>}
            </div>
            {round.phase === "settled" ? (
              <strong className="blackjack-total">{handValue(round.dealerCards).total > 21 ? "Bust" : `Total ${handValue(round.dealerCards).total}`}</strong>
            ) : null}
          </div>
          <div className="blackjack-felt__divider" aria-hidden="true"><span>Blackjack pays 3 : 2</span></div>
          <div className="blackjack-felt__player">
            <span className="blackjack-felt__label">Player hand{round.hands.length > 1 ? "s" : ""}</span>
            <div className="blackjack-hand-stack">
              {round.hands.map((hand, index) => (
                <div key={hand.id} className={`blackjack-hand-line ${index === round.activeHandIndex && round.phase === "player" ? "is-active" : ""} ${hand.done ? "is-done" : ""}`}>
                  <span className="blackjack-hand-line__name">{hand.id.split("-").pop() === "1" ? "Hand 1" : `Hand ${index + 1}`}</span>
                  <CardRow cards={hand.cards} />
                  <strong className="blackjack-total">{handValue(hand.cards).total > 21 ? "Bust" : handValue(hand.cards).total}</strong>
                  {hand.result ? <em className={`blackjack-hand-result blackjack-hand-result--${hand.result}`}>{hand.result} {signedUnits(hand.payout ?? 0)}</em> : null}
                </div>
              ))}
            </div>
          </div>
          {round.phase === "settled" ? (
            <div className="blackjack-round-result">
              <strong>Round settled</strong>
              <span>Session {signedUnits(table.netUnits)}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="blackjack-felt blackjack-felt--empty">The cut card is near. Review this shoe before starting another.</div>
      )}

      {round?.phase === "player" && activeHand ? (
        <div className="blackjack-action-console">
          <div className="blackjack-action-buttons">
            {(["hit", "stand", "double", "split", "surrender"] as const)
              .filter((action) => availableActions.includes(action))
              .map((action) => (
                <button
                  key={action}
                  type="button"
                  className={`blackjack-play-action action-${action}`}
                  onClick={() => setTable((source) => applyTableAction(source, action))}
                >
                  <span>{actionCode(action)}</span>{actionLabel(action)}
                </button>
              ))}
          </div>
        </div>
      ) : null}

      {round?.phase === "settled" && table.awaitingCheckpoint ? (
        <form className="blackjack-checkpoint" onSubmit={submitCheckpoint}>
          <div>
            <p className="eyebrow">Count checkpoint · end of round {table.completedRounds}</p>
            <strong>What is your current running count?</strong>
          </div>
          <label>
            <span className="visually-hidden">Your running count</span>
            <input type="number" step="1" value={checkpointInput} onChange={(event) => setCheckpointInput(event.target.value)} autoFocus />
          </label>
          <button className="primary-button" type="submit">Log checkpoint</button>
        </form>
      ) : null}

      {round?.phase === "settled" && !table.awaitingCheckpoint ? (
        <div className="blackjack-round-actions">
          <button className="primary-button" type="button" onClick={nextRound}><ChevronRight size={17} /> Deal next round</button>
          <button className="secondary-button" type="button" onClick={() => setTable((source) => ({ ...source, review: true }))}><BookOpen size={17} /> Game Review</button>
        </div>
      ) : null}

    </section>
  );
}

function buildTableReview(table: TablesState) {
  const exactChecks = table.checkpoints.filter((checkpoint) => checkpoint.error === 0).length;
  const largestError = table.checkpoints.reduce<CountCheckpoint | null>((largest, checkpoint) => {
    if (!largest || Math.abs(checkpoint.error) > Math.abs(largest.error)) return checkpoint;
    return largest;
  }, null);
  const firstDivergence = table.checkpoints.find((checkpoint) => checkpoint.error !== 0) ?? null;
  const correctDecisions = table.decisions.filter((record) => record.action === record.recommendedAction).length;
  const basicDecisions = table.decisions.filter((record) => record.followedBasic).length;
  const deviationRecords = table.decisions.filter((record) => record.deviationApplied);
  const correctDeviations = deviationRecords.filter((record) => record.action === record.recommendedAction).length;
  const missedDeviations = deviationRecords.filter((record) => record.action === record.basicAction).length;
  const incorrectDeviations = deviationRecords.filter((record) => record.action !== record.recommendedAction && record.action !== record.basicAction).length;
  const evSamples = table.decisions.map((record) => record.evLoss).filter((value): value is number => value !== null);
  return {
    countAccuracy: table.checkpoints.length ? exactChecks / table.checkpoints.length : null,
    largestError,
    firstDivergence,
    correctDecisions,
    basicDecisions,
    countAdjustedAccuracy: table.decisions.length ? correctDecisions / table.decisions.length : null,
    deviationAccuracy: deviationRecords.length ? correctDeviations / deviationRecords.length : null,
    missedDeviations,
    incorrectDeviations,
    estimatedEvLoss: evSamples.length ? evSamples.reduce((sum, value) => sum + value, 0) : null,
  };
}

function BlackjackGameReview({ table, onNewShoe }: { table: TablesState; onNewShoe: () => void }) {
  const review = buildTableReview(table);
  const errors = table.decisions.filter((record) => record.action !== record.recommendedAction);
  const cardsBeforeDivergence = review.firstDivergence
    ? table.timeline.filter((record) => record.sequence <= review.firstDivergence!.cardsSeen).slice(-8)
    : [];
  return (
    <section className="blackjack-panel blackjack-game-review" aria-labelledby="blackjack-review-title">
      <div className="blackjack-panel__heading">
        <div>
          <p className="eyebrow">Post-shoe analysis</p>
          <h2 id="blackjack-review-title">Game Review</h2>
          <p>Every exposed card, count checkpoint, and decision is replayable from this shoe.</p>
        </div>
        <button className="primary-button" type="button" onClick={onNewShoe}><RotateCcw size={17} /> New shoe</button>
      </div>

      <div className="blackjack-stat-grid blackjack-stat-grid--four">
        <CountStat label="Count accuracy" value={percent(review.countAccuracy)} detail={`${table.checkpoints.length} checkpoints`} />
        <CountStat label="Basic-strategy decisions" value={percent(table.decisions.length ? review.basicDecisions / table.decisions.length : null)} detail={`${review.basicDecisions} / ${table.decisions.length}`} />
        <CountStat label="Count-adjusted decisions" value={percent(review.countAdjustedAccuracy)} detail={`${review.correctDecisions} optimal`} />
        <CountStat label="Estimated EV lost" value={review.estimatedEvLoss === null ? "—" : signedUnits(-review.estimatedEvLoss)} detail={review.estimatedEvLoss === null ? "not enough evaluable actions" : "seeded shoe simulation"} />
      </div>

      <div className="blackjack-review-summary-grid">
        <div className="blackjack-review-card-panel">
          <span>Hands played</span><strong>{table.handsPlayed}</strong>
          <small>{table.completedRounds} rounds · {signedUnits(table.netUnits)} net</small>
        </div>
        <div className="blackjack-review-card-panel">
          <span>Deviation work</span><strong>{review.deviationAccuracy === null ? "—" : percent(review.deviationAccuracy)}</strong>
          <small>{review.missedDeviations} missed · {review.incorrectDeviations} incorrect</small>
        </div>
        <div className="blackjack-review-card-panel">
          <span>Largest count error</span>
          <strong>{review.largestError ? `${formatCount(review.largestError.correctRunningCount)} → ${formatCount(review.largestError.submitted)}` : "—"}</strong>
          <small>{review.largestError ? `absolute error ${Math.abs(review.largestError.error)}` : "No submitted checkpoints"}</small>
        </div>
      </div>

      {review.firstDivergence ? (
        <div className="blackjack-divergence-callout">
          <div>
            <p className="eyebrow">First checkpoint divergence</p>
            <strong>Round {review.firstDivergence.round}: submitted {formatCount(review.firstDivergence.submitted)}, true RC {formatCount(review.firstDivergence.correctRunningCount)}</strong>
            <small>This identifies the first submitted checkpoint that diverged. It does not claim a specific card caused the error.</small>
          </div>
          <div className="blackjack-divergence-cards">
            {cardsBeforeDivergence.map((record) => <BlackjackCardView key={record.sequence} card={record.card} compact />)}
          </div>
        </div>
      ) : null}

      <div className="blackjack-review-columns">
        <div>
          <h3>Decision errors</h3>
          {errors.length === 0 ? <p className="blackjack-empty-copy">No recorded decision errors in this shoe.</p> : (
            <div className="blackjack-error-list">
              {errors.slice(0, 12).map((record) => (
                <details key={record.id}>
                  <summary>
                    <span>Round {record.round} · {record.cards.map((card) => card.rank).join(", ")} vs {record.dealerUpcard.rank}</span>
                    <strong>{actionLabel(record.action)} → {actionLabel(record.recommendedAction)}</strong>
                  </summary>
                  <p>TC {formatCount(record.trueCount)} · User: {actionLabel(record.action)} · Correct: {actionLabel(record.recommendedAction)} · Basic: {actionLabel(record.basicAction)}</p>
                  <p>{record.deviationApplied ? `${record.explanation} Index ${formatCount(record.index ?? 0)}.` : record.explanation}</p>
                </details>
              ))}
            </div>
          )}
        </div>
        <div>
          <h3>Count-check history</h3>
          {table.checkpoints.length === 0 ? <p className="blackjack-empty-copy">No checkpoints submitted.</p> : (
            <div className="blackjack-check-history">
              {table.checkpoints.map((checkpoint) => (
                <div key={checkpoint.round}>
                  <span>Round {checkpoint.round}</span>
                  <strong className={checkpoint.error === 0 ? "is-correct" : "is-error"}>{formatCount(checkpoint.submitted)}</strong>
                  <small>True {formatCount(checkpoint.correctRunningCount)} · error {checkpoint.error > 0 ? "+" : ""}{checkpoint.error}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <details className="blackjack-review-details blackjack-review-details--timeline">
        <summary>Shoe timeline / replay · {table.timeline.length} exposed cards</summary>
        <div className="blackjack-timeline">
          {table.timeline.map((record) => (
            <div key={record.sequence}>
              <span>{record.sequence}</span>
              <BlackjackCardView card={record.card} compact />
              <strong>{formatCount(getHiLoTag(record.card))}</strong>
              <b>{formatCount(record.runningCount)}</b>
              <small>{record.reason}</small>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

const trainerCard = (rank: BlackjackCard["rank"], suit: BlackjackCard["suit"] = "♠") => cardFromRank(rank, suit);

function TrainerPanel() {
  const [session, setSession] = useState(() => nextTrainerSession(loadTrainerProgress()));
  const [saved, setSaved] = useState(true);
  const { scenario, progress, result } = session;
  useEffect(() => {
    setSaved(saveTrainerProgress(progress));
  }, [progress]);

  const next = () => setSession((current) => current.result ? nextTrainerSession(current.progress) : current);
  const answerAction = (action: BlackjackAction) => setSession((current) => answerTrainerSession(current, action));
  const answerInsurance = (action: InsuranceAction) => setSession((current) => answerTrainerSession(current, action));
  const resultDecision = !result ? null : scenario.kind === "action"
    ? getOptimalAction(scenario.hand, scenario.dealerUpcard, scenario.trueCount, BLACKJACK_RULES, scenario.availableActions)
    : getInsuranceAction(scenario.trueCount);
  const resultCorrect = result?.correct ?? false;
  return (
    <section className="blackjack-panel blackjack-trainer-panel" aria-labelledby="trainer-title">
      <div className="blackjack-panel__heading">
        <div>
          <p className="eyebrow">Adaptive strategy practice</p>
          <h2 id="trainer-title">Trainer</h2>
        </div>
        <div className="blackjack-trainer-score"><span>ELO</span><strong>{progress.elo}</strong><small>{trainerLevelLabel(progress.elo)}<br />{progress.correct} / {progress.answered} correct</small></div>
      </div>
      <p>Fresh hands matched to your rating. Practice basic strategy and count decisions, with more close calls as you improve.</p>
      {!saved ? <p role="status">Progress is kept for this session. Local saving is unavailable.</p> : null}

      <div className="trainer-scenario-card">
        <div className="trainer-scenario-card__meta">
          <span>Scenario {progress.answered + (result ? 0 : 1)}</span>
          <strong>{BLACKJACK_RULES.decks} decks · {BLACKJACK_RULES.dealerHitsSoft17 ? "H17" : "S17"} · Hi-Lo</strong>
          <div className="trainer-count"><span>True count</span><b><small>TC</small> {formatCount(scenario.trueCount)}</b></div>
        </div>
        <p className="trainer-scenario-card__prompt">{scenario.kind === "insurance" ? "Insurance?" : "Your move"}</p>
        <div className="trainer-hand-layout">
          <div><span>Player</span><CardRow cards={scenario.hand.cards} /><strong>Total {handValue(scenario.hand.cards).total}{handValue(scenario.hand.cards).soft ? " · soft" : ""}</strong></div>
          <div className="trainer-vs">vs</div>
          <div><span>Dealer upcard</span><CardRow cards={[scenario.dealerUpcard]} /><strong>{scenario.dealerUpcard.rank}</strong></div>
        </div>
        {scenario.kind === "action" ? (
          <div className="trainer-availability"><span>Legal actions</span>{scenario.availableActions.map((action) => <em key={action}>{actionLabel(action)}</em>)}</div>
        ) : <div className="trainer-availability"><em>Insurance offered</em></div>}
      </div>

      {!result ? (
        <div className="trainer-answer-grid">
          {scenario.kind === "action"
            ? (["hit", "stand", "double", "split", "surrender"] as const).filter((action) => scenario.availableActions.includes(action)).map((action) => (
                <button key={action} type="button" className={`trainer-answer-button action-${action}`} onClick={() => answerAction(action)}><strong>{actionLabel(action)}</strong><small>{actionCode(action)}</small></button>
              ))
            : (["decline", "insurance"] as const).map((action) => (
                <button key={action} type="button" className="trainer-answer-button" onClick={() => answerInsurance(action)}><strong>{action === "insurance" ? "Take insurance" : "Decline"}</strong><small>{action === "insurance" ? "I" : "—"}</small></button>
              ))}
        </div>
      ) : (
        <div className={`trainer-result ${resultCorrect ? "is-correct" : "is-incorrect"}`}>
          <div className="trainer-result__headline"><span>{resultCorrect ? "Correct" : "Incorrect"}</span><strong>{scenario.kind === "action" ? actionLabel((resultDecision as StrategyDecision).action) : actionLabel(resultDecision as InsuranceAction)}</strong></div>
          <p>ELO {formatCount(result.eloDelta)} · {progress.elo}</p>
          {scenario.kind === "action" && resultDecision ? (
            <div className="trainer-result__explanation">
              <p><strong>Basic strategy:</strong> {actionLabel((resultDecision as StrategyDecision).basicAction)}</p>
              <p><strong>Count play:</strong> {(resultDecision as StrategyDecision).deviationApplied ? "The count changes the basic-strategy action." : "Keep the basic-strategy action at this count."}</p>
              <p>{(resultDecision as StrategyDecision).explanation}</p>
              {scenario.lesson === "foundation" ? <p>No I18/Fab 4 playing index changes this action across the trainer’s count range. The count alone is not a reason to switch.</p> : !(resultDecision as StrategyDecision).deviationApplied ? <p>This hand has a count-dependent decision, but this count stays on the basic-strategy side of the threshold.</p> : null}
            </div>
          ) : <p className="trainer-result__explanation"><strong>Hi-Lo insurance index:</strong> take insurance at TC +3 or greater. At TC {formatCount(scenario.trueCount)}, the correct answer is {actionLabel(resultDecision as InsuranceAction)}.</p>}
          <button className="primary-button" type="button" onClick={next}><ChevronRight size={17} /> Next scenario</button>
        </div>
      )}

    </section>
  );
}

interface StrategyRow {
  label: string;
  hand: BlackjackCard[];
}

const DEALER_COLUMNS: readonly BlackjackCard["rank"][] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"];

function hardHand(total: number): BlackjackCard[] {
  if (total <= 11) return [trainerCard("6"), trainerCard(String(total - 6) as BlackjackCard["rank"], "♥")];
  if (total === 20) return [trainerCard("10"), trainerCard("K", "♥")];
  return [trainerCard("10"), trainerCard(String(total - 10) as BlackjackCard["rank"], "♥")];
}

function softHand(total: number): BlackjackCard[] {
  return [trainerCard("A"), trainerCard(String(total - 11) as BlackjackCard["rank"], "♥")];
}

function pairHand(rank: BlackjackCard["rank"]): BlackjackCard[] {
  return [trainerCard(rank), trainerCard(rank, "♥")];
}

function StrategyMatrix({ title, rows, trueCount }: { title: string; rows: StrategyRow[]; trueCount: number }) {
  return (
    <section className="blackjack-strategy-section" aria-labelledby={`strategy-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <div className="blackjack-strategy-section__heading"><h3 id={`strategy-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h3><span>Dealer upcard</span></div>
      <div className="blackjack-strategy-table-wrap">
        <table className="blackjack-strategy-table">
          <thead><tr><th scope="col">Player</th>{DEALER_COLUMNS.map((rank) => <th key={rank} scope="col">{rank}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {DEALER_COLUMNS.map((rank) => {
                  const hand = { cards: row.hand };
                  const dealer = trainerCard(rank, rank === "A" ? "♦" : "♣");
                  const available = getAvailableActions(hand, dealer, BLACKJACK_RULES, { canSurrender: true });
                  const decision = getOptimalAction(hand, dealer, trueCount, BLACKJACK_RULES, available);
                  const changed = decision.action !== decision.basicAction;
                  return (
                    <td key={rank}>
                      <div className={`strategy-tile action-${decision.action} ${changed ? "is-changed" : ""}`}
                        aria-label={`${row.label} vs ${rank}: ${actionLabel(decision.action)}${changed ? `; basic ${actionLabel(decision.basicAction)}, index ${formatCount(decision.index ?? 0)}` : ""}`}
                        title={changed ? `Basic: ${actionLabel(decision.basicAction)} · TC ${formatCount(trueCount)}: ${actionLabel(decision.action)} · Index ${formatCount(decision.index ?? 0)}` : actionLabel(decision.action)}>
                        <span aria-hidden="true">{actionCode(decision.action)}</span>
                        {changed ? <em aria-hidden="true">{formatCount(decision.index ?? 0)}</em> : null}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GuidePanel() {
  const [trueCount, setTrueCount] = useState(0);
  const sliderValue = Math.min(10, Math.max(-10, trueCount));
  const insuranceAction = getInsuranceAction(trueCount);
  const hardRows: StrategyRow[] = Array.from({ length: 13 }, (_, index) => {
    const total = index + 8;
    return { label: `${total}`, hand: hardHand(total) };
  });
  const softRows: StrategyRow[] = Array.from({ length: 8 }, (_, index) => {
    const total = index + 13;
    return { label: `A,${total - 11}`, hand: softHand(total) };
  });
  const pairRows: StrategyRow[] = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "A"].map((rank) => ({
    label: `${rank},${rank}`,
    hand: pairHand(rank as BlackjackCard["rank"]),
  }));

  return (
    <section className="blackjack-panel blackjack-guide-panel" aria-labelledby="guide-title">
      <div className="guide-controls">
        <div className="guide-identity"><h2 id="guide-title">Guide</h2><span>{BLACKJACK_RULES.decks}D · {BLACKJACK_RULES.dealerHitsSoft17 ? "H17" : "S17"} · {BLACKJACK_RULES.doubleAfterSplit ? "DAS" : "No DAS"} · {BLACKJACK_RULES.lateSurrender ? "LS" : "No LS"}</span></div>
        <label className="blackjack-tc-entry">True count
          <input aria-label="Direct true count" type="number" step="1" value={trueCount} onChange={(event) => setTrueCount(Number.isFinite(Number(event.target.value)) ? Math.floor(Number(event.target.value)) : 0)} />
        </label>
        <div className="blackjack-slider-wrap">
          <input aria-label="True count strategy slider" aria-valuetext={formatCount(trueCount)} type="range" min="-10" max="10" step="1" value={sliderValue} onChange={(event) => setTrueCount(Number(event.target.value))} />
          <div><span>−10</span><span>{Math.abs(trueCount) > 10 ? "Beyond slider range" : "HI-LO"}</span><span>+10</span></div>
        </div>
        <div className="blackjack-legend" aria-label="Strategy action colors">
          {(["hit", "stand", "double", "surrender", "split"] as const).map((action) => <span key={action}><b className={`action-${action}`}>{actionCode(action)}</b>{actionLabel(action)}</span>)}
          <span className="blackjack-legend__changed"><b>+n</b>Index change</span>
        </div>
      </div>
      <div className="strategy-board">
        <StrategyMatrix title="Hard totals" rows={hardRows} trueCount={trueCount} />
        <div className="strategy-board__column">
          <StrategyMatrix title="Soft totals" rows={softRows} trueCount={trueCount} />
          <div className="guide-hilo" aria-label="Hi-Lo card tags">
            <span><b>+1</b>2–6</span><span><b>0</b>7–9</span><span><b>−1</b>10–A</span>
          </div>
          <div className="guide-count-formula">TC = RC ÷ decks remaining <span>Round down</span></div>
        </div>
        <div className="strategy-board__column">
          <StrategyMatrix title="Pairs" rows={pairRows} trueCount={trueCount} />
          <div className={`blackjack-insurance-guide ${insuranceAction === "insurance" ? "is-active" : ""}`} aria-live="polite">
            <span>Insurance vs A<small>Index +3</small></span><strong>{insuranceAction === "insurance" ? "Take insurance" : "Decline"}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

export function BlackjackTrainer({ onBack, onProductModeChange }: BlackjackTrainerProps) {
  const [activeSection, setActiveSection] = useState<BlackjackSection>("quick-count");

  return (
    <main className="night-shell blackjack-shell" aria-labelledby="blackjack-lab-title">
      <NightCircuitScene quiet />
      <div className="blackjack-shell__surface">
        <ProductHeader onBack={onBack} onProductModeChange={onProductModeChange} />
        <SectionNav activeSection={activeSection} onChange={setActiveSection} />
        <div className="blackjack-content">
          {activeSection === "quick-count" ? <QuickCountPanel /> : null}
          {activeSection === "tables" ? <TablesPanel /> : null}
          {activeSection === "trainer" ? <TrainerPanel /> : null}
          {activeSection === "guide" ? <GuidePanel /> : null}
        </div>
      </div>
    </main>
  );
}
