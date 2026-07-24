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
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";

const STEP_COPY: Record<
  TutorialStep,
  { eyebrow: string; title: string; instruction: string }
> = {
  peek: {
    eyebrow: formatMessage("tutorial.step.peek.eyebrow"),
    title: formatMessage("tutorial.step.peek.title"),
    instruction: formatMessage("tutorial.step.peek.instruction"),
  },
  "legal-action": {
    eyebrow: formatMessage("tutorial.step.legalAction.eyebrow"),
    title: formatMessage("tutorial.step.legalAction.title"),
    instruction: formatMessage("tutorial.step.legalAction.instruction"),
  },
  "bet-sizing": {
    eyebrow: formatMessage("tutorial.step.betSizing.eyebrow"),
    title: formatMessage("tutorial.step.betSizing.title"),
    instruction: formatMessage("tutorial.step.betSizing.instruction"),
  },
  showdown: {
    eyebrow: formatMessage("tutorial.step.showdown.eyebrow"),
    title: formatMessage("tutorial.step.showdown.title"),
    instruction: formatMessage("tutorial.step.showdown.instruction"),
  },
  math: {
    eyebrow: formatMessage("tutorial.step.math.eyebrow"),
    title: formatMessage("tutorial.step.math.title"),
    instruction: formatMessage("tutorial.step.math.instruction"),
  },
  speed: {
    eyebrow: formatMessage("tutorial.step.speed.eyebrow"),
    title: formatMessage("tutorial.step.speed.title"),
    instruction: formatMessage("tutorial.step.speed.instruction"),
  },
  complete: {
    eyebrow: formatMessage("tutorial.step.complete.eyebrow"),
    title: formatMessage("tutorial.step.complete.title"),
    instruction: formatMessage("tutorial.step.complete.instruction"),
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
      <span
        className="tutorial-card tutorial-card--back"
        aria-label={formatMessage("cards.faceDown")}
      >
        <i />
      </span>
    );
  }
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return (
    <span
      className={`tutorial-card tutorial-card--${suit}`}
      aria-label={formatMessage("tutorial.card.rankSuit", {
        rank,
        suit: SUITS[suit],
      })}
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
    <main
      className="playable-tutorial"
      aria-labelledby="tutorial-title"
      {...localeTextAttributes()}
    >
      <header className="tutorial-topbar">
        <button type="button" onClick={onExit}>
          <ArrowLeft size={18} /> {formatMessage("dashboard.nav.backToModes")}
        </button>
        <div>
          <span>{formatMessage("tutorial.header.label")}</span>
          <strong>
            {formatMessage("tutorial.header.stepProgress", {
              step: Math.min(stepIndex + 1, 6),
            })}
          </strong>
        </div>
        <button type="button" onClick={() => dispatch({ type: "restart" })}>
          <RotateCcw size={17} /> {formatMessage("tutorial.header.restart")}
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

      <section
        className="tutorial-table"
        aria-label={formatMessage("tutorial.table.ariaLabel")}
      >
        <div className="tutorial-pot">
          <span>{formatMessage("table.readout.potLabel")}</span>
          <strong>1,200</strong>
          <small>{formatMessage("tutorial.pot.blinds", { small: 100, big: 200 })}</small>
        </div>

        <div
          className="tutorial-board"
          aria-label={formatMessage("table.communityCards.ariaLabel")}
        >
          {activeBoard.map((card) => (
            <TutorialCard key={card} card={card} />
          ))}
          {Array.from({ length: 5 - activeBoard.length }).map((_, index) => (
            <span className="tutorial-card-slot" key={index} />
          ))}
        </div>

        <div className="tutorial-villain">
          <span>{formatMessage("tutorial.villain.name")}</span>
          <small>
            {state.step === "showdown"
              ? formatMessage("table.seat.allIn")
              : formatMessage("tutorial.villain.chips")}
          </small>
        </div>

        <button
          className={`tutorial-hole-cards ${
            state.cardsPeeked ? "is-peeked" : ""
          }`}
          type="button"
          disabled={state.step !== "peek"}
          onClick={() => dispatch({ type: "peek" })}
          aria-label={
            state.cardsPeeked
              ? formatMessage("tutorial.holeCards.revealedAriaLabel")
              : formatMessage("tutorial.holeCards.peekAriaLabel")
          }
        >
          <TutorialCard card="Ah" hidden={!state.cardsPeeked} />
          <TutorialCard card="Kh" hidden={!state.cardsPeeked} />
          {state.step === "peek" ? (
            <span>
              <Eye size={16} /> {formatMessage("tutorial.holeCards.clickToPeek")}
            </span>
          ) : null}
        </button>
      </section>

      <section className="tutorial-controls">
        {state.step === "legal-action" ? (
          <div
            className="tutorial-actions"
            aria-label={formatMessage("tutorial.actions.ariaLabel")}
          >
            <button type="button" disabled>
              {formatMessage("tutorial.actions.foldUnavailable")}
            </button>
            <button
              className="is-primary"
              type="button"
              onClick={() =>
                dispatch({ type: "choose-action", action: "check" })
              }
            >
              <Check size={17} /> {formatMessage("table.action.check")}
            </button>
            <button type="button" disabled>
              {formatMessage("tutorial.actions.raiseUnavailable")}
            </button>
          </div>
        ) : null}

        {state.step === "bet-sizing" ? (
          <div className="tutorial-bet">
            <label>
              <span>{formatMessage("tutorial.bet.amountLabel")}</span>
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
                aria-label={formatMessage("tutorial.bet.ariaLabel")}
              />
              <output>
                {formatMessage("tutorial.bet.output", {
                  amount: state.betSize,
                  percent: Math.round((state.betSize / 1_200) * 100),
                })}
              </output>
            </label>
            <button
              type="button"
              onClick={() => dispatch({ type: "confirm-bet" })}
            >
              {formatMessage("tutorial.bet.confirmButton", { amount: state.betSize })}
            </button>
          </div>
        ) : null}

        {state.step === "showdown" ? (
          <div className="tutorial-showdown">
            <p>
              {state.runoutCards === 0
                ? formatMessage("tutorial.showdown.waitTurn")
                : formatMessage("tutorial.showdown.waitRiver")}
            </p>
            <button
              type="button"
              onClick={() => dispatch({ type: "wait-for-card" })}
            >
              {state.runoutCards === 0
                ? formatMessage("tutorial.showdown.dealTurn")
                : formatMessage("tutorial.showdown.dealRiverShowdown")}
            </button>
          </div>
        ) : null}

        {state.step === "math" ? (
          <>
            <dl className="tutorial-math">
              <div>
                <dt>{formatMessage("tutorial.math.chips.label")}</dt>
                <dd>{formatMessage("tutorial.math.chips.desc")}</dd>
              </div>
              <div>
                <dt>{formatMessage("table.formula.potOdds.label")}</dt>
                <dd>{formatMessage("tutorial.math.potOdds.desc")}</dd>
              </div>
              <div>
                <dt>{formatMessage("table.formula.equity.label")}</dt>
                <dd>{formatMessage("tutorial.math.equity.desc")}</dd>
              </div>
              <div>
                <dt>{formatMessage("table.formula.expectedValue.label")}</dt>
                <dd>{formatMessage("tutorial.math.expectedValue.desc")}</dd>
              </div>
            </dl>
            <button
              className="tutorial-continue"
              type="button"
              onClick={() => dispatch({ type: "continue-math" })}
            >
              {formatMessage("common.continue")}
            </button>
          </>
        ) : null}

        {state.step === "speed" ? (
          <label className="tutorial-speed">
            <FastForward size={18} />
            <span>{formatMessage("shared.opponentPresentationSpeed")}</span>
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
              <strong>{formatMessage("tutorial.complete.unscored")}</strong>
              {formatMessage("tutorial.complete.nextSteps")}
            </p>
            <button type="button" onClick={onExit}>
              {formatMessage("tutorial.complete.returnToModes")}
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
