import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  LockKeyhole,
  Trophy,
} from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
import { formatClock, formatChips } from "../lib/format";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
import { useResilientAsset } from "../lib/useResilientAsset";
import {
  listTournamentSessionEvents,
  type TournamentPolicyMode,
  type TournamentSessionCareerResult,
  type TournamentSessionResult,
} from "../modes/tournamentSession";
import type { GameMode, PlayerProgress } from "../types/poker";

const START_MENU_LOOP: string | undefined = undefined;
const START_MENU_STILL = "/start-menu-reference.png";
const START_MENU_SETTINGS_STILL = "/start-menu-settings.png";

interface SceneProps {
  quiet?: boolean;
}

export function NightCircuitScene({ quiet = false }: SceneProps) {
  return (
    <div
      className={`night-scene ${quiet ? "night-scene--quiet" : ""}`}
      aria-hidden="true"
    >
      <div className="night-scene__architecture">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="night-scene__marquee">
        <img src="/poker-training-pro-mark.png" alt="" />
        <small>{formatMessage("brand.name")}</small>
        <strong>{formatMessage("brand.tagline")}</strong>
      </div>
      <div className="night-scene__crowd">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="night-scene__dealer">
        <span />
        <i />
      </div>
      <div className="night-scene__table">
        <div className="night-scene__felt">
          <div className="night-scene__board">
            <i>8♣</i>
            <i>Q♥</i>
            <i>4♠</i>
          </div>
          <div className="night-scene__pot">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
      <div className="night-scene__hero-cards">
        <i />
        <i />
      </div>
      <div className="night-scene__rail" />
    </div>
  );
}

interface HomeViewProps {
  onPlay: () => void;
  onSettings: () => void;
  onCredits?: () => void;
}

export function HomeView({
  onPlay,
  onSettings,
  onCredits,
}: HomeViewProps) {
  const [selectedAction, setSelectedAction] = useState<"play" | "settings">(
    "play",
  );
  const canonicalStill = useResilientAsset(
    START_MENU_STILL,
    formatMessage("dashboard.asset.startMenuLabel"),
  );
  const selectedStill = useResilientAsset(
    selectedAction === "settings"
      ? START_MENU_SETTINGS_STILL
      : START_MENU_STILL,
    selectedAction === "settings"
      ? formatMessage("dashboard.asset.settingsSelectedLabel")
      : formatMessage("dashboard.asset.startMenuLabel"),
  );
  const loop = useResilientAsset(
    START_MENU_LOOP ?? "start-menu-loop-disabled",
    formatMessage("dashboard.asset.animatedBackgroundLabel"),
  );
  const activeMediaStatus =
    START_MENU_LOOP && selectedAction === "play"
      ? loop.status
      : selectedStill.status;
  const activeNotice =
    canonicalStill.notice ??
    (selectedAction === "settings" ? selectedStill.notice : null) ??
    (START_MENU_LOOP && selectedAction === "play" ? loop.notice : null);

  return (
    <main
      className="night-shell home-reference"
      aria-labelledby="main-menu-title"
      {...localeTextAttributes()}
    >
      <h1 id="main-menu-title" className="visually-hidden">
        {formatMessage("dashboard.home.title")}
      </h1>
      <div
        className="home-reference__media"
        data-canonical-status={canonicalStill.status}
        data-selected-status={activeMediaStatus}
        aria-hidden="true"
      >
        <div className="home-reference__fallback">
          <span className="home-reference__fallback-mark">♠</span>
          <strong>{formatMessage("brand.name")}</strong>
          <small>{formatMessage("brand.tagline")}</small>
          <span className="home-reference__fallback-action home-reference__fallback-action--play">
            {formatMessage("common.play")}
          </span>
          <span className="home-reference__fallback-action home-reference__fallback-action--settings">
            {formatMessage("common.settings")}
          </span>
        </div>
        <img
          className="home-reference__canonical"
          src={START_MENU_STILL}
          alt=""
          decoding="async"
          fetchPriority="high"
          onLoad={canonicalStill.onLoad}
          onError={canonicalStill.onError}
        />
        {START_MENU_LOOP && selectedAction === "play" ? (
          <video
            className="home-reference__selected"
            src={START_MENU_LOOP}
            poster={START_MENU_STILL}
            autoPlay
            loop
            muted
            playsInline
            onCanPlay={loop.onLoad}
            onError={loop.onError}
          />
        ) : selectedAction === "settings" ? (
          <img
            className="home-reference__selected"
            src={START_MENU_SETTINGS_STILL}
            alt=""
            decoding="async"
            onLoad={selectedStill.onLoad}
            onError={selectedStill.onError}
          />
        ) : null}
      </div>

      {activeNotice && (
        <p className="asset-fallback-notice" role="status">
          {activeNotice}
        </p>
      )}

      <nav
        className="home-reference__controls"
        aria-label={formatMessage("dashboard.home.navLabel")}
      >
        <button
          className="home-reference__hit home-reference__hit--play"
          type="button"
          onClick={onPlay}
          aria-label={formatMessage("common.play")}
          onMouseEnter={() => setSelectedAction("play")}
          onFocus={() => setSelectedAction("play")}
        >
          <span className="visually-hidden">{formatMessage("common.play")}</span>
        </button>
        <button
          className="home-reference__hit home-reference__hit--settings"
          type="button"
          onClick={onSettings}
          aria-label={formatMessage("common.settings")}
          onMouseEnter={() => setSelectedAction("settings")}
          onFocus={() => setSelectedAction("settings")}
        >
          <span className="visually-hidden">{formatMessage("common.settings")}</span>
        </button>
      </nav>

      <p className="home-reference__play-chip-boundary">
        {formatMessage("dashboard.home.chipsOnly")}{" "}
        <span aria-hidden="true">·</span>{" "}
        {formatMessage("dashboard.home.noRealMoney")}
      </p>

      {onCredits ? (
        <button
          className="home-reference__credits-link"
          type="button"
          onClick={onCredits}
        >
          {formatMessage("dashboard.home.creditsLink")}
        </button>
      ) : null}
    </main>
  );
}

interface ModeSelectProps {
  onBack: () => void;
  onSelect: (mode: GameMode | "timed" | "tutorial" | "reference") => void;
}

export function ModeSelect({ onBack, onSelect }: ModeSelectProps) {
  return (
    <main
      className="night-shell night-shell--mode-select"
      aria-labelledby="mode-select-title"
      {...localeTextAttributes()}
    >
      <NightCircuitScene />
      <section className="mode-stage">
        <header>
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {formatMessage("dashboard.nav.backToMenu")}
          </button>
          <div>
            <p className="night-section-label">{formatMessage("common.play")}</p>
            <h1 id="mode-select-title">{formatMessage("dashboard.modeSelect.title")}</h1>
          </div>
        </header>

        <div className="mode-stage__choices">
          <button
            className="mode-stage__choice mode-stage__choice--normal"
            type="button"
            onClick={() => onSelect("normal")}
          >
            <span className="mode-stage__number">01</span>
            <span className="mode-stage__symbol" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="mode-stage__copy">
              <small>{formatMessage("modes.normal.tag")}</small>
              <strong>{formatMessage("modes.normal.name")}</strong>
              <span>{formatMessage("modes.normal.description")}</span>
            </span>
            <ArrowRight size={21} />
          </button>

          <button
            className="mode-stage__choice mode-stage__choice--rational"
            type="button"
            onClick={() => onSelect("rational")}
          >
            <span className="mode-stage__number">02</span>
            <span className="mode-stage__symbol" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="mode-stage__copy">
              <small>{formatMessage("modes.rational.tag")}</small>
              <strong>{formatMessage("modes.rational.name")}</strong>
              <span>{formatMessage("modes.rational.description")}</span>
            </span>
            <ArrowRight size={21} />
          </button>

          <button
            className="mode-stage__choice mode-stage__choice--training"
            type="button"
            onClick={() => onSelect("training")}
          >
            <span className="mode-stage__number">03</span>
            <span className="mode-stage__symbol" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="mode-stage__copy">
              <small>{formatMessage("modes.training.tag")}</small>
              <strong>{formatMessage("modes.training.name")}</strong>
              <span>{formatMessage("modes.training.description")}</span>
            </span>
            <ArrowRight size={21} />
          </button>

          <button
            className="mode-stage__choice mode-stage__choice--timed"
            type="button"
            onClick={() => onSelect("timed")}
          >
            <span className="mode-stage__number">04</span>
            <span className="mode-stage__symbol" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="mode-stage__copy">
              <small>{formatMessage("modes.timed.tag")}</small>
              <strong>{formatMessage("modes.timed.name")}</strong>
              <span>{formatMessage("modes.timed.description")}</span>
            </span>
            <ArrowRight size={21} />
          </button>
        </div>
        <div className="mode-stage__secondary">
          <button
            className="mode-stage__tutorial-link"
            type="button"
            onClick={() => onSelect("tutorial")}
          >
            {formatMessage("dashboard.modeSelect.tutorialPrompt")}{" "}
            <strong>{formatMessage("dashboard.modeSelect.tutorialCta")}</strong>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          {/* The reference used to be reachable only from the in-hand pause
              menu -- unavailable at exactly the moment a player is most likely
              to want it, which is before sitting down. */}
          <button
            className="mode-stage__tutorial-link"
            type="button"
            onClick={() => onSelect("reference")}
          >
            {formatMessage("dashboard.modeSelect.referencePrompt")}{" "}
            <strong>{formatMessage("dashboard.modeSelect.referenceCta")}</strong>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}

interface TimedSetupProps {
  initialMinutes: number;
  onBack: () => void;
  onStart: (minutes: number) => void;
}

const TIMED_PRESETS = [15, 30, 45, 60] as const;

export function TimedSetup({
  initialMinutes,
  onBack,
  onStart,
}: TimedSetupProps) {
  const [minutesText, setMinutesText] = useState(String(initialMinutes));
  const minutes = Number(minutesText);
  const validMinutes =
    Number.isInteger(minutes) && minutes >= 5 && minutes <= 180;

  return (
    <main className="night-shell night-shell--timed" {...localeTextAttributes()}>
      <NightCircuitScene quiet />
      <section className="timed-setup">
        <button className="night-back" type="button" onClick={onBack}>
          <ArrowLeft size={18} /> {formatMessage("dashboard.nav.backToModes")}
        </button>
        <p className="night-section-label">{formatMessage("modes.timed.name")}</p>
        <h1>{formatMessage("dashboard.timed.title")}</h1>

        <div
          className="timed-presets"
          aria-label={formatMessage("dashboard.timed.presetsAriaLabel")}
        >
          {TIMED_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={minutes === preset ? "is-selected" : ""}
              onClick={() => setMinutesText(String(preset))}
              aria-pressed={minutes === preset}
            >
              <strong>{preset}</strong>
              <span>{formatMessage("dashboard.timed.minUnit")}</span>
            </button>
          ))}
        </div>

        <label className="timed-custom">
          <span>{formatMessage("dashboard.timed.customLabel")}</span>
          <input
            type="number"
            min="5"
            max="180"
            step="1"
            value={minutesText}
            aria-describedby="timed-minutes-help"
            onChange={(event) => setMinutesText(event.target.value)}
          />
        </label>
        <p id="timed-minutes-help" className="timed-setup__range">
          {formatMessage("dashboard.timed.rangeHelp")}
        </p>

        <p className="timed-setup__note">
          {formatMessage("dashboard.timed.note")}
        </p>

        <button
          className="timed-setup__start"
          type="button"
          disabled={!validMinutes}
          onClick={() => onStart(minutes)}
        >
          {formatMessage("dashboard.timed.start")} <ArrowRight size={19} />
        </button>
      </section>
    </main>
  );
}

function resultForEvent(
  results: readonly TournamentSessionCareerResult[],
  eventId: string,
) {
  return results.find((result) => result.eventId === eventId);
}

interface TourLobbyProps {
  mode: TournamentPolicyMode;
  careerResults: readonly TournamentSessionCareerResult[];
  /**
   * The event the player left in progress, if any. Resuming it takes priority
   * over recommending the next unqualified event, so a career picks up where
   * it was rather than restarting at the first unlocked event.
   */
  activeEventId?: string;
  onBack: () => void;
  onStartEvent?: (eventId: string) => void;
}

export function TourLobby({
  mode,
  careerResults,
  activeEventId,
  onBack,
  onStartEvent,
}: TourLobbyProps) {
  const events = useMemo(
    () => listTournamentSessionEvents(careerResults),
    [careerResults],
  );
  // Priority: resume the active event -> continue the next required event ->
  // fall back to anything unlocked.
  const activeEvent = activeEventId
    ? events.find((event) => event.id === activeEventId && event.unlocked)
    : undefined;
  const initialEvent =
    activeEvent ??
    events.find(
      (event) =>
        event.unlocked && !resultForEvent(careerResults, event.id)?.qualified,
    ) ?? events.find((event) => event.unlocked) ?? events[0];
  const [selectedId, setSelectedId] = useState(initialEvent.id);
  const selected = events.find((event) => event.id === selectedId) ?? initialEvent;
  const selectedResult = resultForEvent(careerResults, selected.id);
  const openingLevel = selected.structure.levels[0];
  // The marker sits on the current event's slot: with N events the slots are
  // centred at (i + 0.5)/N of the route's width.
  const currentIndex = Math.max(
    0,
    events.findIndex((event) => event.id === initialEvent.id),
  );
  const routeProgress = ((currentIndex + 0.5) / Math.max(1, events.length)) * 100;

  return (
    <main className="night-shell night-shell--tour" {...localeTextAttributes()}>
      <NightCircuitScene quiet />
      <section className="tour-lobby">
        <header className="tour-lobby__header">
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {formatMessage("dashboard.nav.backToTours")}
          </button>
          <p className="night-section-label">
            {mode === "normal"
              ? formatMessage("modes.normalTour")
              : formatMessage("modes.rationalTour")}
          </p>
          <h1>{formatMessage("dashboard.tour.title")}</h1>
          {/* Career state made visible: how far this track has come, and
              which event is waiting. Both read from the persisted save, so
              they survive a relaunch. */}
          <p className="tour-lobby__progress" role="status">
            <strong>
              {formatMessage("dashboard.tour.progressCount", {
                qualified: careerResults.filter((result) => result.qualified)
                  .length,
                total: events.length,
              })}
            </strong>
            <span>
              {activeEvent
                ? formatMessage("dashboard.tour.resuming", {
                    eventName: activeEvent.name,
                  })
                : formatMessage("dashboard.tour.nextUp", {
                    eventName: initialEvent.name,
                  })}
            </span>
          </p>
        </header>

        {/*
          A horizontal route rather than a stacked list: the journey reads
          left-to-right, with the marker sitting on the current event and the
          connecting line filled up to it. Stage is conveyed by an explicit
          text label and a distinct glyph as well as colour, so the states stay
          distinguishable without it.
        */}
        <ol
          className="event-route"
          aria-label={formatMessage("dashboard.tour.eventsAriaLabel")}
          style={{ "--route-progress": `${routeProgress}%` } as CSSProperties}
        >
          {events.map((event, index) => {
            const result = resultForEvent(careerResults, event.id);
            const status = !event.unlocked
              ? formatMessage("dashboard.tour.locked")
              : result?.qualified
                ? formatMessage("dashboard.tour.qualifiedStatus", {
                    finishPlace: result.finishPlace,
                    fieldSize: result.fieldSize,
                  })
                : result
                  ? formatMessage("dashboard.tour.retryStatus", {
                      finishPlace: result.finishPlace,
                      fieldSize: result.fieldSize,
                    })
                  : formatMessage("dashboard.tour.available");
            const stage = !event.unlocked
              ? "future"
              : result?.qualified
                ? "complete"
                : event.id === initialEvent.id
                  ? "current"
                  : "future";
            return (
              <li key={event.id} data-stage={stage}>
                <button
                  type="button"
                  disabled={!event.unlocked}
                  className={selected.id === event.id ? "is-selected" : ""}
                  aria-current={selected.id === event.id ? "true" : undefined}
                  onClick={() => setSelectedId(event.id)}
                >
                  <span className="event-route__index">
                    {stage === "complete" ? (
                      <Check size={15} aria-hidden="true" />
                    ) : stage === "current" ? (
                      <ChevronRight size={15} aria-hidden="true" />
                    ) : (
                      String(index + 1).padStart(2, "0")
                    )}
                  </span>
                  <div>
                    <strong>{event.name}</strong>
                    <small>{status}</small>
                    <em className="event-route__stage">
                      {formatMessage(`dashboard.tour.stage.${stage}`)}
                    </em>
                  </div>
                  {!event.unlocked && <LockKeyhole size={15} />}
                </button>
              </li>
            );
          })}
        </ol>

        <aside className="event-board">
          <p>{formatMessage(`career.tier.${selected.tier}`)}</p>
          <h2>{selected.name}</h2>
          <dl>
            <div>
              <dt>{formatMessage("dashboard.tour.startingStack")}</dt>
              <dd>{formatChips(selected.structure.startingStack)}</dd>
            </div>
            <div>
              <dt>{formatMessage("dashboard.tour.openingBlinds")}</dt>
              <dd>
                {openingLevel.smallBlind} / {openingLevel.bigBlind}
              </dd>
            </div>
            <div>
              <dt>{formatMessage("dashboard.tour.localField")}</dt>
              <dd>
                {formatMessage("dashboard.tour.playersCount", {
                  count: selected.sessionFieldSize,
                })}
              </dd>
            </div>
            <div>
              <dt>{formatMessage("dashboard.tour.advance")}</dt>
              <dd>{selected.qualificationLabel}</dd>
            </div>
          </dl>

          {selectedResult && (
            <p className="event-board__last-result">
              {formatMessage("dashboard.tour.lastResult", {
                finishPlace: selectedResult.finishPlace,
                fieldSize: selectedResult.fieldSize,
                suffix: selectedResult.qualified
                  ? formatMessage("dashboard.tour.qualifiedSuffix")
                  : formatMessage("dashboard.tour.notQualifiedSuffix"),
              })}
            </p>
          )}

          <button
            className="event-board__start"
            type="button"
            disabled={!onStartEvent}
            onClick={() => onStartEvent?.(selected.id)}
          >
            {onStartEvent
              ? selectedResult
                ? formatMessage("dashboard.tour.playAgain")
                : formatMessage("dashboard.tour.enterEvent")
              : formatMessage("dashboard.tour.connectionPending")}
          </button>
          <small className="event-board__disclosure">
            {formatMessage("dashboard.tour.disclosure")}
          </small>
        </aside>
      </section>
    </main>
  );
}

interface PlayerRecordProps {
  progress: PlayerProgress;
  onBack: () => void;
}

export function PlayerRecord({ progress, onBack }: PlayerRecordProps) {
  const averageMs =
    progress.trainingCompleted > 0
      ? progress.totalDecisionMs / progress.trainingCompleted
      : 0;
  // Undefined rather than 0% until at least one round has been reviewed, so an
  // untouched profile does not read as either perfect or failing.
  const reviewAccuracy =
    progress.reviewTotals && progress.reviewTotals.decisions > 0
      ? progress.reviewTotals.bestDecisions / progress.reviewTotals.decisions
      : undefined;

  return (
    <main className="night-shell night-shell--overlay" {...localeTextAttributes()}>
      <NightCircuitScene quiet />
      <section className="record-sheet">
        <button className="night-back" type="button" onClick={onBack}>
          <ArrowLeft size={18} /> {formatMessage("dashboard.nav.backToMenu")}
        </button>
        <p className="night-section-label">{formatMessage("dashboard.record.title")}</p>
        <h1>{progress.playerName}</h1>
        <dl>
          <div>
            <dt>{formatMessage("dashboard.record.tournamentElo")}</dt>
            <dd>{progress.tournamentElo}</dd>
          </div>
          <div>
            <dt>{formatMessage("dashboard.record.decisionElo")}</dt>
            <dd>{progress.decisionElo}</dd>
          </div>
          <div>
            <dt>{formatMessage("dashboard.record.mathElo")}</dt>
            <dd>{progress.mathElo}</dd>
          </div>
          <div>
            <dt>{formatMessage("dashboard.record.practiceHands")}</dt>
            <dd>{progress.trainingCompleted}</dd>
          </div>
          <div>
            <dt>{formatMessage("dashboard.record.averageDecision")}</dt>
            <dd>{averageMs ? formatClock(averageMs) : "—"}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}

interface TournamentCeremonyProps {
  result: TournamentSessionResult;
  onMenu: () => void;
  onNext?: (eventId: string) => void;
  onReview?: () => void;
  onExportReplay?: () => Promise<
    { ok: true; fileName?: string } | { ok: false; message: string }
  >;
}

export function TournamentCeremony({
  result,
  onMenu,
  onNext,
  onReview,
  onExportReplay,
}: TournamentCeremonyProps) {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState<string>();
  const headline =
    result.finishPlace === 1
      ? formatMessage("dashboard.ceremony.champion")
      : result.qualified
        ? formatMessage("dashboard.ceremony.qualified")
        : formatMessage("dashboard.ceremony.eliminated");
  const eventNames = new Map(
    listTournamentSessionEvents([]).map((event) => [event.id, event.name]),
  );

  return (
    <main className="night-shell night-shell--ceremony" {...localeTextAttributes()}>
      <NightCircuitScene quiet />
      <section
        className="ceremony-board"
        data-outcome={result.qualified || result.finishPlace === 1 ? "win" : "out"}
      >
        {/* A restrained celebratory beat. Purely decorative: the placement,
            qualification, and Elo change below carry the actual result, so
            the payoff is additive rather than load-bearing. */}
        <i className="ceremony-board__flare" aria-hidden="true" />
        <Trophy size={36} strokeWidth={1.5} />
        <p>{result.eventName}</p>
        <h1>{headline}</h1>
        <strong className="ceremony-board__place">{result.placementLabel}</strong>
        <p className="ceremony-board__qualification">
          {result.qualificationLabel}
        </p>
        <dl>
          <div>
            <dt>{formatMessage("dashboard.record.tournamentElo")}</dt>
            <dd>
              {result.elo.heroRating}{" "}
              <span>
                {result.tournamentEloDelta >= 0 ? "+" : ""}
                {result.tournamentEloDelta}
              </span>
            </dd>
          </div>
          <div>
            <dt>{formatMessage("dashboard.ceremony.handsPlayed")}</dt>
            <dd>{result.handNumber}</dd>
          </div>
        </dl>

        {result.newlyUnlockedEventIds.length > 0 && (
          <div className="ceremony-board__unlocks">
            <span>{formatMessage("dashboard.ceremony.unlocked")}</span>
            <strong>
              {result.newlyUnlockedEventIds
                .map((id) => eventNames.get(id) ?? id)
                .join(" · ")}
            </strong>
          </div>
        )}

        {/* What happens next, always stated. Qualifying used to show a Next
            button while a failed run showed only "Return to menu", which is
            what made the career feel like it dead-ended into a menu. */}
        <p className="ceremony-board__next" role="status">
          {result.nextEventId
            ? formatMessage("dashboard.ceremony.nextUp", {
                eventName:
                  eventNames.get(result.nextEventId) ?? result.nextEventId,
              })
            : result.qualified
              ? formatMessage("dashboard.ceremony.journeyComplete")
              : formatMessage("dashboard.ceremony.retryPath", {
                  eventName: result.eventName,
                })}
        </p>

        <div className="ceremony-board__actions">
          {result.nextEventId && onNext && (
            <button
              className="ceremony-board__primary"
              type="button"
              onClick={() => onNext(result.nextEventId!)}
            >
              {formatMessage("dashboard.ceremony.nextEvent")} <ArrowRight size={18} />
            </button>
          )}
          {onReview && (
            <button type="button" onClick={onReview}>
              {formatMessage("dashboard.ceremony.reviewKeyHand")}
            </button>
          )}
          {onExportReplay && (
            <button
              type="button"
              disabled={exportBusy}
              onClick={() => {
                setExportBusy(true);
                setExportStatus(undefined);
                void onExportReplay()
                  .then((outcome) => {
                    if (outcome.ok) {
                      setExportStatus(
                        outcome.fileName
                          ? formatMessage("dashboard.ceremony.exportedAs", {
                              fileName: outcome.fileName,
                            })
                          : formatMessage("dashboard.ceremony.exportedPlain"),
                      );
                    } else {
                      setExportStatus(outcome.message);
                    }
                  })
                  .finally(() => setExportBusy(false));
              }}
            >
              {formatMessage("dashboard.ceremony.exportReplay")}
            </button>
          )}
          <button type="button" onClick={onMenu}>
            {formatMessage("dashboard.ceremony.returnToMenu")}
          </button>
        </div>
        {onExportReplay && (
          <p
            className="ceremony-board__export-status"
            role="status"
            aria-live="polite"
          >
            {exportBusy
              ? formatMessage("dashboard.ceremony.exportPreparing")
              : (exportStatus ?? formatMessage("dashboard.ceremony.exportHint"))}
          </p>
        )}
      </section>
    </main>
  );
}
