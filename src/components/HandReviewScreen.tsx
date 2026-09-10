import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { formatChips, formatFixedDecimal } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
import { nextPlaybackStep } from "../lib/reviewPlayback";
import { calculation, type ReviewCalculation } from "../lib/reviewCalculation";
import { defaultSettings, defaultProgress } from "../lib/storage";
import { PokerTable } from "./PokerTable";
import { deriveHandReview, HandReviewCancelledError, type HandReview, type ReviewDecision, type ReviewPreflopAction, type ReviewQuality } from "../modes/handReview";
import type { TournamentRunnerReplay } from "../modes/tournamentRunner";
import type { GameSettings, PlayerProgress } from "../types/poker";

interface HandReviewScreenProps {
  replay: TournamentRunnerReplay;
  onBack: () => void;
  settings?: GameSettings;
  progress?: PlayerProgress;
  onReviewed?: (totals: { decisions: number; bestDecisions: number; totalRegretBigBlinds: number }) => void;
}
const QUALITY_GLYPH: Record<ReviewQuality, string> = { best: "✓", close: "≈", inaccuracy: "!", mistake: "×", blunder: "××" };
function actionLabel(action: { type: string; to?: number }, semantic?: ReviewPreflopAction) {
  const label = formatMessage(`review.action.${semantic ?? action.type}`);
  return action.to === undefined ? label : `${label} ${formatChips(action.to)}`;
}
/** Explicitly names hand-local counts before the separate tournament count. */
export function reviewPlayerCountSummary(
  decision: Pick<
    ReviewDecision,
    | "activePlayersInHand"
    | "activeOpponents"
    | "playersDealtIn"
    | "tournamentPlayersRemaining"
  >,
): string {
  return [
    formatMessage("review.handPlayers", {
      count: decision.activePlayersInHand,
    }),
    formatMessage(
      decision.activeOpponents === 1
        ? "review.handOpponentSingular"
        : "review.handOpponentsPlural",
      { count: decision.activeOpponents },
    ),
    formatMessage("review.handDealtIn", { count: decision.playersDealtIn }),
    formatMessage("review.tournamentPlayersRemaining", {
      count: decision.tournamentPlayersRemaining,
    }),
  ].join(" · ");
}


/** Reuses Training Lab's term button and compact contextual-popover pattern. */
export function ReviewMetric({ label, value, audit }: { label: string; value: string; audit?: ReviewCalculation }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [audit]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [open]);
  return <span className="review-metric">
    <span>{label}</span>
    {audit ? <button type="button" className="math-vocab-term" aria-expanded={open} aria-label={`${label}: ${value}. Inspect calculation`} onClick={() => setOpen(v => !v)}>{value}</button> : <strong>{value}</strong>}
    {open && audit && <span className="math-vocab-popover review-calculation" role="status">
      <span><strong>{audit.formula}</strong><span>= {audit.substituted} = {value}</span></span>
      <button type="button" aria-label="Close calculation" onClick={() => setOpen(false)}>×</button>
    </span>}
  </span>;
}
const noop = () => undefined;
export function HandReviewScreen({ replay, onBack, onReviewed, settings = defaultSettings, progress = defaultProgress }: HandReviewScreenProps) {
  const [review, setReview] = useState<HandReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setReview(null); setError(null); setSelected(0);
    void deriveHandReview(replay, { signal: controller.signal }).then(derived => {
      if (controller.signal.aborted) return;
      setReview(derived);
      onReviewed?.({ decisions: derived.decisions.length, bestDecisions: derived.decisions.filter(d => d.quality === "best").length, totalRegretBigBlinds: derived.decisions.reduce((sum, d) => sum + d.math.evRegretBigBlinds, 0) });
    }).catch(cause => { if (!controller.signal.aborted && !(cause instanceof HandReviewCancelledError)) setError(cause instanceof Error ? cause.message : "Review unavailable"); });
    return () => controller.abort();
  }, [replay]);
  const decision = review?.decisions[selected];
  const nextKey = useMemo(() => review ? nextPlaybackStep(review.decisions, decision?.index ?? null, "noteworthy") : null, [review, decision]);
  const hasNextKey = Boolean(review?.decisions.slice(selected + 1).some(d => d.notable));
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!review || event.defaultPrevented || (event.target as HTMLElement).closest("input, select, button")) return;
      if (event.key === "ArrowRight") { event.preventDefault(); setSelected(s => Math.min(review.decisions.length - 1, s + 1)); }
      if (event.key === "ArrowLeft") { event.preventDefault(); setSelected(s => Math.max(0, s - 1)); }
      if (event.key.toLowerCase() === "m" && hasNextKey && nextKey?.index != null) { event.preventDefault(); setSelected(nextKey.index); }
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [review, hasNextKey, nextKey]);
  if (!review || !decision) return <main className="night-shell review-shell"><section className="review-panel"><button className="night-back" onClick={onBack}><ArrowLeft /> Back</button><p role={error ? "alert" : "status"}>{error ?? (review ? "No recorded decisions yet." : formatMessage("review.deriving"))}</p></section></main>;
  const best = review.decisions.filter(d => d.quality === "best").length;
  const accuracy = calculation("Accuracy = best decisions / reviewed decisions × 100", { best, total: review.decisions.length }, "best / total × 100", review.accuracy * 100);
  const metric = (id: string, label: string, percent = false) => {
    const audit = decision.math.calculations?.[id];
    const value = decision.math[id as keyof typeof decision.math];
    if (typeof value !== "number") return null;
    return <ReviewMetric key={id} label={label} audit={audit} value={`${formatFixedDecimal(value * (percent ? 100 : 1), percent ? 1 : 2)}${percent ? "%" : ""}`} />;
  };
  return <PokerTable mode={replay.mode} scenario={decision.tableSnapshot} settings={{...settings, spatialScene: false}} progress={progress}
    onProgressChange={noop} onSettingsChange={noop} onNextScenario={noop} onExit={onBack}
    review={{
      controls: <nav className="action-dock review-navigation" aria-label="Review navigation">
        <button className="action-button" disabled={selected === 0} onClick={() => setSelected(s => s - 1)}><ChevronLeft /><strong>BACK</strong></button>
        <button className="action-button" disabled={selected >= review.decisions.length - 1} onClick={() => setSelected(s => s + 1)}><strong>NEXT</strong><ChevronRight /></button>
        <button className="action-button" disabled={!hasNextKey} onClick={() => { if (nextKey?.index != null) setSelected(nextKey.index); }}><strong>NEXT KEY MOVE</strong><ChevronRight /></button>
      </nav>,
      overlay: <div className="review-projections" key={decision.index}>
        <header className="review-table-heading"><h1>GAME REVIEW</h1><ReviewMetric label="Model best" value={`${formatFixedDecimal(review.accuracy * 100, 0)}%`} audit={accuracy} />
          <label>Decision <select value={selected} onChange={e => setSelected(Number(e.target.value))}>{review.decisions.map((d, i) => <option value={i} key={d.index}>{i + 1} · Hand {d.handNumber} · {d.street}{d.notable ? " · Key move" : ""}</option>)}</select></label>
          <small>{reviewPlayerCountSummary(decision)}</small>
          {review.truncated && <small>Review limited to {review.decisions.length} decisions</small>}
        </header>
        <aside className="review-felt-math" aria-label="Decision mathematics"><h2>THE MATH</h2>
          {metric("potOdds", "Pot odds", true)}{metric("requiredEquity", decision.math.requiredEquityApplicable ? "Required equity" : "Equity reference", true)}
          {metric("showdownEquity", "Estimated equity", true)}{metric("stackToPotRatio", "Stack / pot")}{metric("effectiveStackBigBlinds", "Effective BB")}{metric("evRegretBigBlinds", "EV loss · BB")}
        </aside>
        <section className="review-felt-verdict" aria-live="polite" data-quality={decision.quality}>
          <small>HAND {decision.handNumber} · {decision.street.toUpperCase()}</small>
          <h2>{QUALITY_GLYPH[decision.quality]} {formatMessage(`review.quality.${decision.quality}`)}</h2>
          <p>You played <strong>{actionLabel(decision.chosen, decision.chosenPreflopAction)}</strong></p>
          <p>Model preferred <strong>{actionLabel(decision.recommended, decision.recommendedPreflopAction)}</strong></p>
        </section>
        <aside className="review-felt-details"><h2>ALTERNATIVES · EV IN BB</h2>
          {decision.math.actionValues.map(option => <ReviewMetric key={option.id} label={actionLabel(option, option.semantic)} value={formatFixedDecimal(option.expectedValueBigBlinds, 2)} audit={option.calculation} />)}
          <small title={formatMessage("review.approximationNotice")}>Model estimates, not solved play. · {decision.math.confidence} confidence</small>
        </aside>
      </div>
    }} />;
}
