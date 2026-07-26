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
