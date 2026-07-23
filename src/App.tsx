import { useCallback, useEffect, useRef, useState } from "react";
import {
  HomeView,
  ModeSelect,
  PlayerRecord,
  TimedSetup,
  TournamentCeremony,
  TourLobby,
} from "./components/Dashboard";
import { PokerTable } from "./components/PokerTable";
import { PlayableTutorial } from "./components/PlayableTutorial";
import { RecoveryScreen } from "./components/RecoveryScreen";
import { RoomFlythrough } from "./components/RoomFlythrough";
import { SaveDataControls } from "./components/SaveDataControls";
import { SettingsPanel } from "./components/SettingsPanel";
import { trainingScenarios } from "./data/trainingScenarios";
import { gameAudio } from "./lib/audio";
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
import { createSaveEnvelope } from "./lib/saveMigration";
import { selectNearTransferScenario } from "./lib/trainingEngine";
import {
  advanceTournamentRunnerToHero,
  applyHeroTournamentAction,
  createCareerTournamentRunner,
  createTimedTournamentRunner,
  createTournamentRunnerReplay,
  heroTournamentLegalActions,
  restoreTournamentRunnerReplay,
  type HeroTournamentAction,
  type TournamentRunner,
  type TournamentRunnerReplay,
} from "./modes/tournamentRunner";
import type {
  TournamentPolicyMode,
  TournamentSessionCareerResult,
  TournamentSessionResult,
} from "./modes/tournamentSession";
import { createPokerTableSnapshot } from "./modes/tournamentSession";
import type { GameSettings, PlayerProgress } from "./types/poker";

type DesktopScreen =
  | "home"
  | "play"
  | "tour"
  | "profile"
  | "settings"
  | "timed-setup"
  | "room-transition"
  | "tournament-table"
  | "practice"
  | "tutorial";

type SafeModeState = Awaited<
  ReturnType<NonNullable<Window["desktop"]>["getSafeModeState"]>
>;

const emptyTourResults: Record<
  TournamentPolicyMode,
  TournamentSessionCareerResult[]
> = {
  normal: [],
  rational: [],
};

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
  const patch = (next: Partial<GameSettings>) =>
    setDraft((current) => ({ ...current, ...next }));

  return (
    <main className="startup-gate" aria-labelledby="first-run-title">
      <section className="startup-gate__panel startup-gate__panel--wide">
        <p className="startup-gate__eyebrow">First-time setup</p>
        <h1 id="first-run-title">Make the table comfortable</h1>
        <p>
          Choose a quiet starting setup before camera motion or timed play begins.
          You can change every option later in Settings.
        </p>
        <div className="first-run-options">
          <label>
            <input
              type="checkbox"
              checked={draft.reducedMotion}
              onChange={(event) =>
                patch({ reducedMotion: event.target.checked })
              }
            />
            <span>
              <strong>Reduce motion</strong>
              <small>Replace room travel and card movement with calm fades.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.colorAssist}
              onChange={(event) => patch({ colorAssist: event.target.checked })}
            />
            <span>
              <strong>High contrast and four-color deck</strong>
              <small>Strengthen edges and distinguish suits without color alone.</small>
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.muted}
              onChange={(event) => patch({ muted: event.target.checked })}
            />
            <span>
              <strong>Start muted</strong>
              <small>All decisions remain fully readable without audio.</small>
            </span>
          </label>
          <fieldset>
            <legend>Deal speed</legend>
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
          Keyboard: arrow keys and Tab navigate menus; Space/Enter activate; F
          folds, C calls/checks, 2 raises double, R raises custom, and Esc pauses.
        </p>
        <div className="startup-gate__actions">
          <button type="button" onClick={() => onComplete(draft)}>
            Save and continue
          </button>
          <button type="button" onClick={() => onComplete(initialSettings)}>
            Skip setup
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
  const [tourMode, setTourMode] = useState<TournamentPolicyMode>("normal");
  const [timedMinutes, setTimedMinutes] = useState(30);
  const [runner, setRunner] = useState<TournamentRunner | null>(null);
  const [resumeCandidate, setResumeCandidate] = useState<TournamentRunner | null>(null);
  const activeReplayRef = useRef<Record<string, unknown> | undefined>(
    undefined,
  );
  const tournamentPausedAtRef = useRef<number | null>(null);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());
  const [progress, setProgress] = useState(() => loadProgress());
  const [tourResults, setTourResults] = useState(emptyTourResults);
  const [tournamentResult, setTournamentResult] =
    useState<TournamentSessionResult | null>(null);
  const [lastPublicReplay, setLastPublicReplay] =
    useState<Record<string, unknown>>();
  const [saveFailure, setSaveFailure] = useState<string>();
  const [startupError, setStartupError] = useState<string>();
  const [safeMode, setSafeMode] = useState<SafeModeState>();
  const [safeModeReady, setSafeModeReady] = useState(!window.desktop);
  const [safeModeAcknowledged, setSafeModeAcknowledged] = useState(false);
  const [trainingScenario, setTrainingScenario] = useState(
    () => trainingScenarios[0],
  );
  const lastPresentedHand = useRef<string | null>(null);
  const effectiveSettings: GameSettings = safeMode?.active
    ? {
        ...settings,
        muted: true,
        reducedMotion: true,
        dealSpeed: "quick",
      }
    : settings;

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
          if (restored.session.status === "playing") {
            activeReplayRef.current = loaded.replay;
            setResumeCandidate(restored);
          }
        } catch {
          setStartupError("The saved tournament checkpoint could not be replayed. Your ratings and training progress are still safe.");
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
  }, [
    effectiveSettings.colorAssist,
    effectiveSettings.effectsVolume,
    effectiveSettings.masterVolume,
    effectiveSettings.musicVolume,
    effectiveSettings.muted,
    effectiveSettings.reducedMotion,
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

  const finishRunner = useCallback(
    (nextRunner: TournamentRunner) => {
      const replay = createTournamentRunnerReplay(nextRunner, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
      setRunner(nextRunner);
      const result = nextRunner.session.result;
      if (!result) return;
      setLastPublicReplay(replay as unknown as Record<string, unknown>);
      const nextProgress = {
        ...progress,
        tournamentElo: Math.max(
          100,
          progress.tournamentElo + result.tournamentEloDelta,
        ),
      };
      setProgress(nextProgress);
      persistBoundary(
        "result",
        settings,
        nextProgress,
        replay as unknown as Record<string, unknown>,
      );
      if (nextRunner.kind === "career") {
        setTourResults((current) => ({
          ...current,
          [nextRunner.session.mode]: [
            ...current[nextRunner.session.mode].filter(
              (entry) => entry.eventId !== result.eventId,
            ),
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
        }));
      }
      setTournamentResult(result);
    },
    [persistBoundary, progress, settings],
  );

  const startCareerEvent = useCallback(
    (eventId: string) => {
      const created = createCareerTournamentRunner({
        eventId,
        hero: {
          id: "hero",
          name: progress.playerName,
          rating: progress.tournamentElo,
        },
        mode: tourMode,
        seed: `career:${eventId}:${Date.now()}`,
        careerResults: tourResults[tourMode],
      });
      const ready = advanceTournamentRunnerToHero(created, {
        policy: { simulations: 60 },
      });
      const replay = createTournamentRunnerReplay(ready, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
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
    [persistBoundary, progress, settings, tourMode, tourResults],
  );

  const startTimedTable = useCallback(
    (minutes: number) => {
      const created = createTimedTournamentRunner({
        minutes,
        hero: {
          id: "hero",
          name: progress.playerName,
          rating: progress.tournamentElo,
        },
        seed: `timed:${minutes}:${Date.now()}`,
      });
      const ready = advanceTournamentRunnerToHero(created, {
        policy: { simulations: 60 },
      });
      const replay = createTournamentRunnerReplay(ready, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
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

  const actInTournament = useCallback(
    (request: HeroTournamentAction) => {
      if (!runner) return;
      const next = applyHeroTournamentAction(runner, request, {
        policy: { simulations: 60 },
      });
      const replay = createTournamentRunnerReplay(next, 60);
      activeReplayRef.current = replay as unknown as Record<string, unknown>;
      finishRunner(next);
      if (!next.session.result) {
        const previousHandId = runner.session.activeHand?.handId;
        const nextHandId = next.session.activeHand?.handId;
        persistBoundary(
          previousHandId !== nextHandId ? "hand" : "action",
          settings,
          progress,
          replay as unknown as Record<string, unknown>,
        );
      }
    },
    [finishRunner, persistBoundary, progress, runner, settings],
  );

  const handleTournamentPause = useCallback(
    (isPaused: boolean) => {
      const nowMs = Date.now();
      if (isPaused) {
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

  const advanceTrainingScenario = useCallback(
    (scenarioId: string) => {
      const completedScenarioIds = progress.results.map(
        (result) => result.scenarioId,
      );
      const next =
        selectNearTransferScenario(scenarioId, { completedScenarioIds }) ??
        trainingScenarios[0];
      setTrainingScenario(next);
      gameAudio.play("deal");
    },
    [progress.results],
  );

  if ((persistence && startup.kind === "loading") || !safeModeReady) {
    return (
      <main className="startup-gate" aria-live="polite">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">Poker Training Pro</p>
          <h1>Loading your table…</h1>
          <p>Checking the protected desktop save journal.</p>
        </section>
      </main>
    );
  }

  if (safeMode?.active && !safeModeAcknowledged) {
    return (
      <main className="startup-gate" aria-labelledby="safe-mode-title">
        <section className="startup-gate__panel">
          <p className="startup-gate__eyebrow">Recovery launch</p>
          <h1 id="safe-mode-title">Safe mode is protecting this session</h1>
          <p>
            Poker Training Pro detected repeated startup or renderer failures.
            Hardware acceleration is disabled, animation is reduced, audio is
            muted, and quick dealing is forced for this launch. Your saved
            preferences and poker progress have not been replaced.
          </p>
          <p>
            Recovery count: {safeMode.failureCount}.{" "}
            {safeMode.recoveryMarkerRecovered
              ? "A damaged recovery marker was repaired."
              : "The recovery marker passed validation."}
          </p>
          <div className="startup-gate__actions">
            <button
              type="button"
              onClick={() => setSafeModeAcknowledged(true)}
            >
              Continue in safe mode
            </button>
            <button
              type="button"
              onClick={() => void persistence?.exportDiagnostics()}
            >
              Export diagnostics
            </button>
            <button type="button" onClick={() => void window.desktop?.quit()}>
              Quit safely
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
          <p className="startup-gate__eyebrow">Progress found</p>
          <h1 id="import-title">Bring your browser progress to desktop?</h1>
          <p>
            Player {candidate.preview.playerName} has completed{" "}
            {candidate.preview.trainingCompleted} training scenarios across{" "}
            {candidate.preview.resultCount} recorded results.
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
              Import progress
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
              Start fresh
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
          <p className="startup-gate__eyebrow">Save interrupted</p>
          <h1 id="save-failure-title">Your last move is paused</h1>
          <p>{saveFailure}</p>
          <p>
            Gameplay is blocked until the protected save succeeds, so your
            progress cannot silently diverge from disk.
          </p>
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
              Retry save
            </button>
            <button
              type="button"
              onClick={() => void persistence?.exportDiagnostics()}
            >
              Export diagnostics
            </button>
            <button type="button" onClick={() => void window.desktop?.quit()}>
              Quit safely
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
          <p className="startup-gate__eyebrow">Tournament checkpoint</p>
          <h1 id="resume-title">Return to your saved seat?</h1>
          <p>
            {resumeCandidate.session.event.name} is waiting at hand{" "}
            {resumeCandidate.session.tournament.tables[0]?.handNumber ?? 1}.
            The deck and decisions were reconstructed from the protected seed
            and public action log.
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
              Resume tournament
            </button>
            <button
              type="button"
              onClick={() => {
                activeReplayRef.current = undefined;
                setResumeCandidate(null);
                persistBoundary("lifecycle", settings, progress);
              }}
            >
              Abandon checkpoint and go to menu
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (screen === "practice") {
    return (
      <PokerTable
        key={trainingScenario.id}
        mode="training"
        scenario={trainingScenario}
        settings={effectiveSettings}
        progress={progress}
        onProgressChange={updateProgress}
        onSettingsChange={updateSettings}
        onNextScenario={advanceTrainingScenario}
        onExit={() => setScreen("home")}
      />
    );
  }

  if (screen === "tutorial") {
    return <PlayableTutorial onExit={() => setScreen("play")} />;
  }

  if (screen === "room-transition" && runner) {
    return (
      <RoomFlythrough
        eventName={runner.session.event.name}
        modeLabel={
          runner.kind === "timed"
            ? "Timed Table"
            : runner.session.mode === "rational"
              ? "Rational Circuit"
              : "Normal Tour"
        }
        settings={effectiveSettings}
        onComplete={() => setScreen("tournament-table")}
      />
    );
  }

  if (screen === "tournament-table" && runner && !tournamentResult) {
    const legalActions = heroTournamentLegalActions(runner);
    if (!legalActions) {
      throw new Error("Playable tournament table is not waiting for the hero");
    }
    const snapshot = createPokerTableSnapshot(runner.session);
    const handNumber = runner.session.tournament.tables[0]?.handNumber ?? 1;
    const handPresentationKey = `${runner.session.id}:${handNumber}`;
    const showArrival =
      handNumber > 1 && lastPresentedHand.current !== handPresentationKey;
    lastPresentedHand.current = handPresentationKey;
    return (
      <PokerTable
        key={[
          snapshot.id,
          snapshot.street,
          snapshot.pot,
          snapshot.amountToCall,
          runner.sequence,
          runner.session.activeHand?.betting.currentBet ?? 0,
          runner.session.activeHand?.betting.pending.join("-") ?? "",
        ].join(":")}
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
          legalActions,
          onAction: actInTournament,
          kind: runner.kind,
          handNumber,
          fieldSize: runner.session.entrants.length,
          playersRemaining: runner.session.tournament.players.filter(
            (player) => player.status === "active",
          ).length,
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
                : ` to ${decision.command.to.toLocaleString()}`;
            return `${name}: ${decision.command.type}${amount}`;
          }),
          showArrival,
        }}
      />
    );
  }

  if (tournamentResult) {
    return (
      <TournamentCeremony
        result={tournamentResult}
        onMenu={() => {
          activeReplayRef.current = undefined;
          persistBoundary("lifecycle", settings, progress);
          setTournamentResult(null);
          setRunner(null);
          setScreen("home");
        }}
        onNext={
          tournamentResult.nextEventId
              ? () => {
                activeReplayRef.current = undefined;
                persistBoundary("lifecycle", settings, progress);
                setTournamentResult(null);
                setRunner(null);
                setScreen("tour");
              }
            : undefined
        }
      />
    );
  }

  if (screen === "play") {
    return (
      <ModeSelect
        onBack={() => navigate("home")}
        onSelect={(mode) => {
          if (mode === "tutorial") {
            setScreen("tutorial");
            gameAudio.play("deal");
          } else if (mode === "training") {
            setScreen("practice");
            gameAudio.play("deal");
          } else if (mode === "timed") {
            navigate("timed-setup");
          } else {
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
        onBack={() => navigate("play")}
        onStartEvent={startCareerEvent}
      />
    );
  }

  if (screen === "settings") {
    return (
      <SettingsPanel
        settings={settings}
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
      onPlay={() => navigate("play")}
      onSettings={() => navigate("settings")}
    />
  );
}
