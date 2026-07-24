import { ArrowLeft, Check, Eye, FastForward, RotateCcw } from "lucide-react";
import { useReducer } from "react";
import {
  advancePlayableTutorial,
  createPlayableTutorial,
  TUTORIAL_MAX_BET,
  TUTORIAL_MIN_BET,
  TUTORIAL_STEP_ORDER,
  type TutorialStep,
} from "../lib/playableTutorial";
import { formatFixedDecimal } from "../lib/format";

const STEP_COPY: Record<
  TutorialStep,
  { eyebrow: string; title: string; instruction: string }
> = {
  peek: {
    eyebrow: "1 · Your private cards",
    title: "Peek before you decide",
    instruction:
      "Your hole cards belong only to you. Click the cards to reveal them.",
  },
  "legal-action": {
    eyebrow: "2 · Legal actions",
    title: "Use only the available choice",
    instruction:
      "You face no bet, so checking continues for zero chips. Calling is not possible and raising is closed in this practice beat.",
  },
  "bet-sizing": {
    eyebrow: "3 · Bet sizing",
    title: "Choose a legal amount",
    instruction:
      "The minimum is 400 and your maximum is 1,200. A 600-chip bet is 50% of the 1,200-chip pot.",
  },
  showdown: {
    eyebrow: "4 · Hand flow",
    title: "Be patient during an all-in runout",
    instruction:
      "No decision is pending: both players are all-in. Deal the turn and river one at a time, then compare five-card hands at showdown.",
  },
  math: {
    eyebrow: "5 · Read the numbers",
    title: "Chips are not odds",
    instruction:
      "These four ideas answer different questions. Read them before continuing.",
  },
  speed: {
    eyebrow: "6 · Presentation speed",
    title: "Set the table’s pace",
    instruction:
      "Speed changes how quickly opponents and cards are presented, never the cards, legal actions, or AI policy. Choose any speed except 1×.",
  },
  complete: {
    eyebrow: "Tutorial complete",
    title: "You are ready for the table",
    instruction:
      "You peeked, checked a legal action, sized a bet, waited for showdown, read the core math, and changed presentation speed.",
  },
};

const SUITS: Record<string, string> = {
  h: "♥",
  s: "♠",
  c: "♣",
  d: "♦",
};

function TutorialCard({
  card,
  hidden = false,
}: {
  card: string;
  hidden?: boolean;
}) {
  if (hidden) {
    return (
      <span className="tutorial-card tutorial-card--back" aria-label="Face-down card">
        <i />
      </span>
    );
  }
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return (
    <span
      className={`tutorial-card tutorial-card--${suit}`}
      aria-label={`${rank} ${SUITS[suit]}`}
    >
      <b>{rank}</b>
      <i>{SUITS[suit]}</i>
    </span>
  );
}

export function PlayableTutorial({ onExit }: { onExit: () => void }) {
  const [state, dispatch] = useReducer(
    advancePlayableTutorial,
    undefined,
    createPlayableTutorial,
  );
  const copy = STEP_COPY[state.step];
  const stepIndex = TUTORIAL_STEP_ORDER.indexOf(state.step);
  const activeBoard = [
    "Qh",
    "7c",
    "2h",
    ...(state.runoutCards >= 1 ? ["5h"] : []),
    ...(state.runoutCards >= 2 ? ["9s"] : []),
  ];

  return (
    <main className="playable-tutorial" aria-labelledby="tutorial-title">
      <header className="tutorial-topbar">
        <button type="button" onClick={onExit}>
          <ArrowLeft size={18} /> Choose mode
        </button>
        <div>
          <span>Playable tutorial</span>
          <strong>
            Step {Math.min(stepIndex + 1, 6)} of 6
          </strong>
        </div>
        <button type="button" onClick={() => dispatch({ type: "restart" })}>
          <RotateCcw size={17} /> Restart
        </button>
      </header>

      <div className="tutorial-progress" aria-hidden="true">
        <i
          style={{
            width: `${Math.min(100, (stepIndex / 6) * 100)}%`,
          }}
        />
      </div>

      <section className="tutorial-lesson" aria-live="polite">
        <p>{copy.eyebrow}</p>
        <h1 id="tutorial-title">{copy.title}</h1>
        <span>{copy.instruction}</span>
      </section>

      <section className="tutorial-table" aria-label="Guided poker hand">
        <div className="tutorial-pot">
          <span>Pot</span>
          <strong>1,200</strong>
          <small>Blinds 100 / 200</small>
        </div>

        <div className="tutorial-board" aria-label="Community cards">
          {activeBoard.map((card) => (
            <TutorialCard key={card} card={card} />
          ))}
          {Array.from({ length: 5 - activeBoard.length }).map((_, index) => (
            <span className="tutorial-card-slot" key={index} />
          ))}
        </div>

        <div className="tutorial-villain">
          <span>Patient Pat</span>
          <small>{state.step === "showdown" ? "All-in" : "2,800 chips"}</small>
        </div>

        <button
          className={`tutorial-hole-cards ${
            state.cardsPeeked ? "is-peeked" : ""
          }`}
          type="button"
          disabled={state.step !== "peek"}
          onClick={() => dispatch({ type: "peek" })}
          aria-label={
            state.cardsPeeked ? "Hole cards: ace and king of hearts" : "Peek at hole cards"
          }
        >
          <TutorialCard card="Ah" hidden={!state.cardsPeeked} />
          <TutorialCard card="Kh" hidden={!state.cardsPeeked} />
          {state.step === "peek" ? (
            <span>
              <Eye size={16} /> Click to peek
            </span>
          ) : null}
        </button>
      </section>

      <section className="tutorial-controls">
        {state.step === "legal-action" ? (
          <div className="tutorial-actions" aria-label="Legal poker actions">
            <button type="button" disabled>
              Fold unavailable
            </button>
            <button
              className="is-primary"
              type="button"
              onClick={() =>
                dispatch({ type: "choose-action", action: "check" })
              }
            >
              <Check size={17} /> Check
            </button>
            <button type="button" disabled>
              Raise unavailable
            </button>
          </div>
        ) : null}

        {state.step === "bet-sizing" ? (
          <div className="tutorial-bet">
            <label>
              <span>Bet amount</span>
              <input
                type="range"
                min={TUTORIAL_MIN_BET}
                max={TUTORIAL_MAX_BET}
                step="100"
                value={state.betSize}
                onChange={(event) =>
                  dispatch({
                    type: "set-bet",
                    amount: Number(event.target.value),
                  })
                }
                aria-label="Tutorial bet amount"
              />
              <output>
                {state.betSize} chips · {Math.round((state.betSize / 1_200) * 100)}%
                pot
              </output>
            </label>
            <button
              type="button"
              onClick={() => dispatch({ type: "confirm-bet" })}
            >
              Bet {state.betSize}
            </button>
          </div>
        ) : null}

        {state.step === "showdown" ? (
          <div className="tutorial-showdown">
            <p>
              {state.runoutCards === 0
                ? "The flop is complete. Wait for the turn."
                : "The turn makes your flush. The river still must be dealt before the pot is awarded."}
            </p>
            <button
              type="button"
              onClick={() => dispatch({ type: "wait-for-card" })}
            >
              {state.runoutCards === 0 ? "Deal turn" : "Deal river and show down"}
            </button>
          </div>
        ) : null}

        {state.step === "math" ? (
          <>
            <dl className="tutorial-math">
              <div>
                <dt>Chips</dt>
                <dd>The countable units in stacks and the pot.</dd>
              </div>
              <div>
                <dt>Pot odds</dt>
                <dd>A 400 call to win 2,000 total costs 20%.</dd>
              </div>
              <div>
                <dt>Equity</dt>
                <dd>Your estimated share of the pot at showdown.</dd>
              </div>
              <div>
                <dt>Expected value</dt>
                <dd>Average chips won or lost across repeated decisions.</dd>
              </div>
            </dl>
            <button
              className="tutorial-continue"
              type="button"
              onClick={() => dispatch({ type: "continue-math" })}
            >
              Continue
            </button>
          </>
        ) : null}

        {state.step === "speed" ? (
          <label className="tutorial-speed">
            <FastForward size={18} />
            <span>Opponent presentation speed</span>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.5"
              value={state.presentationSpeed}
              onChange={(event) =>
                dispatch({
                  type: "set-speed",
                  speed: Number(event.target.value),
                })
              }
            />
            <output>{formatFixedDecimal(state.presentationSpeed, 1)}×</output>
          </label>
        ) : null}

        {state.step === "complete" ? (
          <div className="tutorial-finish">
            <Check size={22} />
            <p>
              <strong>Practice is unscored.</strong>
              Start Training for coached decisions or a Tour for full hands.
            </p>
            <button type="button" onClick={onExit}>
              Return to modes
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
