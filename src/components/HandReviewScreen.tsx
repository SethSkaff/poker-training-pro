import { reviewMoveAccuracy } from "../lib/reviewAccuracy";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { formatChips, formatFixedDecimal } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
import { nextPlaybackStep } from "../lib/reviewPlayback";
import { calculation, type ReviewCalculation } from "../lib/reviewCalculation";
import { defaultSettings, defaultProgress } from "../lib/storage";
import { PokerTable } from "./PokerTable";
import {
  deriveHandReview,
  GOOD_MOVE_MAX_EV_LOSS_BB,
  HandReviewCancelledError,
  type HandReview,
  type ReviewDecision,
  type ReviewPreflopAction,
  type ReviewQuality,
} from "../modes/handReview";
import type { TournamentRunnerReplay } from "../modes/tournamentRunner";
import type { GameSettings, PlayerProgress } from "../types/poker";

interface HandReviewScreenProps {
  replay: TournamentRunnerReplay;
  onBack: () => void;
  settings?: GameSettings;
  progress?: PlayerProgress;
  onReviewed?: (totals: {
    decisions: number;
    bestDecisions: number;
    totalRegretBigBlinds: number;
  }) => void;
}
const QUALITY_GLYPH: Record<ReviewQuality, string> = {
  best: "✓",
  close: "≈",
  inaccuracy: "!",
  mistake: "×",
  blunder: "××",
};
function actionLabel(
  action: { type: string; to?: number },
  semantic?: ReviewPreflopAction,
) {
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

/**
 * Which decision a review key press selects, or null when the key is not a
 * review shortcut.
 *
 * The Vitest environment has no DOM, so the navigation contract lives here as
 * pure arithmetic and the effect below is only the wiring. Down/Right both
 * advance and Up/Left both step back: the pre-redesign review was a vertical
 * timeline whose users learned the vertical pair, and the redesign lays the
 * same decisions out horizontally, so binding both axes means neither habit
 * silently stops working. `M` jumps to the next key move, matching the button.
 */
export function reviewKeyboardTarget(
  key: string,
  state: { selected: number; count: number; nextKeyMoveIndex: number | null },
): number | null {
  if (state.count <= 0) return null;
  const last = state.count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return Math.min(last, state.selected + 1);
    case "ArrowLeft":
    case "ArrowUp":
      return Math.max(0, state.selected - 1);
    default:
      break;
  }
  if (key.toLowerCase() === "m") {
    return state.nextKeyMoveIndex;
  }
  return null;
}

/**
 * A decision's entry in the selector carries its quality as a glyph *and* as
 * words. `data-quality` colours the verdict panel, and colour alone must never
 * be the only way to read how a decision went.
 */
export function decisionOptionLabel(
  decision: Pick<ReviewDecision, "handNumber" | "street" | "quality" | "notable">,
  position: number,
): string {
  const quality = `${QUALITY_GLYPH[decision.quality]} ${formatMessage(
    `review.quality.${decision.quality}`,
  )}`;
  const label = formatMessage("review.decisionOption", {
    position: position + 1,
    hand: formatMessage("review.handStreet", {
      handNumber: decision.handNumber,
      street: decision.street,
    }),
    quality,
  });
  return decision.notable
    ? `${label} · ${formatMessage("review.notableTag")}`
    : label;
}

interface ExpandedCalculation {label:string; value:string; audit:ReviewCalculation}
const CalculationContext=createContext<{open:ExpandedCalculation|null; select:(value:ExpandedCalculation|null)=>void}>({open:null,select:()=>{}});
export function ReviewMetric({label,audit,percent=false,digits=2}:{label:string;audit?:ReviewCalculation;percent?:boolean;digits?:number}) {
  const {open,select}=useContext(CalculationContext);
  const value=audit?`${formatFixedDecimal(audit.result*(percent?100:1),digits)}${percent?"%":""}`:formatMessage("review.unavailable");
  const expanded=Boolean(audit && open?.label===label);
  return <span className="review-metric"><span>{label}</span>{audit?
    <button type="button" className="math-vocab-term" aria-expanded={expanded} aria-label={`${label}: ${value}. ${formatMessage("review.inspectCalculation")}`} onClick={()=>select(expanded?null:{label,value,audit})}>{value}</button>
    :<strong>{value}</strong>}</span>;
}
const noop = () => undefined;
export function HandReviewScreen({
  replay,
  onBack,
  onReviewed,
  settings = defaultSettings,
  progress = defaultProgress,
}: HandReviewScreenProps) {
  const [expandedCalculation,setExpandedCalculation]=useState<ExpandedCalculation|null>(null);
  const [review, setReview] = useState<HandReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [mobileAnalysis, setMobileAnalysis] = useState<
    "math" | "details" | null
  >(null);
  useEffect(() => {
    const controller = new AbortController();
    setReview(null);
    setError(null);
    setSelected(0);
    void deriveHandReview(replay, { signal: controller.signal })
      .then((derived) => {
        if (controller.signal.aborted) return;
        setReview(derived);
        onReviewed?.({
          decisions: derived.decisions.length,
          bestDecisions: derived.decisions.filter((d) => d.quality === "best")
            .length,
          totalRegretBigBlinds: derived.decisions.reduce(
            (sum, d) => sum + d.math.evRegretBigBlinds,
            0,
          ),
        });
      })
      .catch((cause) => {
        if (
          !controller.signal.aborted &&
          !(cause instanceof HandReviewCancelledError)
        )
          setError(
            cause instanceof Error
              ? cause.message
              : formatMessage("review.error.generic"),
          );
      });
    return () => controller.abort();
  }, [replay]);
  useEffect(()=>setExpandedCalculation(null),[selected,replay]);
  useEffect(() => {
    if (!expandedCalculation) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setExpandedCalculation(null);
      }
    };
    window.addEventListener("keydown", close, true);
    return () => window.removeEventListener("keydown", close, true);
  }, [expandedCalculation]);
  const decision = review?.decisions[selected];
  const nextKey = useMemo(
    () =>
      review
        ? nextPlaybackStep(
            review.decisions,
            decision?.index ?? null,
            "noteworthy",
          )
        : null,
    [review, decision],
  );
  const hasNextKey = Boolean(
    review?.decisions.slice(selected + 1).some((d) => d.notable),
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        !review ||
        event.defaultPrevented ||
        (event.target as HTMLElement).closest("input, select")
      )
        return;
      const target = reviewKeyboardTarget(event.key, {
        selected,
        count: review.decisions.length,
        nextKeyMoveIndex: hasNextKey ? (nextKey?.index ?? null) : null,
      });
      if (target === null) return;
      event.preventDefault();
      setSelected(target);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [review, hasNextKey, nextKey, selected]);
  if (!review || !decision)
    return (
      <main className="night-shell review-shell">
        <section className="review-panel">
          <button className="night-back" onClick={onBack}>
            <ArrowLeft /> {formatMessage("common.back")}
          </button>
          <p role={error ? "alert" : "status"}>
            {error ??
              (review
                ? formatMessage("review.noDecisions")
                : formatMessage("review.deriving"))}
          </p>
        </section>
      </main>
    );
  const best = review.decisions.filter((d) => d.quality === "best").length;
  const accuracy = calculation(
    "Model Best = best decisions / reviewed decisions",
    { best, total: review.decisions.length },
    "best / total",
    review.accuracy,
  );
  const metric = (id: string, label: string, percent = false) => {
    const audit = decision.math.calculations?.[id];
    const value = decision.math[id as keyof typeof decision.math];
    if (typeof value !== "number") return null;
    return (
      <ReviewMetric
        key={id}
        label={label}
        audit={audit}
        percent={percent}
        digits={percent ? 1 : 2}
      />
    );
  };
  return (
    <CalculationContext.Provider value={{open:expandedCalculation,select:setExpandedCalculation}}>
    <PokerTable
      mode={replay.mode}
      scenario={decision.tableSnapshot}
      settings={{ ...settings, spatialScene: false }}
      progress={progress}
      onProgressChange={noop}
      onSettingsChange={noop}
      onNextScenario={noop}
      onExit={onBack}
      review={{
        actions: Object.fromEntries(
          decision.informationSet.actions
            .filter(
              (a) => !["small-blind", "big-blind", "ante"].includes(a.type),
            )
            .map((a) => [
              a.playerId,
              `${a.type}${["check", "fold"].includes(a.type) || !a.amount ? "" : ` ${formatChips(a.amount)}`}`,
            ]),
        ),
        controls: (
          <nav
            className="action-dock review-navigation"
            aria-label={formatMessage("review.navigationLabel")}
          >
            <button
              className="action-button"
              disabled={selected === 0}
              onClick={() => setSelected((s) => s - 1)}
            >
              <ChevronLeft />
              <strong>{formatMessage("common.back")}</strong>
            </button>
            <button
              className="action-button"
              disabled={selected >= review.decisions.length - 1}
              onClick={() => setSelected((s) => s + 1)}
            >
              <strong>{formatMessage("review.nav.next")}</strong>
              <ChevronRight />
            </button>
            <button
              className="action-button"
              onClick={() => {
                if (hasNextKey && nextKey?.index != null) setSelected(nextKey.index);
                else onBack();
              }}
            >
              <strong>{formatMessage(hasNextKey ? "review.nav.nextKeyMove" : "review.nav.moveOn")}</strong>
              <ChevronRight />
            </button>
          </nav>
        ),
        overlay: (
          <div
            className="review-projections"
            key={decision.index}
            data-mobile-analysis={mobileAnalysis ?? "none"}
          >
            <nav
              className="review-mobile-tabs"
              aria-label={formatMessage("review.analysisLabel")}
            >
              <button
                aria-expanded={mobileAnalysis === "math"}
                onClick={() =>
                  setMobileAnalysis((v) => (v === "math" ? null : "math"))
                }
              >
                {formatMessage("review.tab.math")}
              </button>
              <button
                aria-expanded={mobileAnalysis === "details"}
                onClick={() =>
                  setMobileAnalysis((v) => (v === "details" ? null : "details"))
                }
              >
                {formatMessage("review.tab.alternatives")}
              </button>
            </nav>
            <header className="review-table-heading">
              <h1>{formatMessage("review.title")}</h1>

              <label>
                {formatMessage("review.decisionSelectLabel")}{" "}
                <select
                  value={selected}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  {review.decisions.map((d, i) => (
                    <option value={i} key={d.index}>
                      {decisionOptionLabel(d, i)}
                    </option>
                  ))}
                </select>
              </label>
              <small>{reviewPlayerCountSummary(decision)}</small>
              <small className="review-keyboard-hint">
                {formatMessage("review.keyboardHint")}
              </small>
              {review.truncated && (
                <small>
                  {formatMessage("review.truncated", {
                    count: review.decisions.length,
                  })}
                </small>
              )}
            </header>
            <section className="review-summary-strip" aria-label={formatMessage("review.summaryLabel")}>
              <div><ReviewMetric label={formatMessage("review.modelBestShare")} percent digits={0} audit={accuracy}/></div>
              <div><ReviewMetric label={formatMessage("review.goodMovesShare")} percent digits={0} audit={calculation("Good Moves = good decisions / reviewed decisions",{good:review.decisions.filter(d=>d.math.evRegretBigBlinds<=GOOD_MOVE_MAX_EV_LOSS_BB).length,total:review.decisions.length},"good / total",review.goodAccuracy)}/></div>
              {review.segments.street.filter(segment=>segment.decisions>0).map(segment=><div key={segment.key}>
                <ReviewMetric label={`${formatMessage(`review.key.${segment.key}`)} ${formatMessage("review.accuracyLabel")}`} percent digits={0} audit={calculation("Street accuracy = model-best moves / street decisions",{best:Math.round(segment.accuracy*segment.decisions),total:segment.decisions},"best / total",segment.accuracy)}/>
                <small>{segment.decisions} {formatMessage(segment.decisions === 1 ? "review.moveLabel" : "review.movesLabel")}</small>
              </div>)}
            </section>
            <aside
              className="review-felt-math"
              aria-label={formatMessage("review.mathLabel")}
            >
              <h2>{formatMessage("review.mathHeading")}</h2>
              {metric("potOdds", formatMessage("review.math.potOdds"), true)}
              {metric(
                "requiredEquity",
                formatMessage(
                  decision.math.requiredEquityApplicable
                    ? "review.math.requiredEquity"
                    : "review.math.requiredEquityReference",
                ),
                true,
              )}
              {metric(
                "showdownEquity",
                formatMessage("review.math.estimatedEquity"),
                true,
              )}
              {metric("stackToPotRatio", formatMessage("review.math.spr"))}
              {metric(
                "effectiveStackBigBlinds",
                formatMessage("review.math.effectiveStack"),
              )}
              {metric(
                "evRegretBigBlinds",
                formatMessage("review.math.evRegret"),
              )}
            </aside>
            <section
              className="review-felt-verdict"
              aria-live="polite"
              data-quality={decision.quality}
            >
              <small>
                {formatMessage("review.handStreet", {
                  handNumber: decision.handNumber,
                  street: decision.street,
                })}
              </small>
              <h2>
                {QUALITY_GLYPH[decision.quality]}{" "}
                {formatMessage(`review.quality.${decision.quality}`)}
              </h2>
              <p>
                {formatMessage("review.youPlayed")}{" "}
                <strong>
                  {actionLabel(decision.chosen, decision.chosenPreflopAction)}
                </strong>
              </p>
              <div className="review-move-scores"><span><small>{formatMessage("review.modelBestShare")}</small><strong>{actionLabel(decision.recommended,decision.recommendedPreflopAction)}</strong></span><ReviewMetric label={formatMessage("review.accuracyLabel")} audit={reviewMoveAccuracy(decision.math.evRegretBigBlinds)} percent digits={1}/></div>
              <p className="visually-hidden">
                {formatMessage("review.modelPreferred")}{" "}
                <strong>
                  {actionLabel(
                    decision.recommended,
                    decision.recommendedPreflopAction,
                  )}
                </strong>
              </p>
            </section>
            <aside className="review-felt-details">
              <h2>{formatMessage("review.actionValues")}</h2>
              {decision.math.actionValues.map((option) => (
                <ReviewMetric
                  key={option.id}
                  label={actionLabel(option, option.semantic)}
                  audit={option.calculation}
                />
              ))}

              <small>
                {formatMessage(`review.confidence.${decision.math.confidence}`)}
                {" · "}
                {formatMessage("review.basis", {
                  simulations: decision.math.simulations,
                })}
              </small>
            </aside>
            <small className="review-model-note">{formatMessage("review.approximationNotice")}</small>
            {expandedCalculation && <aside className="review-formula" role="status" aria-label={expandedCalculation.label}>
              <button aria-label={formatMessage("review.closeCalculation")} onClick={()=>setExpandedCalculation(null)}>×</button>
              <strong>{expandedCalculation.audit.formula}</strong>
              <span>{expandedCalculation.audit.substituted} = {expandedCalculation.value}</span>
            </aside>}
          </div>
        ),
      }}
    />
    </CalculationContext.Provider>
  );
}
