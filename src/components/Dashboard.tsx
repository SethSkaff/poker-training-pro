import { ArrowLeft, ArrowRight, LockKeyhole, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import { formatClock, formatChips } from "../lib/format";
import { formatMessage } from "../lib/localeMessages";
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
        <small>Poker Training Pro</small>
        <strong>Championship Series</strong>
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
    "Start-menu artwork",
  );
  const selectedStill = useResilientAsset(
    selectedAction === "settings"
      ? START_MENU_SETTINGS_STILL
      : START_MENU_STILL,
    selectedAction === "settings"
      ? "Settings-selected artwork"
      : "Start-menu artwork",
  );
  const loop = useResilientAsset(
    START_MENU_LOOP ?? "start-menu-loop-disabled",
    "Animated start-menu background",
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
    >
      <h1 id="main-menu-title" className="visually-hidden">
        Poker Training Pro main menu
      </h1>
      <div
        className="home-reference__media"
        data-canonical-status={canonicalStill.status}
        data-selected-status={activeMediaStatus}
        aria-hidden="true"
      >
        <div className="home-reference__fallback">
          <span className="home-reference__fallback-mark">♠</span>
          <strong>Poker Training Pro</strong>
          <small>Championship Series</small>
          <span className="home-reference__fallback-action home-reference__fallback-action--play">
            Play
          </span>
          <span className="home-reference__fallback-action home-reference__fallback-action--settings">
            Settings
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

      <nav className="home-reference__controls" aria-label="Main menu">
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
        Play chips only <span aria-hidden="true">·</span> No real-money wagering
      </p>

      {onCredits ? (
        <button
          className="home-reference__credits-link"
          type="button"
          onClick={onCredits}
        >
          Credits &amp; licenses
        </button>
      ) : null}
    </main>
  );
}

interface ModeSelectProps {
  onBack: () => void;
  onSelect: (mode: GameMode | "timed" | "tutorial") => void;
}

export function ModeSelect({ onBack, onSelect }: ModeSelectProps) {
  return (
    <main
      className="night-shell night-shell--mode-select"
      aria-labelledby="mode-select-title"
    >
      <NightCircuitScene />
      <section className="mode-stage">
        <header>
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> Main menu
          </button>
          <div>
            <p className="night-section-label">Play</p>
            <h1 id="mode-select-title">Choose a mode</h1>
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
              <small>Adaptive tournament field</small>
              <strong>Normal</strong>
              <span>Strong opponents with pressure, personalities, and selective bluffs.</span>
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
              <small>Mathematical tournament field</small>
              <strong>Rational</strong>
              <span>Range-aware opponents following explicit information-set policy.</span>
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
              <small>One decision at a time</small>
              <strong>Training</strong>
              <span>Focused poker situations with one linked math question and feedback.</span>
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
              <small>Fit a table into your schedule</small>
              <strong>Timed Table</strong>
              <span>Normal opponents at one table for the time you choose.</span>
            </span>
            <ArrowRight size={21} />
          </button>
        </div>
        <button
          className="mode-stage__tutorial-link"
          type="button"
          onClick={() => onSelect("tutorial")}
        >
          New to the table? <strong>Learn the basics</strong>
          <ArrowRight size={16} aria-hidden="true" />
        </button>
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
    <main className="night-shell night-shell--timed">
      <NightCircuitScene quiet />
      <section className="timed-setup">
        <button className="night-back" type="button" onClick={onBack}>
          <ArrowLeft size={18} /> Choose mode
        </button>
        <p className="night-section-label">Timed Table</p>
        <h1>How much time do you have?</h1>

        <div className="timed-presets" aria-label="Session length presets">
          {TIMED_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className={minutes === preset ? "is-selected" : ""}
              onClick={() => setMinutesText(String(preset))}
              aria-pressed={minutes === preset}
            >
              <strong>{preset}</strong>
              <span>min</span>
            </button>
          ))}
        </div>

        <label className="timed-custom">
          <span>Custom minutes</span>
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
          Choose a whole number from 5 to 180 minutes.
        </p>

        <p className="timed-setup__note">
          One table · Normal opponents · No career progression
        </p>

        <button
          className="timed-setup__start"
          type="button"
          disabled={!validMinutes}
          onClick={() => onStart(minutes)}
        >
          Start <ArrowRight size={19} />
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
  onBack: () => void;
  onStartEvent?: (eventId: string) => void;
}

export function TourLobby({
  mode,
  careerResults,
  onBack,
  onStartEvent,
}: TourLobbyProps) {
  const events = useMemo(
    () => listTournamentSessionEvents(careerResults),
    [careerResults],
  );
  const initialEvent =
    events.find(
      (event) =>
        event.unlocked && !resultForEvent(careerResults, event.id)?.qualified,
    ) ?? events.find((event) => event.unlocked) ?? events[0];
  const [selectedId, setSelectedId] = useState(initialEvent.id);
  const selected = events.find((event) => event.id === selectedId) ?? initialEvent;
  const selectedResult = resultForEvent(careerResults, selected.id);
  const openingLevel = selected.structure.levels[0];

  return (
    <main className="night-shell night-shell--tour">
      <NightCircuitScene quiet />
      <section className="tour-lobby">
        <header className="tour-lobby__header">
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> Choose tour
          </button>
          <p className="night-section-label">
            {mode === "normal" ? "Normal Tour" : "Rational Tour"}
          </p>
          <h1>Championship road</h1>
        </header>

        <ol className="event-route" aria-label="Tournament events">
          {events.map((event, index) => {
            const result = resultForEvent(careerResults, event.id);
            const status = !event.unlocked
              ? "Locked"
              : result?.qualified
                ? `${result.finishPlace} of ${result.fieldSize} · Qualified`
                : result
                  ? `${result.finishPlace} of ${result.fieldSize} · Retry`
                  : "Available";
            return (
              <li key={event.id}>
                <button
                  type="button"
                  disabled={!event.unlocked}
                  className={selected.id === event.id ? "is-selected" : ""}
                  aria-current={selected.id === event.id ? "true" : undefined}
                  onClick={() => setSelectedId(event.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{event.name}</strong>
                    <small>{status}</small>
                  </div>
                  {!event.unlocked && <LockKeyhole size={15} />}
                </button>
              </li>
            );
          })}
        </ol>

        <aside className="event-board">
          <p>{selected.tier}</p>
          <h2>{selected.name}</h2>
          <dl>
            <div>
              <dt>Starting stack</dt>
              <dd>{formatChips(selected.structure.startingStack)}</dd>
            </div>
            <div>
              <dt>Opening blinds</dt>
              <dd>
                {openingLevel.smallBlind} / {openingLevel.bigBlind}
              </dd>
            </div>
            <div>
              <dt>Local field</dt>
              <dd>{selected.sessionFieldSize} players</dd>
            </div>
            <div>
              <dt>Advance</dt>
              <dd>{selected.qualificationLabel}</dd>
            </div>
          </dl>

          {selectedResult && (
            <p className="event-board__last-result">
              Last result: {selectedResult.finishPlace} of{" "}
              {selectedResult.fieldSize}
              {selectedResult.qualified ? " — qualified" : " — not qualified"}
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
                ? "Play event again"
                : "Enter event"
              : "Tournament table connection pending"}
          </button>
          <small className="event-board__disclosure">
            Six-seat local simulation. Qualification ratios and blind structure
            come from the full career event.
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

  return (
    <main className="night-shell night-shell--overlay">
      <NightCircuitScene quiet />
      <section className="record-sheet">
        <button className="night-back" type="button" onClick={onBack}>
          <ArrowLeft size={18} /> Main menu
        </button>
        <p className="night-section-label">Player record</p>
        <h1>{progress.playerName}</h1>
        <dl>
          <div>
            <dt>Tournament Elo</dt>
            <dd>{progress.tournamentElo}</dd>
          </div>
          <div>
            <dt>Decision Elo</dt>
            <dd>{progress.decisionElo}</dd>
          </div>
          <div>
            <dt>Math Elo</dt>
            <dd>{progress.mathElo}</dd>
          </div>
          <div>
            <dt>Practice hands</dt>
            <dd>{progress.trainingCompleted}</dd>
          </div>
          <div>
            <dt>Average decision</dt>
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
      ? "Champion"
      : result.qualified
        ? "Qualified"
        : "Eliminated";
  const eventNames = new Map(
    listTournamentSessionEvents([]).map((event) => [event.id, event.name]),
  );

  return (
    <main className="night-shell night-shell--ceremony">
      <NightCircuitScene quiet />
      <section className="ceremony-board">
        <Trophy size={36} strokeWidth={1.5} />
        <p>{result.eventName}</p>
        <h1>{headline}</h1>
        <strong className="ceremony-board__place">{result.placementLabel}</strong>
        <p className="ceremony-board__qualification">
          {result.qualificationLabel}
        </p>
        <dl>
          <div>
            <dt>Tournament Elo</dt>
            <dd>
              {result.elo.heroRating}{" "}
              <span>
                {result.tournamentEloDelta >= 0 ? "+" : ""}
                {result.tournamentEloDelta}
              </span>
            </dd>
          </div>
          <div>
            <dt>Hands played</dt>
            <dd>{result.handNumber}</dd>
          </div>
        </dl>

        {result.newlyUnlockedEventIds.length > 0 && (
          <div className="ceremony-board__unlocks">
            <span>Unlocked</span>
            <strong>
              {result.newlyUnlockedEventIds
                .map((id) => eventNames.get(id) ?? id)
                .join(" · ")}
            </strong>
          </div>
        )}

        <div className="ceremony-board__actions">
          {result.nextEventId && onNext && (
            <button type="button" onClick={() => onNext(result.nextEventId!)}>
              Next event <ArrowRight size={18} />
            </button>
          )}
          {onReview && (
            <button type="button" onClick={onReview}>
              Review key hand
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
                          ? `Redacted replay exported as ${outcome.fileName}.`
                          : "Redacted replay exported.",
                      );
                    } else {
                      setExportStatus(outcome.message);
                    }
                  })
                  .finally(() => setExportBusy(false));
              }}
            >
              Export event replay
            </button>
          )}
          <button type="button" onClick={onMenu}>
            Return to menu
          </button>
        </div>
        {onExportReplay && (
          <p
            className="ceremony-board__export-status"
            role="status"
            aria-live="polite"
          >
            {exportBusy
              ? "Preparing a redacted replay…"
              : (exportStatus ??
                "Export a redacted, play-safe replay of this event for a bug report.")}
          </p>
        )}
      </section>
    </main>
  );
}
