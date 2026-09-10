import type { Card, SeatPlayer } from "../types/poker";
import type { TournamentPresentationEvent } from "../modes/tournamentRunner";
import type { TwoDAvatarModel } from "../lib/twoDAvatarModels";
import { PlayingCard } from "./PlayingCard";
import { TwoDAvatar } from "./TwoDAvatar";
import { formatChips } from "../lib/format";

type ResultEvent = Extract<
  TournamentPresentationEvent,
  { kind: "showdown" | "hand-result" }
>;
export function winnerRecipients(event: ResultEvent) {
  return [
    ...new Set(event.awards.filter((a) => a.amount > 0).map((a) => a.playerId)),
  ].map((playerId) => {
    const awards = event.awards.filter((a) => a.playerId === playerId);
    return {
      playerId,
      amount: awards.reduce((sum, a) => sum + a.amount, 0),
      hand: awards.find((a) => a.hand)?.hand,
    };
  });
}
export function winnerRevealFrame(progress: number, count: number) {
  const position =
    Math.min(Math.max(0, progress), 0.999999) * Math.max(1, count);
  const localMs = (position % 1) * 3800;
  return {
    index: Math.floor(position),
    x:
      localMs < 400
        ? -100 * (1 - localMs / 400) ** 3
        : localMs > 3400
          ? -100 * ((localMs - 3400) / 400) ** 2
          : 0,
    opacity: localMs > 3400 ? (3800 - localMs) / 400 : 1,
  };
}
export function WinnerReveal({
  event,
  board,
  players,
  identities,
  progress,
  reducedMotion,
}: {
  event: ResultEvent;
  board: readonly Card[];
  players: readonly SeatPlayer[];
  identities: ReadonlyMap<
    string,
    { model: TwoDAvatarModel; displayName: string }
  >;
  progress: number;
  reducedMotion: boolean;
}) {
  const recipients = winnerRecipients(event);
  const frame = winnerRevealFrame(progress, recipients.length);
  const winner = recipients[frame.index];
  if (!winner) return null;
  const player = players.find((p) => p.id === winner.playerId);
  const identity = identities.get(winner.playerId);
  const publicCards =
    event.kind === "showdown"
      ? event.reveals.find((r) => r.playerId === winner.playerId)?.cards
      : player?.cards;
  const used = new Set(winner.hand?.cards.map((c) => `${c.rank}:${c.suit}`));
  const card = (c: Card) => (
    <PlayingCard
      key={`${c.rank}:${c.suit}`}
      card={c}
      className={
        used.has(`${c.rank}:${c.suit}`)
          ? "winner-card is-winning"
          : "winner-card"
      }
    />
  );
  return (
    <section
      className="winner-reveal"
      aria-label="Hand winner"
      style={{
        transform: reducedMotion ? undefined : `translateX(${frame.x}%)`,
        opacity: reducedMotion ? 1 : frame.opacity,
      }}
    >
      <div className="winner-reveal__name">
        <span>
          {recipients.length > 1
            ? `WINNER ${frame.index + 1} / ${recipients.length}`
            : "WINNER"}
        </span>
        <h2>
          {winner.playerId === "hero"
            ? (player?.name ?? "You")
            : (identity?.displayName ?? player?.name)}
        </h2>
        <strong>+{formatChips(winner.amount)}</strong>
        <small>
          Chips awarded{recipients.length > 1 ? " · shared / side pots" : ""}
        </small>
      </div>
      <div className="winner-reveal__cards">
        <div className="winner-reveal__board">
          {board.map(card)}
          {Array.from({ length: 5 - board.length }, (_, i) => (
            <span className="winner-card-slot" key={i} />
          ))}
        </div>
        <div className="winner-reveal__hand">
          <div>
            {publicCards?.map(card) ?? (
              <>
                <PlayingCard hidden card={{ rank: "A", suit: "spades" }} />
                <PlayingCard hidden card={{ rank: "A", suit: "spades" }} />
              </>
            )}
          </div>
          <strong>{winner.hand?.displayName ?? "Won uncontested"}</strong>
        </div>
      </div>
      <div className="winner-reveal__avatar">
        {identity && <TwoDAvatar model={identity.model} />}
      </div>
    </section>
  );
}
