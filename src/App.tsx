import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HomeView,
  ModeSelect,
  NightCircuitScene,
  PlayerRecord,
  TimedSetup,
  TournamentCeremony,
  TourLobby,
} from "./components/Dashboard";
import { RecoveryScreen } from "./components/RecoveryScreen";
import {
  PokerReferenceContent,
  TrainerOrientationContent,
} from "./components/PokerReference";
import { ArrowLeft } from "lucide-react";
import { useGamepadNavigation } from "./components/GamepadNavigationProvider";
import { AboutSupport } from "./components/AboutSupport";
import { CreditsScreen } from "./components/CreditsScreen";
import { PlayChipAcknowledgment } from "./components/PlayChipAcknowledgment";
import { SaveDataControls } from "./components/SaveDataControls";
import { lazyWithPreload, SceneLoadingFallback } from "./components/SceneLoader";
import { SettingsPanel } from "./components/SettingsPanel";
import { trainingScenarios } from "./data/trainingScenarios";
import { gameAudio } from "./lib/audio";
import { tournamentResultAudioCue } from "./lib/tournamentResultAudio";
import { productionMusicManifest } from "./data/musicPlaylistManifest";
import { createBrowserMusicSink } from "./lib/browserMusicSink";
import {
  createMusicPlaylist,
  musicVolumeFromSettings,
  type MusicPlaylistController,
} from "./lib/musicPlaylist";
import { connectFeedbackDucking } from "./lib/musicDucking";
import {
  acknowledgePlayChips,
  needsPlayChipAcknowledgment,
} from "./lib/playChipDisclosure";
import {
  defaultProgress,
  defaultSettings,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
} from "./lib/storage";
import {
  createDesktopPersistence,
  type DurableBoundary,
  type StartupLoadResult,
} from "./lib/durablePersistence";
import {
  useAudioFocusLifecycle,
  useDesktopSaveHandshake,
} from "./lib/desktopLifecycle";
import { createSaveEnvelope } from "./lib/saveMigration";
import { formatChips } from "./lib/format";
import { formatMessage, localeTextAttributes } from "./lib/localeMessages";
import { deriveSafeModeSettings } from "./lib/safeMode";
import {
  applyOsReducedMotionDefault,
  readOsReducedMotionPreference,
  subscribeOsReducedMotionPreference,
} from "./lib/motionPreference";
import {
  completeFirstRunSettings,
  skipFirstRunSettings,
} from "./lib/firstRunSettings";
import {
  selectNearTransferScenario,
  selectTrainingSessionStartScenario,
} from "./lib/trainingEngine";
import {
  createTrainingCheckpoint,
  restoreTrainingCheckpoint,
  type TrainingPresentationCheckpoint,
} from "./lib/trainingCheckpoint";
import {
  advanceTournamentRunnerOneStep,
  advanceTournamentRunnerOneStepAsync,
  advanceTournamentRunnerToHero,
  applyHeroTournamentActionOneStep,
  createCareerTournamentRunner,
  createTimedTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
  restoreTournamentRunnerReplay,
  TournamentAdvanceAborted,
  type HeroTournamentAction,
  type TournamentPresentationEvent,
  type TournamentPresentationStep,
  type TournamentRunner,
  type TournamentRunnerReplay,
} from "./modes/tournamentRunner";
import {
  CancelledEquityRequestError,
  createDesktopEquityService,
  StaleEquityRequestError,
  type RationalEquityService,
} from "./modes/rationalEquityService";
import type {
  TournamentPolicyMode,
  TournamentSessionCareerResult,
  TournamentSessionResult,
} from "./modes/tournamentSession";
import {
  createPokerTableSnapshot,
  listTournamentSessionEvents,
  SESSION_TABLE_SIZE,
} from "./modes/tournamentSession";
import type {
  CareerEventResult,
  GameSettings,
  PlayerProgress,
} from "./types/poker";

// Mode-specific heavy scenes are code-split so the initial bundle stays small.
// Each keeps an idempotent `preload()` used to fetch the next likely scene.
const PokerTable = lazyWithPreload(() =>
  import("./components/PokerTable").then((module) => ({
    default: module.PokerTable,
  })),
);
const PlayableTutorial = lazyWithPreload(() =>
  import("./components/PlayableTutorial").then((module) => ({
    default: module.PlayableTutorial,
  })),
);
const RoomFlythrough = lazyWithPreload(() =>
  import("./components/RoomFlythrough").then((module) => ({
    default: module.RoomFlythrough,
  })),
);
const HandReviewScreen = lazyWithPreload(() =>
  import("./components/HandReviewScreen").then((module) => ({
    default: module.HandReviewScreen,
  })),
);
const CareerTravel = lazyWithPreload(() =>
  import("./components/CareerTravel").then((module) => ({
    default: module.CareerTravel,
  })),
);

type DesktopScreen =
  | "home"
  | "play"
  | "tour"
  | "profile"
  | "settings"
  | "timed-setup"
  | "room-transition"
  | "career-travel"
  | "tournament-table"
  | "practice"
  | "tutorial"
  | "credits"
  | "hand-review"
  | "reference"
  | "chip-ack";

type SafeModeState = Awaited<
  ReturnType<NonNullable<Window["desktop"]>["getSafeModeState"]>
>;

interface PendingTournamentPresentation {
  source: TournamentRunner;
  next: TournamentRunner;
  events: readonly TournamentPresentationEvent[];
  index: number;
  /** A single result beat retained after an explicit fast-forward. */
  skipResultVisible?: boolean;
  /** Public fold terminal state retained while the readable Skip result holds. */
  skipTerminalFoldedPlayerIds?: readonly string[];
}

type AllInRevealPresentation = Extract<
  TournamentPresentationEvent,
  { kind: "all-in-reveal" }
>;

/*
  Replay export is a support and diagnostics path, not a player feature
  (E27-011). It is compiled out of ordinary builds rather than merely hidden, so
  a raw JSON workflow cannot reappear on the ceremony screen through a styling
  change. Support builds set VITE_ENABLE_REPLAY_EXPORT to turn it back on.
*/
const replayExportEnabled =
  import.meta.env?.VITE_ENABLE_REPLAY_EXPORT === "true";

const emptyCareer = (): NonNullable<PlayerProgress["career"]> => ({
  normal: { results: [] },
  rational: { results: [] },
});

/**
 * Narrows persisted results to the session's career-result type.
 *
 * The save schema stores `fieldSize` as a plain number because it must
 * faithfully record whatever was written, including by a future build; the
 * session type pins it to the six-seat table. Anything else is a save from a
 * format this build does not model, so it is dropped rather than coerced into
 * a shape the session would then reason about incorrectly.
 */
function toSessionCareerResults(
  results: readonly CareerEventResult[] | undefined,
): TournamentSessionCareerResult[] {
  return (results ?? [])
    .filter((result) => result.fieldSize === SESSION_TABLE_SIZE)
    .map((result) => ({ ...result, fieldSize: SESSION_TABLE_SIZE }));
}

/** Records a completed career event and clears that track's active event. */
function careerWithCompletedEvent(
  career: PlayerProgress["career"],
  mode: TournamentPolicyMode,
  result: TournamentSessionResult,
): NonNullable<PlayerProgress["career"]> {
  const base = career ?? emptyCareer();
  const track = base[mode];
  return {
    ...base,
    [mode]: {
      // Replaying an event supersedes its earlier result rather than
      // accumulating duplicates.
      results: [
        ...track.results.filter((entry) => entry.eventId !== result.eventId),
        {
          eventId: result.eventId,
          finishPlace: result.finishPlace,
          fieldSize: result.fieldSize,
          sourceFieldSize: result.sourceFieldSize,
          qualifyingPlaces: result.qualifyingPlaces,
          qualified: result.qualified,
          tournamentEloDelta: result.tournamentEloDelta,
        },
      ],
    },
  };
}

/** Marks an event as the one in progress for a track. */
function careerWithActiveEvent(
  career: PlayerProgress["career"],
  mode: TournamentPolicyMode,
  eventId: string,
): NonNullable<PlayerProgress["career"]> {
  const base = career ?? emptyCareer();
  return { ...base, [mode]: { ...base[mode], activeEventId: eventId } };
}

function asTournamentReplay(
  value?: Record<string, unknown>,
): TournamentRunnerReplay | undefined {
  return value?.format === "poker-training-pro-tournament-replay" &&
    value.version === 1
    ? (value as unknown as TournamentRunnerReplay)
    : undefined;
}

function FirstRunSetup({
  initialSettings,
  onComplete,
}: {
  initialSettings: GameSettings;
  onComplete(settings: GameSettings): void;
}) {
  const [draft, setDraft] = useState(initialSettings);
  const [motionChoiceTouched, setMotionChoiceTouched] = useState(false);
  const patch = (next: Partial<GameSettings>) =>
    setDraft((current) => ({ ...current, ...next }));

  return (
    <main className="startup-gate" aria-labelledby="first-run-title">
      <section className="startup-gate__panel startup-gate__panel--wide">
        <p className="startup-gate__eyebrow">{formatMessage("shell.firstRun.eyebrow")}</p>
        <h1 id="first-run-title">{formatMessage("shell.firstRun.title")}</h1>
        <p>{formatMessage("shell.firstRun.intro")}</p>
        <div className="first-run-options">
          <label>
            <input
              type="checkbox"
              checked={draft.reducedMotion}
              onChange={(event) => {
                setMotionChoiceTouched(true);
                patch({ reducedMotion: event.target.checked });
              }}
            />
            <span>
              <strong>{formatMessage("shell.firstRun.reduceMotion.label")}</strong>
              <small>{formatMessage("shell.firstRun.reduceMotion.description")}</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.colorAssist}
              onChange={(event) => patch({ colorAssist: event.target.checked })}
            />
            <span>
              <strong>{formatMessage("shell.firstRun.highContrast.label")}</strong>
              <small>{formatMessage("shell.firstRun.highContrast.description")}</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.muted}
              onChange={(event) => patch({ muted: event.target.checked })}
            />
            <span>
              <strong>{formatMessage("shell.firstRun.startMuted.label")}</strong>
              <small>{formatMessage("shell.firstRun.startMuted.description")}</small>
            </span>
          </label>
          <fieldset>
            <legend>{formatMessage("settings.dealSpeed.heading")}</legend>
            {(["cinematic", "standard", "quick"] as const).map((speed) => (
              <button
                key={speed}
                type="button"
                aria-pressed={draft.dealSpeed === speed}
                onClick={() => patch({ dealSpeed: speed })}
              >
                {speed}
              </button>
            ))}
          </fieldset>
        </div>
        <p className="first-run-controls">
          {formatMessage("shell.firstRun.keyboardHint")}
        </p>
        <div className="startup-gate__actions">
          <button
            type="button"
            onClick={() =>
              onComplete(
                completeFirstRunSettings(
                  initialSettings,
                  draft,
                  motionChoiceTouched,
                ),
              )
            }
          >
            {formatMessage("shell.firstRun.saveButton")}
          </button>
          <button
            type="button"
            onClick={() => onComplete(skipFirstRunSettings(initialSettings))}
          >
            {formatMessage("shell.firstRun.skipButton")}
          </button>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [persistence] = useState(() => createDesktopPersistence());
  const [startup, setStartup] = useState<
    StartupLoadResult | { kind: "loading" }
  >(() => (persistence ? { kind: "loading" } : { kind: "first-run" }));
  const [screen, setScreen] = useState<DesktopScreen>("home");
  const [creditsReturn, setCreditsReturn] = useState<DesktopScreen>("home");
  const [tourMode, setTourMode] = useState<TournamentPolicyMode>("normal");
  const [timedMinutes, setTimedMinutes] = useState(30);
  const [runner, setRunner] = useState<TournamentRunner | null>(null);
  const [pendingPresentation, setPendingPresentation] =
    useState<PendingTournamentPresentation | null>(null);
  // Legal reveal data belongs to the renderer's in-memory presentation state,
  // not the game model. It remains visible through a queued all-in runout and
  // is discarded as soon as that hand ends.
  const [activeAllInReveal, setActiveAllInReveal] =
    useState<AllInRevealPresentation>();
  const [resumeCandidate, setResumeCandidate] = useState<TournamentRunner | null>(null);
  const [trainingResumeScenarioId, setTrainingResumeScenarioId] = useState<
    string | null
  >(null);
  const [trainingPresentation, setTrainingPresentation] = useState<
    TrainingPresentationCheckpoint | undefined
  >(undefined);
  const activeReplayRef = useRef<Record<string, unknown> | undefined>(
    undefined,
  );
  const tournamentPausedAtRef = useRef<number | null>(null);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [progress, setProgress] = useState(() => loadProgress());
  // Career progress is read from the persisted save, not held in ephemeral
  // component state. The previous `useState(emptyTourResults)` was never
  // written to disk, so every relaunch restarted the career at Local
  // Qualifier no matter how far the player had actually progressed.
  const tourResults = useMemo(
    () => ({
      normal: toSessionCareerResults(progress.career?.normal.results),
      rational: toSessionCareerResults(progress.career?.rational.results),
    }),
    [progress.career],
  );
  const [tournamentResult, setTournamentResult] =
    useState<TournamentSessionResult | null>(null);
  const [lastPublicReplay, setLastPublicReplay] =
    useState<Record<string, unknown>>();
  const [saveFailure, setSaveFailure] = useState<string>();
  const [startupError, setStartupError] = useState<string>();
  const [safeMode, setSafeMode] = useState<SafeModeState>();
  const [safeModeReady, setSafeModeReady] = useState(!window.desktop);
  const [safeModeAcknowledged, setSafeModeAcknowledged] = useState(false);
  // The OS reduced-motion preference, used as the default whenever the
  // player has not made an explicit in-app choice (see motionPreference.ts).
  const [osReducedMotion, setOsReducedMotion] = useState(() =>
    readOsReducedMotionPreference(),
  );
  const [trainingScenario, setTrainingScenario] = useState(
    () => trainingScenarios[0],
  );
  const lastPresentedHand = useRef<string | null>(null);
  // Set when the fly-through hands off to the table, so the table's first hand
  // opens with the same settling overlay a between-hand arrival gets. Without
  // it the screen swap is a hard cut: the venue vanishes and the felt appears
  // fully lit mid-deal (E09-004).
  const arrivingFromFlythrough = useRef(false);
  // The leg of the circuit currently being travelled (E20-003). Finishing an
  // event used to drop straight back to a lobby list, which is what made the
  // career read as a menu with tournaments behind it rather than a circuit.
  const [travelLeg, setTravelLeg] = useState<{
    fromEventId: string;
    toEventId: string;
  } | null>(null);
  // Worker-backed equity boundary: opponent Monte Carlo runs off the main
  // thread. Decisions stay bit-for-bit deterministic with the synchronous path;
  // a superseded/obsolete decision is cancelled and its stale result rejected.
  const equityServiceRef = useRef<RationalEquityService | null>(null);
  const decisionAbortRef = useRef<{ aborted: boolean } | null>(null);
  const decisionPendingRef = useRef(false);
  const runnerRef = useRef<TournamentRunner | null>(null);
  const pendingPresentationRef = useRef<PendingTournamentPresentation | null>(
    null,
  );
  const presentationAdvancePendingRef = useRef(false);
  const lastTournamentSnapshotRef = useRef<ReturnType<
    typeof createPokerTableSnapshot
  > | null>(null);
  // Live OS default layered under any explicit player choice; Safe Mode is
  // applied last and always wins over both.
  const osResolvedSettings: GameSettings = applyOsReducedMotionDefault(
    settings,
    osReducedMotion,
  );
  const effectiveSettings: GameSettings = deriveSafeModeSettings(
    osResolvedSettings,
    Boolean(safeMode?.active),
  );

  // Controller navigation for the entire desktop flow (menus, dialogs,
  // sliders, table). Keyboard-only operation stays complete alongside it.
  useGamepadNavigation(effectiveSettings.controlBindings);

  useEffect(() => subscribeOsReducedMotionPreference(setOsReducedMotion), []);

  useEffect(() => {
    if (!window.desktop) return;
    void window.desktop
      .getSafeModeState()
      .then(setSafeMode)
      .catch(() =>
        setSafeMode({
          available: false,
          active: true,
          reason: "repeated-renderer-failures",
          failureCount: 0,
          recoveryMarkerRecovered: true,
        }),
      )
      .finally(() => setSafeModeReady(true));
  }, []);

  const loadAuthoritativeStartup = useCallback(async () => {
    if (!persistence) {
      setStartup({ kind: "first-run" });
      return;
    }
    setStartup({ kind: "loading" });
    const loaded = await persistence.loadStartup();
    if (loaded.kind === "ready") {
      setSettings(loaded.save.data.settings);
      setProgress(loaded.save.data.progress);
      const replay = asTournamentReplay(loaded.replay);
      if (replay) {
        try {
          const restored = restoreTournamentRunnerReplay(replay);
          // A completed runner is not resumable play, but its redacted replay
          // must remain available after a normal app restart. Keep the raw
          // checkpoint only in the private ref; the player-visible export
          // path stays redacted by the native backend.
          activeReplayRef.current = loaded.replay;
          if (restored.session.status === "playing") {
            setResumeCandidate(restored);
          } else if (restored.session.status === "complete") {
            setLastPublicReplay(loaded.replay);
          }
        } catch {
          setStartupError(formatMessage("shell.error.tournamentReplayFailed"));
        }
      } else {
        const trainingCheckpoint = restoreTrainingCheckpoint(
          loaded.replay,
          new Set(trainingScenarios.map((scenario) => scenario.id)),
        );
        if (trainingCheckpoint) {
          activeReplayRef.current = trainingCheckpoint;
          setTrainingScenario(
            trainingScenarios.find(
              (scenario) => scenario.id === trainingCheckpoint.scenarioId,
            ) ?? trainingScenarios[0],
          );
          setTrainingPresentation(trainingCheckpoint.presentation);
          setTrainingResumeScenarioId(trainingCheckpoint.scenarioId);
        }
      }
    } else if (loaded.kind === "first-run") {
      const created = await persistence.commitLifecycle(
        defaultSettings,
        defaultProgress,
      );
      if (created.ok) {
        setSettings(defaultSettings);
        setProgress(defaultProgress);
        setStartup({
          kind: "ready",
          save: createSaveEnvelope(defaultSettings, defaultProgress),
          source: "current",
          receipt: created.value,
          warnings: [],
        });
        return;
      } else {
        setStartup({
          kind: "recovery",
          failure: created.error,
          attempts: [created.error],
        });
        return;
      }
    }
    setStartup(loaded);
  }, [persistence]);

  useEffect(() => {
    void loadAuthoritativeStartup();
  }, [loadAuthoritativeStartup]);

  const persistBoundary = useCallback(
    (
      boundary: DurableBoundary,
      nextSettings: GameSettings,
      nextProgress: PlayerProgress,
      replay?: Record<string, unknown>,
    ) => {
      const checkpoint = replay ?? activeReplayRef.current;
      if (!persistence) {
        saveSettings(nextSettings);
        saveProgress(nextProgress);
        return;
      }
      const operation =
        boundary === "settings"
          ? persistence.commitSettings(nextSettings, nextProgress, checkpoint)
          : boundary === "hand"
            ? persistence.commitHand(nextSettings, nextProgress, checkpoint)
            : boundary === "result"
              ? persistence.commitResult(nextSettings, nextProgress, checkpoint)
              : boundary === "lifecycle"
                ? persistence.commitLifecycle(nextSettings, nextProgress, checkpoint)
                : persistence.commitAction(
                    nextSettings,
                    nextProgress,
                    checkpoint,
                  );
      void operation.then((result) => {
        if (result.ok) {
          setSaveFailure(undefined);
        } else {
          setSaveFailure(result.error.message);
        }
      });
    },
    [persistence],
  );

  // Save at every safe OS boundary (close, session end, before-quit, suspend)
  // and let the main process confirm before abandoning unsaved scored progress.
  useDesktopSaveHandshake({
    saveNow: () => persistBoundary("lifecycle", settings, progress),
    hasUnsavedScoredProgress: () => persistence?.hasPendingCommit() ?? false,
  });
  // Apply the deterministic audio-focus policy outside the table; the table owns
  // its own focus muting while it is mounted.
  useAudioFocusLifecycle(
    screen !== "practice" && screen !== "tournament-table",
  );

  // Chromium's CSS zoom scales the entire application—including the dense
  // table HUD and action targets—rather than merely changing prose font sizes.
  // It is deliberately applied at the root so every screen responds together.
  useEffect(() => {
    document.documentElement.dataset.interfaceScale = settings.interfaceScale;
    return () => {
      delete document.documentElement.dataset.interfaceScale;
    };
  }, [settings.interfaceScale]);

  // Safe mode is deliberately a renderer-wide presentation guard, not merely
  // a preferences adjustment. It stops decorative CSS motion even on screens
  // that do not receive the settings object as a prop.
  useEffect(() => {
    if (safeMode?.active) {
      document.documentElement.dataset.safeMode = "true";
    } else {
      delete document.documentElement.dataset.safeMode;
    }
    return () => {
      delete document.documentElement.dataset.safeMode;
    };
  }, [safeMode?.active]);

  // Background music playlist engine. DORMANT: the production manifest ships no
  // licensed masters, so `createMusicPlaylist` builds no audio graph and makes
  // no sound. The duck-under-feedback bridge and focus/volume wiring below are
  // connected eagerly (a dormant controller's methods all no-op), so the very
  // moment a licensed manifest lands, playback, ducking, pause/focus, and the
  // player's saved Music volume are already correct with no further wiring.
  const playlistRef = useRef<MusicPlaylistController | null>(null);
  useEffect(() => {
    const playlist = createMusicPlaylist(productionMusicManifest, {
      sink: createBrowserMusicSink(),
      random: { next: () => Math.random() },
      now: () =>
        typeof performance !== "undefined" ? performance.now() : Date.now(),
    });
    playlistRef.current = playlist;
    const disconnectDucking = connectFeedbackDucking(gameAudio, playlist);
    // The table (while mounted) and the desktop lifecycle hook (elsewhere) both
    // funnel through `gameAudio`'s focus-mute state, so subscribing here keeps
    // the music bed's pause/resume in lockstep with whichever surface currently
    // owns focus muting, without the playlist needing its own listeners. The
    // very first playback start is gated on this too (deferred until the audio
    // focus policy reports non-muted), matching the "no audio before the
    // player's first input/Ready gesture" rule that already governs `gameAudio`
    // — belt-and-suspenders on top of whatever real Web Audio sink eventually
    // replaces the null stub below.
    let started = false;
    const unsubscribeFocus = gameAudio.observeFocusMuted((muted) => {
      if (playlist.dormant) return;
      if (muted) {
        playlist.pause();
      } else if (!started) {
        started = true;
        playlist.start();
      } else {
        playlist.resume();
      }
    });
    return () => {
      unsubscribeFocus();
      disconnectDucking();
      playlist.stop();
      playlistRef.current = null;
    };
  }, []);

  const updateProgress = useCallback(
    (nextProgress: PlayerProgress) => {
      setProgress(nextProgress);
      persistBoundary("action", settings, nextProgress);
    },
    [persistBoundary, settings],
  );

  const updateSettings = useCallback(
    (nextSettings: GameSettings) => {
      setSettings(nextSettings);
      persistBoundary("settings", nextSettings, progress);
      gameAudio.setMasterVolume(nextSettings.masterVolume);
      gameAudio.setMuted(nextSettings.muted);
      gameAudio.setMusicVolume(nextSettings.musicVolume);
      gameAudio.setEffectsVolume(nextSettings.effectsVolume);
    },
    [persistBoundary, progress],
  );

  const setFullscreen = useCallback(
    async (fullscreen: boolean) => {
      if (window.desktop) {
        await window.desktop.setFullscreen(fullscreen);
      } else if (fullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (!fullscreen && document.fullscreenElement) {
        await document.exitFullscreen();
      }

      const nextSettings = { ...settings, fullscreen };
      setSettings(nextSettings);
      persistBoundary("settings", nextSettings, progress);
    },
    [persistBoundary, progress, settings],
  );

  useEffect(() => {
    document.documentElement.classList.toggle(
      "reduced-motion",
      effectiveSettings.reducedMotion,
    );
    document.documentElement.classList.toggle(
      "high-contrast",
      effectiveSettings.colorAssist,
    );
    gameAudio.setMasterVolume(effectiveSettings.masterVolume);
    gameAudio.setMuted(effectiveSettings.muted);
    gameAudio.setMusicVolume(effectiveSettings.musicVolume);
    gameAudio.setEffectsVolume(effectiveSettings.effectsVolume);
    // Mirror the same Master x Music (and Mute) computation into the playlist
    // engine's own [0, 1] gain, so the player's saved Music slider and mute
    // toggle already apply the instant a licensed manifest makes it non-dormant.
    playlistRef.current?.setMusicVolume(
      musicVolumeFromSettings(effectiveSettings),
    );
  }, [
    effectiveSettings.colorAssist,
    effectiveSettings.effectsVolume,
    effectiveSettings.masterVolume,
    effectiveSettings.musicVolume,
    effectiveSettings.muted,
    effectiveSettings.reducedMotion,
  ]);

  // Per-surface motion preferences are renderer-wide data attributes so every
  // decorative screen can honor them without threading settings through each
  // component. The global Reduce motion toggle and Safe Mode still win.
  useEffect(() => {
    const root = document.documentElement;
    const forcedOff = effectiveSettings.reducedMotion;
    const preferences = {
      menu: effectiveSettings.menuMotion,
      room: effectiveSettings.roomMotion,
      camera: effectiveSettings.cameraMotion,
      table: effectiveSettings.tableMotion,
      transition: effectiveSettings.transitionMotion,
    } as const;
    for (const [surface, preference] of Object.entries(preferences)) {
      root.dataset[`motion${surface[0].toUpperCase()}${surface.slice(1)}`] =
        forcedOff ? "off" : preference;
    }
    return () => {
      for (const surface of Object.keys(preferences)) {
        delete root.dataset[`motion${surface[0].toUpperCase()}${surface.slice(1)}`];
      }
    };
  }, [
    effectiveSettings.cameraMotion,
    effectiveSettings.menuMotion,
    effectiveSettings.reducedMotion,
    effectiveSettings.roomMotion,
    effectiveSettings.tableMotion,
    effectiveSettings.transitionMotion,
  ]);

  useEffect(() => {
    const handleFullscreenShortcut = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "Enter") {
        event.preventDefault();
        void setFullscreen(!settings.fullscreen);
      }
    };
    window.addEventListener("keydown", handleFullscreenShortcut);
    return () => window.removeEventListener("keydown", handleFullscreenShortcut);
  }, [setFullscreen, settings.fullscreen]);

  useEffect(() => {
    if (!persistence || startup.kind !== "ready") return;
    const commitLifecycle = () => {
      persistBoundary("lifecycle", settings, progress);
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") commitLifecycle();
    };
    window.addEventListener("pagehide", commitLifecycle);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", commitLifecycle);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [persistence, persistBoundary, progress, settings, startup.kind]);

  useEffect(() => {
    const handleBack = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (screen === "practice" || screen === "tournament-table") return;
      if (tournamentResult) {
        setTournamentResult(null);
        setScreen("tour");
        return;
      }
      if (screen === "tour") {
        setScreen("play");
      } else if (screen === "timed-setup") {
        setScreen("play");
      } else if (screen !== "home") {
        setScreen("home");
      }
    };
    window.addEventListener("keydown", handleBack);
    return () => window.removeEventListener("keydown", handleBack);
  }, [screen, tournamentResult]);

  const navigate = (nextScreen: DesktopScreen) => {
    setScreen(nextScreen);
    gameAudio.play("click");
  };

  // First play requires the one-time interactive play-chip acknowledgment.
  const enterPlay = () => {
    if (needsPlayChipAcknowledgment(progress)) {
      setScreen("chip-ack");
      gameAudio.play("click");
      return;
    }
    navigate("play");
  };

  const openCredits = (from: DesktopScreen) => {
    setCreditsReturn(from);
    setScreen("credits");
    gameAudio.play("click");
  };

  const finishRunner = useCallback(
    (nextRunner: TournamentRunner) => {
      const replay = createTournamentRunnerReplay(nextRunner, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
      setRunner(nextRunner);
      const result = nextRunner.session.result;
      if (!result) return;
      setLastPublicReplay(replay as unknown as Record<string, unknown>);
      // A finished career event updates the persisted track inside the same
      // progress object that gets written to disk, and clears the active
      // event so mode entry advances instead of resuming what just finished.
      const nextProgress: PlayerProgress = {
        ...progress,
        tournamentElo: Math.max(
          100,
          progress.tournamentElo + result.tournamentEloDelta,
        ),
        career:
          nextRunner.kind === "career"
            ? careerWithCompletedEvent(
                progress.career,
                nextRunner.session.mode,
                result,
              )
            : progress.career,
      };
      setProgress(nextProgress);
      persistBoundary(
        "result",
        settings,
        nextProgress,
        replay as unknown as Record<string, unknown>,
      );
      gameAudio.play(tournamentResultAudioCue(result));
      setTournamentResult(result);
    },
    [persistBoundary, progress, settings],
  );

  const startCareerEvent = useCallback(
    (eventId: string) => {
      setActiveAllInReveal(undefined);
      // Mark the event active before play begins, so quitting or crashing
      // mid-event resumes it rather than losing which event was underway.
      const startedProgress: PlayerProgress = {
        ...progress,
        career: careerWithActiveEvent(progress.career, tourMode, eventId),
      };
      setProgress(startedProgress);
      const created = createCareerTournamentRunner({
        eventId,
        hero: {
          id: "hero",
          name: progress.playerName,
          rating: progress.tournamentElo,
        },
        mode: tourMode,
        // The isolated packaged scene audit supplies a complete engine seed so
        // its ordinary UI actions can deterministically expose every public
        // board street. Normal sessions retain their career-scoped seed.
        seed: window.desktop?.sceneAuditSeed ?? `career:${eventId}:${Date.now()}`,
        careerResults: tourResults[tourMode],
      });
      const opening = advanceTournamentRunnerOneStep(created, {
        policy: { simulations: 60 },
      });
      const ready = opening.runner;
      const replay = createTournamentRunnerReplay(ready, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
      const openingPresentation: PendingTournamentPresentation = {
        source: created,
        next: ready,
        events: opening.events,
        index: 0,
      };
      pendingPresentationRef.current = openingPresentation;
      setPendingPresentation(openingPresentation);
      setRunner(ready);
      setScreen("room-transition");
      persistBoundary(
        "action",
        settings,
        startedProgress,
        replay as unknown as Record<string, unknown>,
      );
      gameAudio.play("deal");
    },
    [persistBoundary, progress, settings, tourMode, tourResults],
  );

  const startTimedTable = useCallback(
    (minutes: number) => {
      setActiveAllInReveal(undefined);
      const created = createTimedTournamentRunner({
        minutes,
        hero: {
          id: "hero",
          name: progress.playerName,
          rating: progress.tournamentElo,
        },
        seed: `timed:${minutes}:${Date.now()}`,
      });
      const opening = advanceTournamentRunnerOneStep(created, {
        policy: { simulations: 60 },
      });
      const ready = opening.runner;
      const replay = createTournamentRunnerReplay(ready, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
      const openingPresentation: PendingTournamentPresentation = {
        source: created,
        next: ready,
        events: opening.events,
        index: 0,
      };
      pendingPresentationRef.current = openingPresentation;
      setPendingPresentation(openingPresentation);
      setTimedMinutes(minutes);
      setRunner(ready);
      setScreen("room-transition");
      persistBoundary(
        "action",
        settings,
        progress,
        replay as unknown as Record<string, unknown>,
      );
      gameAudio.play("deal");
    },
    [persistBoundary, progress, settings],
  );

  const commitTournamentAdvance = useCallback(
    (previous: TournamentRunner, next: TournamentRunner) => {
      const nextHandId = next.session.activeHand?.handId;
      // A legal all-in reveal is public only for its own hand. Keeping it out
      // of the runner prevents it from leaking into autosaves/replays while
      // still allowing the cards to remain on the table through every queued
      // board-card presentation event.
      setActiveAllInReveal((current) =>
        current?.handId === nextHandId ? current : undefined,
      );
      const replay = createTournamentRunnerReplay(next, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
      finishRunner(next);
      if (!next.session.result) {
        const previousHandId = previous.session.activeHand?.handId;
        const nextHandId = next.session.activeHand?.handId;
        persistBoundary(
          previousHandId !== nextHandId ? "hand" : "action",
          settings,
          progress,
          replay as unknown as Record<string, unknown>,
        );
      }
    },
    [finishRunner, persistBoundary, progress, settings],
  );

  const publishTournamentPresentation = useCallback(
    (source: TournamentRunner, transition: TournamentPresentationStep) => {
      if (transition.runner === source && transition.events.length === 0) {
        return;
      }
      if (transition.events.length === 0) {
        commitTournamentAdvance(source, transition.runner);
        return;
      }
      const legalReveal = transition.events.find(
        (event): event is AllInRevealPresentation => event.kind === "all-in-reveal",
      );
      if (legalReveal) setActiveAllInReveal(legalReveal);
      const next: PendingTournamentPresentation = {
        source,
        next: transition.runner,
        events: transition.events,
        index: 0,
      };
      pendingPresentationRef.current = next;
      setPendingPresentation(next);
    },
    [commitTournamentAdvance],
  );

  const completeTournamentPresentationEvent = useCallback(() => {
    const pending = pendingPresentationRef.current;
    if (!pending) return;
    if (pending.index + 1 < pending.events.length) {
      const next = { ...pending, index: pending.index + 1 };
      pendingPresentationRef.current = next;
      setPendingPresentation(next);
      return;
    }
    pendingPresentationRef.current = null;
    setPendingPresentation(null);
    commitTournamentAdvance(pending.source, pending.next);
  }, [commitTournamentAdvance]);

  const skipTournamentPresentation = useCallback(() => {
    const pending = pendingPresentationRef.current;
    if (!pending || pending.skipResultVisible) return;
    // Skipping is a presentation-only operation. Resume authoritative play
    // from the already-computed current transition, then use the retained
    // synchronous run-to-hero path to reach the exact state the event queue
    // would otherwise have produced without replaying a submitted action.
    const fastForwarded = advanceTournamentRunnerToHero(pending.next, {
      policy: { simulations: 60 },
    });
    const skippedHandId = pending.events[pending.index]?.handId;
    const skippedEvent = pending.events[pending.index];
    const result = fastForwarded.session.lastHand;
    if (result && result.handId === skippedHandId) {
      // Keep one public, card-safe result beat on screen. The engine has
      // already progressed deterministically, but committing it waits until
      // this event has been readable so the next hand cannot replace a win.
      const resultBeat: PendingTournamentPresentation = {
        source: pending.source,
        next: fastForwarded,
        events: [
          {
            id: `skip:${result.handId}:hand-result`,
            kind: "hand-result",
            handId: result.handId,
            awards: result.awards.map((award) => ({
              potId: award.potId,
              playerId: award.playerId,
              amount: award.amount,
              ...(award.hand ? { hand: award.hand } : {}),
            })),
          },
        ],
        index: 0,
        skipResultVisible: true,
        skipTerminalFoldedPlayerIds: skippedEvent?.kind === "action" && skippedEvent.command.type === "fold"
          ? [skippedEvent.playerId]
          : undefined,
      };
      pendingPresentationRef.current = resultBeat;
      setPendingPresentation(resultBeat);
      return;
    }
    pendingPresentationRef.current = null;
    setPendingPresentation(null);
    commitTournamentAdvance(pending.source, fastForwarded);
  }, [commitTournamentAdvance]);

  const advanceTournamentPresentation = useCallback(() => {
    const source = runnerRef.current;
    if (
      !source ||
      source.session.status === "complete" ||
      heroTournamentLegalActions(source) ||
      pendingPresentationRef.current ||
      presentationAdvancePendingRef.current
    ) {
      return;
    }
    presentationAdvancePendingRef.current = true;
    const settle = (transition: TournamentPresentationStep) => {
      if (runnerRef.current === source) {
        publishTournamentPresentation(source, transition);
      }
    };
    if (source.session.mode === "rational") {
      equityServiceRef.current ??= createDesktopEquityService();
      const service = equityServiceRef.current;
      service.cancelPending();
      const signal = { aborted: false };
      decisionAbortRef.current = signal;
      void advanceTournamentRunnerOneStepAsync(source, service.estimate, {
        policy: { simulations: 60 },
        signal,
      })
        .then((transition) => {
          if (!signal.aborted) settle(transition);
        })
        .catch((error) => {
          if (
            signal.aborted ||
            error instanceof TournamentAdvanceAborted ||
            error instanceof CancelledEquityRequestError ||
            error instanceof StaleEquityRequestError
          ) {
            return;
          }
          settle(
            advanceTournamentRunnerOneStep(source, {
              policy: { simulations: 60 },
            }),
          );
        })
        .finally(() => {
          presentationAdvancePendingRef.current = false;
        });
      return;
    }
    try {
      settle(
        advanceTournamentRunnerOneStep(source, {
          policy: { simulations: 60 },
        }),
      );
    } finally {
      presentationAdvancePendingRef.current = false;
    }
  }, [publishTournamentPresentation]);

  const actInTournament = useCallback(
    (request: HeroTournamentAction) => {
      if (!runner) return;
      if (decisionPendingRef.current || pendingPresentationRef.current) return;
      decisionPendingRef.current = true;
      try {
        publishTournamentPresentation(
          runner,
          applyHeroTournamentActionOneStep(runner, request, {
            policy: { simulations: 60 },
          }),
        );
      } finally {
        decisionPendingRef.current = false;
      }
    },
    [publishTournamentPresentation, runner],
  );

  useEffect(() => {
    runnerRef.current = runner;
  }, [runner]);

  // The renderer receives one public milestone at a time. It requests the
  // next engine transition only after the prior event has been presented, so
  // opponents can never collapse into a single invisible state update.
  useEffect(() => {
    if (
      screen !== "tournament-table" ||
      !runner ||
      runner.session.status === "complete" ||
      pendingPresentation
    ) {
      return;
    }
    if (heroTournamentLegalActions(runner)) return;
    advanceTournamentPresentation();
  }, [advanceTournamentPresentation, pendingPresentation, runner, screen]);

  useEffect(
    () => () => {
      if (decisionAbortRef.current) decisionAbortRef.current.aborted = true;
      equityServiceRef.current?.dispose();
      equityServiceRef.current = null;
    },
    [],
  );

  const handleTournamentPause = useCallback(
    (isPaused: boolean) => {
      const nowMs = Date.now();
      if (isPaused) {
        // A hidden/minimized table must not keep running Rational equity work
        // in the background. The runner is intentionally left untouched, so
        // resume returns to the exact same hero decision rather than silently
        // applying an action that completed off-screen.
        if (decisionAbortRef.current) decisionAbortRef.current.aborted = true;
        equityServiceRef.current?.cancelPending();
        tournamentPausedAtRef.current ??= nowMs;
        return;
      }
      const pausedAt = tournamentPausedAtRef.current;
      tournamentPausedAtRef.current = null;
      if (pausedAt === null) return;
      const inactiveMs = Math.max(0, nowMs - pausedAt);
      if (inactiveMs === 0) return;
      setRunner((current) => {
        if (!current?.timed) return current;
        const adjusted: TournamentRunner = {
          ...current,
          timed: {
            ...current.timed,
            startedAtMs: current.timed.startedAtMs + inactiveMs,
          },
        };
        const replay = createTournamentRunnerReplay(adjusted, 60);
        activeReplayRef.current = replay as unknown as Record<string, unknown>;
        persistBoundary(
          "action",
          settings,
          progress,
          replay as unknown as Record<string, unknown>,
        );
        return adjusted;
      });
    },
    [persistBoundary, progress, settings],
  );

  const beginTraining = useCallback(() => {
    const scenario = selectTrainingSessionStartScenario(
      progress.playerName,
      progress.results.map((result) => result.scenarioId),
      trainingScenarios,
      {
        decisionElo: progress.decisionElo,
        mathElo: progress.mathElo,
      },
    ) ?? trainingScenario;
    setTrainingScenario(scenario);
    const checkpoint = createTrainingCheckpoint(scenario.id);
    activeReplayRef.current = checkpoint;
    setTrainingPresentation(checkpoint.presentation);
    persistBoundary("action", settings, progress, checkpoint);
    void PokerTable.preload();
    setScreen("practice");
    gameAudio.play("deal");
  }, [persistBoundary, progress, settings, trainingScenario]);

  const advanceTrainingScenario = useCallback(
    (scenarioId: string) => {
      const completedScenarioIds = progress.results.map(
        (result) => result.scenarioId,
      );
      const next =
        selectNearTransferScenario(scenarioId, {
          completedScenarioIds,
          recentScenarioIds: [...completedScenarioIds, scenarioId],
          decisionElo: progress.decisionElo,
          mathElo: progress.mathElo,
        }) ??
        trainingScenarios[0];
      const checkpoint = createTrainingCheckpoint(next.id);
      activeReplayRef.current = checkpoint;
      setTrainingPresentation(checkpoint.presentation);
      setTrainingScenario(next);
      persistBoundary("action", settings, progress, checkpoint);
      gameAudio.play("deal");
  },
    [persistBoundary, progress, progress.results, settings],
  );

  const updateTrainingPresentation = useCallback(
    (presentation: TrainingPresentationCheckpoint) => {
      const checkpoint = createTrainingCheckpoint(trainingScenario.id, presentation);
      activeReplayRef.current = checkpoint;
      // A newly paused table is a durable boundary: preserve its exact frozen
      // clock before the user can close, suspend, or background the app.
      if (presentation.paused) {
        persistBoundary("lifecycle", settings, progress, checkpoint);
      }
    },
    [persistBoundary, progress, settings, trainingScenario.id],
  );

  if ((persistence && startup.kind === "loading") || !safeModeReady) {
    return (
      <main className="startup-gate" aria-live="polite">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">{formatMessage("shell.productName")}</p>
          <h1>{formatMessage("shell.loading.title")}</h1>
          <p>{formatMessage("shell.loading.detail")}</p>
        </section>
      </main>
    );
  }

  if (safeMode?.active && !safeModeAcknowledged) {
    return (
      <main className="startup-gate" aria-labelledby="safe-mode-title">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">{formatMessage("shell.safeMode.eyebrow")}</p>
          <h1 id="safe-mode-title">{formatMessage("shell.safeMode.title")}</h1>
          <p>{formatMessage("shell.safeMode.description")}</p>
          <p>
            {formatMessage(
              safeMode.recoveryMarkerRecovered
                ? "shell.safeMode.recoveryCountRepaired"
                : "shell.safeMode.recoveryCountValid",
              { failureCount: safeMode.failureCount },
            )}
          </p>
          <div className="startup-gate__actions">
            <button
              type="button"
              onClick={() => setSafeModeAcknowledged(true)}
            >
              {formatMessage("shell.safeMode.continueButton")}
            </button>
            <button
              type="button"
              onClick={() => void persistence?.exportDiagnostics()}
            >
              {formatMessage("shell.action.exportDiagnostics")}
            </button>
            <button type="button" onClick={() => void window.desktop?.quit()}>
              {formatMessage("shell.action.quitSafely")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (persistence && startup.kind === "import-ready") {
    const { candidate } = startup;
    return (
      <main className="startup-gate" aria-labelledby="import-title">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">{formatMessage("shell.import.eyebrow")}</p>
          <h1 id="import-title">{formatMessage("shell.import.title")}</h1>
          <p>
            {formatMessage("shell.import.summary", {
              playerName: candidate.preview.playerName,
              trainingCompleted: candidate.preview.trainingCompleted,
              resultCount: candidate.preview.resultCount,
            })}
          </p>
          {startupError ? (
            <p className="startup-gate__error" role="alert">
              {startupError}
            </p>
          ) : null}
          <div className="startup-gate__actions">
            <button
              type="button"
              onClick={() => {
                setStartupError(undefined);
                void persistence.confirmBrowserImport(candidate).then((result) => {
                  if (!result.ok) {
                    setStartupError(result.error.message);
                    return;
                  }
                  const ready = result.value;
                  if (ready.kind !== "ready") return;
                  setSettings(ready.save.data.settings);
                  setProgress(ready.save.data.progress);
                  setStartup(ready);
                });
              }}
            >
              {formatMessage("shell.import.importButton")}
            </button>
            <button
              type="button"
              onClick={() => {
                setStartupError(undefined);
                void persistence
                  .startFresh(defaultSettings, defaultProgress)
                  .then((result) => {
                    if (!result.ok) {
                      setStartupError(result.error.message);
                      return;
                    }
                    setSettings(defaultSettings);
                    setProgress(defaultProgress);
                    setStartup({
                      kind: "ready",
                      save: createSaveEnvelope(
                        defaultSettings,
                        defaultProgress,
                      ),
                      source: "current",
                      receipt: result.value,
                      warnings: [],
                    });
                  });
              }}
            >
              {formatMessage("recovery.action.startFresh")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (persistence && startup.kind === "recovery") {
    return (
      <RecoveryScreen
        message={startup.failure.message}
        recommended={startup.recommended}
        actions={{
          restore: (source) => persistence.restore(source),
          exportSave: (source) => persistence.exportSave(source),
          exportDiagnostics: () => persistence.exportDiagnostics(),
          startFresh: () =>
            persistence.startFresh(defaultSettings, defaultProgress),
          cancel: () => void window.desktop?.quit(),
        }}
        onRecovered={() => void loadAuthoritativeStartup()}
      />
    );
  }

  if (saveFailure) {
    return (
      <main className="startup-gate" aria-labelledby="save-failure-title">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">{formatMessage("shell.saveFailure.eyebrow")}</p>
          <h1 id="save-failure-title">{formatMessage("shell.saveFailure.title")}</h1>
          <p>{saveFailure}</p>
          <p>{formatMessage("shell.saveFailure.detail")}</p>
          <div className="startup-gate__actions">
            <button
              type="button"
              onClick={() => {
                if (!persistence) return;
                void persistence.retryPendingCommit().then((result) => {
                  if (result.ok) setSaveFailure(undefined);
                  else setSaveFailure(result.error.message);
                });
              }}
            >
              {formatMessage("shell.saveFailure.retryButton")}
            </button>
            <button
              type="button"
              onClick={() => void persistence?.exportDiagnostics()}
            >
              {formatMessage("shell.action.exportDiagnostics")}
            </button>
            <button type="button" onClick={() => void window.desktop?.quit()}>
              {formatMessage("shell.action.quitSafely")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!progress.onboardingCompleted) {
    return (
      <FirstRunSetup
        initialSettings={effectiveSettings}
        onComplete={(nextSettings) => {
          const nextProgress = {
            ...progress,
            onboardingCompleted: true,
          };
          setSettings(nextSettings);
          setProgress(nextProgress);
          gameAudio.setMasterVolume(nextSettings.masterVolume);
          gameAudio.setMuted(nextSettings.muted);
          gameAudio.setMusicVolume(nextSettings.musicVolume);
          gameAudio.setEffectsVolume(nextSettings.effectsVolume);
          persistBoundary("settings", nextSettings, nextProgress);
        }}
      />
    );
  }

  if (resumeCandidate) {
    return (
      <main className="startup-gate" aria-labelledby="resume-title">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">{formatMessage("shell.resumeTournament.eyebrow")}</p>
          <h1 id="resume-title">{formatMessage("shell.resumeTournament.title")}</h1>
          <p>
            {formatMessage("shell.resumeTournament.summary", {
              eventName: resumeCandidate.session.event.name,
              handNumber:
                resumeCandidate.session.tournament.tables[0]?.handNumber ?? 1,
            })}
          </p>
          {startupError ? (
            <p className="startup-gate__error" role="alert">{startupError}</p>
          ) : null}
          <div className="startup-gate__actions">
            <button
              type="button"
              onClick={() => {
                setRunner(resumeCandidate);
                setResumeCandidate(null);
                setScreen("tournament-table");
              }}
            >
              {formatMessage("shell.resumeTournament.resumeButton")}
            </button>
            <button
              type="button"
              onClick={() => {
                activeReplayRef.current = undefined;
                setResumeCandidate(null);
                persistBoundary("lifecycle", settings, progress);
              }}
            >
              {formatMessage("shell.resumeTournament.abandonButton")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (trainingResumeScenarioId) {
    const scenario = trainingScenarios.find(
      (candidate) => candidate.id === trainingResumeScenarioId,
    );
    return (
      <main className="startup-gate" aria-labelledby="resume-training-title">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">{formatMessage("shell.resumeTraining.eyebrow")}</p>
          <h1 id="resume-training-title">{formatMessage("shell.resumeTraining.title")}</h1>
          <p>
            {formatMessage("shell.resumeTraining.summary", {
              scenarioTitle:
                scenario?.title ??
                formatMessage("shell.resumeTraining.fallbackScenarioTitle"),
            })}
          </p>
          <div className="startup-gate__actions">
            <button
              type="button"
              onClick={() => {
                setTrainingResumeScenarioId(null);
                void PokerTable.preload();
                setScreen("practice");
              }}
            >
              {formatMessage("shell.resumeTraining.resumeButton")}
            </button>
            <button
              type="button"
              onClick={() => {
                activeReplayRef.current = undefined;
                setTrainingResumeScenarioId(null);
                persistBoundary("lifecycle", settings, progress);
              }}
            >
              {formatMessage("shell.resumeTraining.abandonButton")}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "practice") {
    return (
      <Suspense
        fallback={
          <SceneLoadingFallback
            label={formatMessage("shell.loading.trainingTable")}
            onCancel={() => setScreen("play")}
          />
        }
      >
        <PokerTable
          key={trainingScenario.id}
          mode="training"
          scenario={trainingScenario}
          settings={effectiveSettings}
          progress={progress}
          onProgressChange={updateProgress}
          onSettingsChange={updateSettings}
          initialTrainingPresentation={trainingPresentation}
          onTrainingPresentationChange={updateTrainingPresentation}
          onNextScenario={advanceTrainingScenario}
          onExit={() => {
            activeReplayRef.current = undefined;
            persistBoundary("lifecycle", settings, progress);
            setScreen("home");
          }}
        />
      </Suspense>
    );
  }

  if (screen === "tutorial") {
    return (
      <Suspense
        fallback={
          <SceneLoadingFallback
            label={formatMessage("shell.loading.tutorial")}
            onCancel={() => setScreen("play")}
          />
        }
      >
        <PlayableTutorial onExit={() => setScreen("play")} />
      </Suspense>
    );
  }

  if (screen === "career-travel" && travelLeg) {
    const stops = listTournamentSessionEvents(tourResults[tourMode]).map(
      (event) => ({
        id: event.id,
        name: event.name,
        tier: event.tier,
        cleared: Boolean(
          tourResults[tourMode].find(
            (result) => result.eventId === event.id && result.qualified,
          ),
        ),
      }),
    );
    // Skipping and completing land in the same place: the next event begins
    // either way, so a player who never wants the sequence loses nothing but
    // the seconds.
    const arrive = () => {
      const toEventId = travelLeg.toEventId;
      setTravelLeg(null);
      startCareerEvent(toEventId);
    };
    return (
      <Suspense
        fallback={
          <SceneLoadingFallback
            label={formatMessage("shell.loading.enteringEvent", {
              eventName:
                stops.find((stop) => stop.id === travelLeg.toEventId)?.name ??
                travelLeg.toEventId,
            })}
            onCancel={() => {
              setTravelLeg(null);
              setScreen("tour");
            }}
          />
        }
      >
        <CareerTravel
          route={stops}
          fromEventId={travelLeg.fromEventId}
          toEventId={travelLeg.toEventId}
          settings={effectiveSettings}
          onComplete={arrive}
        />
      </Suspense>
    );
  }

  if (screen === "room-transition" && runner) {
    // Start fetching the table chunk as the fly-through begins, not when it
    // ends. The arrival is 4.3 s of authored motion; spending it downloading
    // the thing the player is walking towards is the whole point of having it
    // (E09-004: "loading is hidden behind the authored transition").
    void PokerTable.preload();
    return (
      <Suspense
        fallback={
          <SceneLoadingFallback
            label={formatMessage("shell.loading.enteringEvent", {
              eventName: runner.session.event.name,
            })}
            onCancel={() => {
              activeReplayRef.current = undefined;
              setRunner(null);
              setScreen(runner.kind === "timed" ? "timed-setup" : "tour");
            }}
          />
        }
      >
        <RoomFlythrough
          eventName={runner.session.event.name}
          tier={runner.session.event.tier}
          modeLabel={
            runner.kind === "timed"
              ? formatMessage("modes.timed.name")
              : runner.session.mode === "rational"
                ? formatMessage("table.modeTitle.rational")
                : formatMessage("modes.normalTour")
          }
          settings={effectiveSettings}
          onComplete={() => {
            arrivingFromFlythrough.current = true;
            setScreen("tournament-table");
          }}
        />
      </Suspense>
    );
  }

  if (screen === "tournament-table" && runner && !tournamentResult) {
    const legalActions = heroTournamentLegalActions(runner);
    const snapshot = runner.session.activeHand
      ? createPokerTableSnapshot(runner.session)
      : lastTournamentSnapshotRef.current;
    if (!snapshot) {
      throw new Error("Tournament presentation has no table snapshot");
    }
    if (runner.session.activeHand) lastTournamentSnapshotRef.current = snapshot;
    const spectatorLegalActions = {
      playerId: runner.session.heroId,
      toCall: 0,
      check: false,
      fold: false,
      call: false,
      callAmount: 0,
      allIn: false,
      allInTo: 0,
      raisingReopened: false,
    };
    const handNumber = runner.session.tournament.tables[0]?.handNumber ?? 1;
    const handPresentationKey = `${runner.session.id}:${handNumber}`;
    const showArrival =
      (handNumber > 1 || arrivingFromFlythrough.current) &&
      lastPresentedHand.current !== handPresentationKey;
    lastPresentedHand.current = handPresentationKey;
    arrivingFromFlythrough.current = false;
    const presentationEvent = pendingPresentation?.events[pendingPresentation.index];
    return (
      <Suspense
        fallback={
          <SceneLoadingFallback
            label={formatMessage("shell.loading.tournamentTable")}
            onCancel={() => {
              activeReplayRef.current = undefined;
              persistBoundary("lifecycle", settings, progress);
              setRunner(null);
              setScreen(runner.kind === "timed" ? "timed-setup" : "tour");
            }}
          />
        }
      >
        <PokerTable
        mode={runner.session.mode}
        scenario={snapshot}
        settings={effectiveSettings}
        progress={progress}
        onProgressChange={updateProgress}
        onSettingsChange={updateSettings}
        onPauseChange={handleTournamentPause}
        onNextScenario={() => undefined}
        onExit={() => {
          activeReplayRef.current = undefined;
          persistBoundary("lifecycle", settings, progress);
          setRunner(null);
          setScreen(runner.kind === "timed" ? "timed-setup" : "tour");
        }}
        tournament={{
          legalActions: legalActions ?? spectatorLegalActions,
          onAction: actInTournament,
          heroDecision: Boolean(legalActions),
          presentationEvent,
          skipTerminalFoldedPlayerIds: pendingPresentation?.skipTerminalFoldedPlayerIds,
          allInReveal: activeAllInReveal,
          onPresentationEventComplete: completeTournamentPresentationEvent,
          onSkipPresentation: skipTournamentPresentation,
          kind: runner.kind,
          roundId: runner.session.id,
          sceneStateVersion: runner.sequence,
          handNumber,
          fieldSize: runner.session.entrants.length,
          playersRemaining: runner.session.tournament.players.filter(
            (player) => player.status === "active",
          ).length,
          /*
            The blind schedule, made inspectable (E27-004 / E27-008). The clock
            was corrected but never shown, so a player had no way to see when
            the level would turn -- or to notice if it turned early.
          */
          blindLevel: runner.session.tournament.levelIndex + 1,
          nextLevelInMs: Math.max(
            0,
            (runner.session.tournament.structure.levels[
              runner.session.tournament.levelIndex
            ]?.durationMs ?? 0) - runner.session.tournament.levelElapsedMs,
          ),
          elapsedMs:
            runner.kind === "timed" && runner.timed
              ? Math.max(0, Date.now() - runner.timed.startedAtMs)
              : runner.session.tournament.totalElapsedMs,
          ...(runner.timed
            ? { durationMs: runner.timed.durationMinutes * 60_000 }
            : {}),
          actionHistory: runner.decisions.slice(-12).map((decision) => {
            const name =
              runner.session.tournament.players.find(
                (player) => player.id === decision.playerId,
              )?.name ?? decision.playerId;
            const amount =
              decision.command.to === undefined
                ? ""
                : ` to ${formatChips(decision.command.to)}`;
            return `${name}: ${decision.command.type}${amount}`;
          }),
          showArrival,
          tier: runner.session.event.tier,
          lastPotWinnerIds: Array.from(
            new Set(
              (runner.session.lastHand?.awards ?? []).map(
                (award) => award.playerId,
              ),
            ),
          ),
          lastPotAwards: (runner.session.lastHand?.awards ?? []).map(
            (award) => ({
              potId: award.potId,
              playerId: award.playerId,
              amount: award.amount,
              ...(award.hand ? { hand: award.hand } : {}),
            }),
          ),
          lastHandHadSidePot: Boolean(
            runner.session.lastHand?.pots.some((pot) => pot.kind === "side"),
          ),
          openingBigBlind:
            runner.session.tournament.structure.levels[0]?.bigBlind,
          qualifyingPlaces: runner.session.event.qualifyingPlaces,
        }}
        />
      </Suspense>
    );
  }

  // Review sits in front of the ceremony so Back returns to it rather than
  // dropping the player out to the menu mid-flow.
  if (screen === "reference") {
    return (
      <main
        className="night-shell reference-shell"
        aria-labelledby="reference-title"
        {...localeTextAttributes()}
      >
        <NightCircuitScene quiet />
        <section className="reference-panel">
          <button className="night-back" type="button" onClick={() => navigate("play")}>
            <ArrowLeft size={18} /> {formatMessage("dashboard.nav.backToModes")}
          </button>
          <h1 id="reference-title">{formatMessage("reference.title")}</h1>
          <p className="reference-intro">{formatMessage("reference.intro")}</p>
          <TrainerOrientationContent />
          <h2 className="reference-heading">{formatMessage("reference.pokerHeading")}</h2>
          <PokerReferenceContent />
        </section>
      </main>
    );
  }

  if (screen === "hand-review") {
    const reviewable = asTournamentReplay(
      lastPublicReplay ?? activeReplayRef.current,
    );
    // Leaving review returns to whatever was underneath: the ceremony if the
    // event just ended (that branch renders on `tournamentResult`, not on
    // `screen`), otherwise the menu.
    if (reviewable) {
      return (
        <Suspense
          fallback={
            <SceneLoadingFallback
              label={formatMessage("review.deriving")}
              onCancel={() => setScreen("home")}
            />
          }
        >
          <HandReviewScreen
            replay={reviewable}
            onBack={() => setScreen("home")}
            onReviewed={(totals) => {
              // Only the rolling totals persist; the annotations behind them
              // are re-derivable from the replay and are not stored.
              const previous = progress.reviewTotals ?? {
                roundsReviewed: 0,
                decisions: 0,
                bestDecisions: 0,
                totalRegretBigBlinds: 0,
              };
              const nextProgress: PlayerProgress = {
                ...progress,
                reviewTotals: {
                  roundsReviewed: previous.roundsReviewed + 1,
                  decisions: previous.decisions + totals.decisions,
                  bestDecisions: previous.bestDecisions + totals.bestDecisions,
                  totalRegretBigBlinds:
                    previous.totalRegretBigBlinds + totals.totalRegretBigBlinds,
                },
              };
              setProgress(nextProgress);
              persistBoundary("result", settings, nextProgress);
            }}
          />
        </Suspense>
      );
    }
  }

  if (tournamentResult) {
    const completedReplay = lastPublicReplay ?? activeReplayRef.current;
    return (
      <TournamentCeremony
        result={tournamentResult}
        {...(persistence && completedReplay && replayExportEnabled
          ? {
              /*
                Replay export is a support and diagnostics workflow, not a
                player feature (E27-011). "Export event replay" sat on the
                ceremony beside Next event and Review, offering an ordinary
                player a raw JSON file they have no use for.
              */
              onExportReplay: async () => {
                const result =
                  await persistence.exportPublicReplay(completedReplay);
                return result.ok
                  ? {
                      ok: true as const,
                      ...(result.value.fileName
                        ? { fileName: result.value.fileName }
                        : {}),
                    }
                  : { ok: false as const, message: result.error.message };
              },
            }
          : {})}
        {...(completedReplay
          ? {
              onReview: () => {
                setScreen("hand-review");
                gameAudio.play("click");
              },
            }
          : {})}
        onMenu={() => {
          // Keep the completed-event replay through ordinary navigation and
          // restart. Starting another event replaces it at that new safe
          // boundary; only an explicit reset/import removes it.
          persistBoundary("lifecycle", settings, progress);
          setTournamentResult(null);
          setRunner(null);
          setScreen("home");
        }}
        onNext={
          tournamentResult.nextEventId
            ? () => {
                persistBoundary("lifecycle", settings, progress);
                // The next event's scenes are what the travel sequence is
                // buying time for, so start fetching them now.
                void RoomFlythrough.preload();
                void PokerTable.preload();
                setTravelLeg({
                  fromEventId: tournamentResult.eventId,
                  toEventId: tournamentResult.nextEventId!,
                });
                setTournamentResult(null);
                setRunner(null);
                setScreen("career-travel");
              }
            : undefined
        }
      />
    );
  }

  if (screen === "chip-ack") {
    return (
      <PlayChipAcknowledgment
        onAcknowledge={() => {
          const nextProgress = acknowledgePlayChips(progress);
          setProgress(nextProgress);
          persistBoundary("settings", settings, nextProgress);
          navigate("play");
        }}
        onBack={() => navigate("home")}
      />
    );
  }

  if (screen === "credits") {
    return <CreditsScreen onBack={() => navigate(creditsReturn)} />;
  }

  if (screen === "play") {
    return (
      <ModeSelect
        onBack={() => navigate("home")}
        onSelect={(mode) => {
          if (mode === "tutorial") {
            void PlayableTutorial.preload();
            setScreen("tutorial");
            gameAudio.play("deal");
          } else if (mode === "reference") {
            setScreen("reference");
            gameAudio.play("click");
          } else if (mode === "training") {
            beginTraining();
          } else if (mode === "timed") {
            // Next likely scenes after setup: the room fly-through, then table.
            void RoomFlythrough.preload();
            void PokerTable.preload();
            navigate("timed-setup");
          } else {
            void RoomFlythrough.preload();
            void PokerTable.preload();
            setTourMode(mode);
            navigate("tour");
          }
        }}
      />
    );
  }

  if (screen === "timed-setup") {
    return (
      <TimedSetup
        initialMinutes={timedMinutes}
        onBack={() => navigate("play")}
        onStart={(minutes) => {
          startTimedTable(minutes);
        }}
      />
    );
  }

  if (screen === "tour") {
    return (
      <TourLobby
        key={tourMode}
        mode={tourMode}
        careerResults={tourResults[tourMode]}
        activeEventId={progress.career?.[tourMode].activeEventId}
        onBack={() => navigate("play")}
        onStartEvent={startCareerEvent}
      />
    );
  }

  if (screen === "settings") {
    return (
      <SettingsPanel
        settings={osResolvedSettings}
        onBack={() => navigate("home")}
        onChange={updateSettings}
        onFullscreenChange={(fullscreen) => void setFullscreen(fullscreen)}
        dataControls={
          persistence ? (
            <SaveDataControls
              persistence={persistence}
              replay={activeReplayRef.current ?? lastPublicReplay}
              onAuthoritativeDataChanged={async () => {
                activeReplayRef.current = undefined;
                setLastPublicReplay(undefined);
                setResumeCandidate(null);
                setRunner(null);
                setTournamentResult(null);
                await loadAuthoritativeStartup();
              }}
            />
          ) : undefined
        }
        about={
          <AboutSupport
            onOpenCredits={() => openCredits("settings")}
            onExportDiagnostics={
              persistence
                ? async () => {
                    const result = await persistence.exportDiagnostics();
                    return result.ok
                      ? {
                          ok: true,
                          message: result.value.fileName
                            ? formatMessage("saveData.diagnostics.successNamed", {
                                fileName: result.value.fileName,
                              })
                            : formatMessage("saveData.diagnostics.success"),
                        }
                      : { ok: false, message: result.error.message };
                  }
                : undefined
            }
          />
        }
      />
    );
  }

  if (screen === "profile") {
    return (
      <PlayerRecord progress={progress} onBack={() => navigate("home")} />
    );
  }

  return (
    <HomeView
      onPlay={enterPlay}
      onSettings={() => navigate("settings")}
      onCredits={() => openCredits("home")}
    />
  );
}
