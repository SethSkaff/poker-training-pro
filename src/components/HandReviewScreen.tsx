import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Play } from "lucide-react";
import { formatChips, formatFixedDecimal } from "../lib/format";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
import {
  countNotable,
  nextPlaybackStep,
  type ReviewPlaybackMode,
} from "../lib/reviewPlayback";
import { PlayingCard } from "./PlayingCard";
import {
  deriveHandReview,
  filterDecisions,
  HandReviewCancelledError,
  type HandReview,
  type ReviewDecision,
  type ReviewQuality,
} from "../modes/handReview";
import type { TournamentRunnerReplay } from "../modes/tournamentRunner";

/**
 * Post-round review.
 *
 * Everything shown here is derived on demand from the stored replay (see
 * `modes/handReview`), already viewer-redacted, and deliberately labelled as
 * the game's own estimate rather than a solved answer.
 */

interface HandReviewScreenProps {
  replay: TournamentRunnerReplay;
  onBack: () => void;
  /**
   * Called once per derived round with that round's totals. Only aggregates
   * leave this screen — the per-decision annotations stay ephemeral.
   */
  onReviewed?: (totals: {
    decisions: number;
    bestDecisions: number;
    totalRegretBigBlinds: number;
  }) => void;
}

/** Non-colour glyph per quality band, so red/green stays supplemental. */
const QUALITY_GLYPH: Record<ReviewQuality, string> = {
  best: "✔",
  close: "≈",
  inaccuracy: "!",
  mistake: "✕",
  blunder: "✕✕",
};

function qualityLabel(quality: ReviewQuality): string {
  return formatMessage(`review.quality.${quality}`);
}

function actionLabel(action: { type: string; to?: number }): string {
  return action.to === undefined
    ? formatMessage(`review.action.${action.type}`)
    : `${formatMessage(`review.action.${action.type}`)} ${formatChips(action.to)}`;
}

export function HandReviewScreen({
  replay,
  onBack,
  onReviewed,
}: HandReviewScreenProps) {
  const [review, setReview] = useState<HandReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  /*
    Playback replaces the old "Noteworthy only" filter (E27-011). The filter
    removed every ordinary decision from the timeline, so the player lost the
    shape of their round. The timeline is now always complete; this only drives
    what playback does.
  */
  const [playback, setPlayback] = useState<{
    mode: ReviewPlaybackMode;
    running: boolean;
    paused: boolean;
  } | null>(null);
  const [mistakesOnly, setMistakesOnly] = useState(false);
  const [streetFilter, setStreetFilter] = useState<string | undefined>();

  useEffect(() => {
    // Derivation is sliced and abortable: leaving the screen stops the work
    // rather than letting an abandoned round finish computing.
    const controller = new AbortController();
    setReview(null);
    setError(null);
    void deriveHandReview(replay, { signal: controller.signal })
      .then((derived) => {
        if (controller.signal.aborted) return;
        setReview(derived);
        onReviewed?.({
          decisions: derived.decisions.length,
          bestDecisions: derived.decisions.filter(
            (decision) => decision.quality === "best",
          ).length,
          totalRegretBigBlinds: derived.decisions.reduce(
            (sum, decision) => sum + decision.math.evRegretBigBlinds,
            0,
          ),
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof HandReviewCancelledError) return;
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error
            ? cause.message
            : formatMessage("review.error.generic"),
        );
      });
    return () => controller.abort();
    // `onReviewed` is intentionally excluded: a new identity from the parent
    // must not re-derive an already-reviewed round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  const visible = useMemo(
    () =>
      review
        ? filterDecisions(review, {
            notableOnly: false,
            mistakesOnly,
            street: streetFilter as ReviewDecision["street"] | undefined,
          })
        : [],
    [review, mistakesOnly, streetFilter],
  );

  const decision =
    visible.find((entry) => entry.index === selected) ?? visible[0];

  useEffect(() => {
    // Keyboard navigation across the timeline, including jump-to-next-mistake.
    function onKeyDown(event: KeyboardEvent) {
      if (!visible.length) return;
      const position = Math.max(
        0,
        visible.findIndex((entry) => entry.index === decision?.index),
      );
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        setSelected(visible[Math.min(visible.length - 1, position + 1)].index);
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelected(visible[Math.max(0, position - 1)].index);
      } else if (event.key === "m" || event.key === "M") {
        const next = visible
          .slice(position + 1)
          .find((entry) => entry.quality !== "best" && entry.quality !== "close");
        if (next) setSelected(next.index);
      } else if (event.key === " " || event.code === "Space") {
        // Space continues a paused noteworthy run, which is the resume control
        // the design calls for. Only meaningful while playback is paused, so it
        // never swallows the spacebar during ordinary browsing.
        if (playback?.running && playback.paused) {
          event.preventDefault();
          setPlayback({ ...playback, paused: false });
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [visible, decision, playback]);

  /*
    The playback driver. It moves the *selection* through the timeline; it never
    changes what the timeline contains. A noteworthy run pauses on arrival at
    each notable decision and waits for Continue or Space (E27-011).
  */
  useEffect(() => {
    if (!review || !playback?.running || playback.paused) return;
    const decisions = review.decisions.map((entry) => ({
      index: entry.index,
      notable: Boolean(entry.notable),
    }));
    const step = nextPlaybackStep(
      decisions,
      decision?.index ?? null,
      playback.mode,
    );
    if (step.index === null) {
      setPlayback(null);
      return;
    }
    // Routine decisions in a noteworthy run go by quickly; a decision the run
    // stopped at is held until the player continues.
    const dwellMs = playback.mode === "noteworthy" ? 240 : 900;
    const timer = window.setTimeout(() => {
      setSelected(step.index as number);
      if (step.pause) {
        setPlayback((current) =>
          current ? { ...current, paused: true } : current,
        );
      } else if (step.finished) {
        setPlayback(null);
      }
    }, dwellMs);
    return () => window.clearTimeout(timer);
  }, [review, playback, decision]);

  if (error) {
    return (
      <main className="night-shell review-shell" {...localeTextAttributes()}>
        <section className="review-panel">
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {formatMessage("common.back")}
          </button>
          <p role="alert">{error}</p>
        </section>
      </main>
    );
  }

  if (!review) {
    return (
      <main className="night-shell review-shell" {...localeTextAttributes()}>
        <section className="review-panel">
          <p role="status">{formatMessage("review.deriving")}</p>
        </section>
      </main>
    );
  }

  return (
    <main
      className="night-shell review-shell"
      aria-labelledby="review-title"
      {...localeTextAttributes()}
    >
      <section className="review-panel">
        <header className="review-header">
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {formatMessage("common.back")}
          </button>
          <h1 id="review-title">{formatMessage("review.title")}</h1>
          <p className="review-score">
            <strong>
              {formatMessage("review.accuracy", {
                accuracy: formatFixedDecimal(review.accuracy * 100, 0),
              })}
            </strong>
            <span>
              {formatMessage("review.decisionCount", {
                count: review.decisions.length,
              })}
            </span>
          </p>
          {/* The review never claims solved correctness. */}
          <p className="review-approximation">
            {formatMessage("review.approximationNotice")}
          </p>
        </header>

        <div className="review-segments">
          {(["street", "phase", "risk", "decisionType"] as const).map((group) => (
            <div key={group} className="review-segment-group">
              <h2>{formatMessage(`review.segment.${group}`)}</h2>
              <ul>
                {review.segments[group]
                  .filter((entry) => entry.decisions > 0)
                  .map((entry) => (
                    <li key={entry.key}>
                      <button
                        type="button"
                        aria-pressed={
                          group === "street" ? streetFilter === entry.key : undefined
                        }
                        onClick={() =>
                          group === "street"
                            ? setStreetFilter(
                                streetFilter === entry.key ? undefined : entry.key,
                              )
                            : undefined
                        }
                      >
                        <span>{formatMessage(`review.key.${entry.key}`)}</span>
                        <strong>
                          {formatFixedDecimal(entry.accuracy * 100, 0)}%
                        </strong>
                        {/* A tiny sample is stated as such rather than
                            presented as a finding. */}
                        <small>
                          {entry.reliable
                            ? formatMessage("review.sampleCount", {
                                count: entry.decisions,
                              })
                            : formatMessage("review.sampleTooSmall", {
                                count: entry.decisions,
                              })}
                        </small>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="review-body">
          <ol
            className="review-timeline"
            aria-label={formatMessage("review.timelineLabel")}
          >
            {visible.map((entry) => (
              <li key={entry.index}>
                <button
                  type="button"
                  className={entry.index === decision?.index ? "is-selected" : ""}
                  aria-current={entry.index === decision?.index ? "true" : undefined}
                  data-quality={entry.quality}
                  onClick={() => setSelected(entry.index)}
                >
                  <span className="review-timeline__glyph" aria-hidden="true">
                    {QUALITY_GLYPH[entry.quality]}
                  </span>
                  <span className="review-timeline__detail">
                    <strong>
                      {formatMessage("review.handStreet", {
                        handNumber: entry.handNumber,
                        street: formatMessage(`review.key.${entry.street}`),
                      })}
                    </strong>
                    <small>
                      {actionLabel(entry.chosen)} ·{" "}
                      {formatMessage("review.potLabel", {
                        pot: formatChips(entry.math.potBefore),
                      })}
                    </small>
                    {/* Quality and magnitude in words, for assistive tech and
                        for anyone who cannot use the colour. */}
                    <em>
                      {qualityLabel(entry.quality)}
                      {entry.notable
                        ? ` · ${formatMessage(`review.notable.${entry.notableReason}`)}`
                        : ""}
                    </em>
                  </span>
                </button>
              </li>
            ))}
          </ol>

          {decision ? (
            <article className="review-detail" aria-live="polite">
              <header>
                <h2>
                  {formatMessage("review.handStreet", {
                    handNumber: decision.handNumber,
                    street: formatMessage(`review.key.${decision.street}`),
                  })}
                </h2>
                <p>
                  {formatMessage("review.playersRemaining", {
                    count: decision.playersRemaining,
                  })}
                </p>
              </header>

              <div className="review-cards">
                <div>
                  <h3>{formatMessage("review.yourCards")}</h3>
                  <div className="review-card-row">
                    {(decision.informationSet.players.find(
                      (player) => player.id === replay.hero.id,
                    )?.holeCards ?? []).map((card) => (
                      <PlayingCard
                        key={`${card.rank}${card.suit}`}
                        card={card}
                        small
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <h3>{formatMessage("review.board")}</h3>
                  <div className="review-card-row">
                    {decision.informationSet.board.length === 0 ? (
                      <p>{formatMessage("review.noBoardYet")}</p>
                    ) : (
                      decision.informationSet.board.map((card) => (
                        <PlayingCard
                          key={`${card.rank}${card.suit}`}
                          card={card}
                          small
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>

              <p className="review-verdict">
                <strong>{formatMessage("review.youPlayed")}</strong>{" "}
                {actionLabel(decision.chosen)}
                {" · "}
                <strong>{formatMessage("review.modelPreferred")}</strong>{" "}
                {actionLabel(decision.recommended)}
                {" · "}
                <span data-quality={decision.quality}>
                  {qualityLabel(decision.quality)}
                </span>
              </p>

              <dl className="review-math">
                <div>
                  <dt>{formatMessage("review.math.potBefore")}</dt>
                  <dd>{formatChips(decision.math.potBefore)}</dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.costToCall")}</dt>
                  <dd>{formatChips(decision.math.costToCall)}</dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.potAfterCalling")}</dt>
                  <dd>{formatChips(decision.math.potAfterCalling)}</dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.potOdds")}</dt>
                  <dd>{formatFixedDecimal(decision.math.potOdds * 100, 1)}%</dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.requiredEquity")}</dt>
                  <dd>
                    {formatFixedDecimal(decision.math.requiredEquity * 100, 1)}%
                  </dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.estimatedEquity")}</dt>
                  <dd>
                    {formatFixedDecimal(decision.math.estimatedEquity * 100, 1)}%
                  </dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.foldEquity")}</dt>
                  <dd>
                    {formatFixedDecimal(decision.math.foldEquity * 100, 1)}%
                  </dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.spr")}</dt>
                  <dd>{formatFixedDecimal(decision.math.stackToPotRatio, 1)}</dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.tournamentPressure")}</dt>
                  <dd>
                    {formatFixedDecimal(
                      decision.math.tournamentPressure * 100,
                      1,
                    )}
                    %
                  </dd>
                </div>
                <div>
                  <dt>{formatMessage("review.math.evRegret")}</dt>
                  <dd>
                    {formatFixedDecimal(decision.math.evRegretBigBlinds, 2)} BB
                  </dd>
                </div>
              </dl>

              <h3>{formatMessage("review.actionValues")}</h3>
              <ul className="review-action-values">
                {[...decision.math.actionValues]
                  .sort(
                    (left, right) =>
                      right.expectedValueBigBlinds - left.expectedValueBigBlinds,
                  )
                  .map((option) => (
                    <li key={option.id}>
                      <strong>{actionLabel(option)}</strong>
                      <span>
                        {formatFixedDecimal(option.expectedValueBigBlinds, 2)} BB
                      </span>
                      <small>{option.rationale}</small>
                    </li>
                  ))}
              </ul>
              <p className="review-basis">
                {formatMessage("review.basis", {
                  simulations: decision.math.simulations,
                })}
              </p>
            </article>
          ) : (
            <p className="review-detail">{formatMessage("review.noneMatch")}</p>
          )}
        </div>

        <footer className="review-controls">
          {/*
            Playback controls, not filters (E27-011). The timeline behind them
            stays complete in every mode: Play all walks every decision, Play
            noteworthy passes over the routine ones and stops at each notable
            one so it can be read. Both leave every decision selectable by hand.
          */}
          <button
            type="button"
            aria-pressed={playback?.mode === "all" && playback.running}
            onClick={() =>
              setPlayback((current) =>
                current?.mode === "all" && current.running
                  ? null
                  : { mode: "all", running: true, paused: false },
              )
            }
          >
            <Play size={14} aria-hidden="true" />{" "}
            {playback?.mode === "all" && playback.running
              ? formatMessage("review.playback.stop")
              : formatMessage("review.playback.all")}
          </button>
          <button
            type="button"
            aria-pressed={playback?.mode === "noteworthy" && playback.running}
            onClick={() =>
              setPlayback((current) =>
                current?.mode === "noteworthy" && current.running
                  ? null
                  : { mode: "noteworthy", running: true, paused: false },
              )
            }
          >
            <Play size={14} aria-hidden="true" />{" "}
            {playback?.mode === "noteworthy" && playback.running
              ? playback.paused
                ? formatMessage("review.playback.continue")
                : formatMessage("review.playback.stop")
              : formatMessage("review.playback.notable")}
            {review ? (
              <small>
                {" "}
                {formatMessage("review.playback.notableCount", {
                  count: countNotable(
                    review.decisions.map((entry) => ({
                      index: entry.index,
                      notable: Boolean(entry.notable),
                    })),
                  ),
                })}
              </small>
            ) : null}
          </button>
          <button
            type="button"
            aria-pressed={mistakesOnly}
            onClick={() => setMistakesOnly((value) => !value)}
          >
            {formatMessage("review.filter.mistakes")}
          </button>
          <span className="review-hint">
            <ChevronLeft size={13} aria-hidden="true" />
            <ChevronRight size={13} aria-hidden="true" />{" "}
            {formatMessage("review.keyboardHint")}
          </span>
        </footer>
      </section>
    </main>
  );
}
