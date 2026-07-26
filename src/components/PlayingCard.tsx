import { cardAriaLabel } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
import type { Card } from "../types/poker";

/**
 * A single rendered card.
 *
 * Extracted from `PokerTable` so surfaces outside the table — the post-round
 * review in particular — can show cards without importing the whole
 * code-split table module.
 */

const suitGlyph: Record<Card["suit"], string> = {
  clubs: "♣",
  diamonds: "♦",
  hearts: "♥",
  spades: "♠",
};

export function PlayingCard({
  card,
  hidden = false,
  small = false,
  className,
}: {
  card: Card;
  hidden?: boolean;
  small?: boolean;
  className?: string;
}) {
  if (hidden) {
    return (
      <span
        className={`playing-card playing-card--back ${small ? "playing-card--small" : ""} ${className ?? ""}`}
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
      } ${className ?? ""}`}
      role="img"
      aria-label={cardAriaLabel(card)}
    >
      <b>{card.rank}</b>
      <i>{suitGlyph[card.suit]}</i>
    </span>
  );
}
