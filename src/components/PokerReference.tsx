import { formatMessage } from "../lib/localeMessages";

/**
 * The standalone poker reference: hand rankings, betting and tournament terms,
 * probability shortcuts, and worked examples.
 *
 * This content previously existed only inside the in-hand pause menu, which
 * meant it was unreachable at exactly the moment a player is most likely to
 * want it — before sitting down, or while deciding whether to. Extracting it
 * lets the same markup serve both the pause page and a menu-reachable screen,
 * so the two can never drift apart.
 */

const FORMULA_KEYS = [
  "potOdds",
  "equity",
  "spr",
  "minRaise",
  "sidePot",
  "bubble",
  "workedCall",
  "shortcut",
  "ruleOf2And4",
  "expectedValue",
] as const;

const HAND_RANK_KEYS = [
  "royalFlush",
  "straightFlush",
  "fourOfAKind",
  "fullHouse",
  "flush",
  "straight",
  "threeOfAKind",
  "twoPair",
  "pair",
  "highCard",
] as const;

const MODE_KEYS = ["normal", "rational", "training", "timed"] as const;
const RATING_KEYS = ["decisionElo", "mathElo", "tournamentElo", "review"] as const;

/**
 * "How this trainer works" (E21-004).
 *
 * A poker-literate player does not need a beginner course, but they do need to
 * know what each mode is optimizing and how they are being scored — otherwise
 * the modes look interchangeable and the ratings look arbitrary. It states the
 * Rational information boundary explicitly, because "the maths opponent" is
 * otherwise easy to mistake for one that can see your cards.
 */
export function TrainerOrientationContent() {
  return (
    <div className="reference-orientation">
      <h2>{formatMessage("orientation.modesHeading")}</h2>
      <dl>
        {MODE_KEYS.map((key) => (
          <div key={key}>
            <dt>{formatMessage(`modes.${key}.name`)}</dt>
            <dd>{formatMessage(`orientation.mode.${key}`)}</dd>
          </div>
        ))}
      </dl>
      <h2>{formatMessage("orientation.ratingsHeading")}</h2>
      <dl>
        {RATING_KEYS.map((key) => (
          <div key={key}>
            <dt>{formatMessage(`orientation.rating.${key}.label`)}</dt>
            <dd>{formatMessage(`orientation.rating.${key}.desc`)}</dd>
          </div>
        ))}
      </dl>
      <p className="reference-orientation__boundary">
        {formatMessage("orientation.informationBoundary")}
      </p>
    </div>
  );
}

export function PokerReferenceContent() {
  return (
    <>
      <ol className="hand-ranking-list">
        {HAND_RANK_KEYS.map((key) => (
          <li key={key}>{formatMessage(`table.handRank.${key}`)}</li>
        ))}
      </ol>
      <div className="pause-formulas">
        {FORMULA_KEYS.map((key) => (
          <p key={key}>
            <strong>{formatMessage(`table.formula.${key}.label`)}</strong>{" "}
            {formatMessage(`table.formula.${key}.desc`)}
          </p>
        ))}
      </div>
    </>
  );
}
