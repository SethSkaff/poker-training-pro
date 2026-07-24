import { type ReactNode, useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { previewSettingsEffect } from "../lib/audioPreview";
import { defaultSettings } from "../lib/storage";
import { formatMessage, localeTextAttributes } from "../lib/localeMessages";
import type { GameSettings } from "../types/poker";
import { NightCircuitScene } from "./Dashboard";
import { ControlsRemapPanel } from "./ControlsRemapPanel";
import { useIsGamepadActive } from "./GamepadNavigationProvider";

interface SettingsPanelProps {
  settings: GameSettings;
  onBack: () => void;
  onChange: (settings: GameSettings) => void;
  onFullscreenChange: (fullscreen: boolean) => void;
  dataControls?: ReactNode;
  about?: ReactNode;
}

interface ToggleRowProps {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function ToggleRow({
  checked,
  description,
  label,
  onChange,
}: ToggleRowProps) {
  return (
    <label className="night-setting night-setting--toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

interface VolumeRowProps {
  description: string;
  id: string;
  label: string;
  previewDisabled?: boolean;
  previewLabel: string;
  value: number;
  onChange: (value: number) => void;
  onTest: () => void;
}

function VolumeRow({
  description,
  id,
  label,
  previewDisabled = false,
  previewLabel,
  value,
  onChange,
  onTest,
}: VolumeRowProps) {
  return (
    <div className="night-setting night-setting--volume">
      <span>
        <label htmlFor={id}><strong>{label}</strong></label>
        <small id={`${id}-description`}>{description}</small>
        <small id={`${id}-value`}>{value}%</small>
      </span>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        value={value}
        aria-label={formatMessage("settings.audio.volumeAriaLabel", { label })}
        aria-describedby={`${id}-description ${id}-value`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <button
        type="button"
        disabled={previewDisabled}
        aria-label={previewLabel}
        aria-describedby="audio-preview-status"
        onClick={onTest}
      >
        {formatMessage(
          previewDisabled
            ? "settings.audio.buttonUnavailable"
            : "settings.audio.buttonPreview",
        )}
      </button>
    </div>
  );
}

const motionChoices = [
  ["full", "settings.motion.choice.full"],
  ["reduced", "settings.motion.choice.reduced"],
  ["off", "settings.motion.choice.off"],
] as const;

function MotionControl({
  description,
  id,
  label,
  value,
  onChange,
}: {
  description: string;
  id: string;
  label: string;
  value: GameSettings["menuMotion"];
  onChange: (value: GameSettings["menuMotion"]) => void;
}) {
  return (
    <div className="night-motion-control">
      <p className="night-setting__hint" id={id}>
        <strong>{label}</strong><br />
        {description}
      </p>
      <div className="night-speed" role="group" aria-labelledby={id}>
        {motionChoices.map(([nextValue, nextLabelKey]) => (
          <button
            key={nextValue}
            type="button"
            className={value === nextValue ? "is-selected" : ""}
            aria-pressed={value === nextValue}
            onClick={() => onChange(nextValue)}
          >
            {formatMessage(nextLabelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsPanel({
  settings,
  onBack,
  onChange,
  onFullscreenChange,
  dataControls,
  about,
}: SettingsPanelProps) {
  const gamepadActive = useIsGamepadActive();
  const [previewStatus, setPreviewStatus] = useState(() =>
    formatMessage("settings.audio.previewStatusDefault"),
  );
  const patchSettings = (patch: Partial<GameSettings>) =>
    onChange({ ...settings, ...patch });
  const preview = (channel: "master" | "effects") => {
    const feedback = previewSettingsEffect(settings, channel);
    setPreviewStatus(feedback.message);
  };

  return (
    <main className="night-shell night-shell--overlay" {...localeTextAttributes()}>
      <NightCircuitScene quiet />
      <section className="night-settings">
        <header>
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> {formatMessage("settings.header.backToMainMenu")}
          </button>
          <p className="night-section-label">
            {formatMessage("settings.header.sectionLabel")}
          </p>
          <h1>{formatMessage("common.settings")}</h1>
          {gamepadActive ? (
            <p className="controller-hint" role="note">
              {formatMessage("settings.header.controllerHint")}
            </p>
          ) : null}
        </header>

        <div className="night-settings__group">
          <h2>{formatMessage("settings.audio.heading")}</h2>
          <ToggleRow
            label={formatMessage("settings.audio.muteAll.label")}
            description={formatMessage("settings.audio.muteAll.description")}
            checked={settings.muted}
            onChange={(muted) => patchSettings({ muted })}
          />
          <VolumeRow
            id="master-volume"
            label={formatMessage("settings.audio.master.label")}
            description={formatMessage("settings.audio.master.description")}
            value={settings.masterVolume}
            onChange={(masterVolume) => patchSettings({ masterVolume })}
            previewLabel={formatMessage("settings.audio.master.previewLabel", {
              percent: settings.masterVolume,
            })}
            onTest={() => preview("master")}
          />
          <VolumeRow
            id="music-volume"
            label={formatMessage("settings.audio.music.label")}
            description={formatMessage("settings.audio.music.description")}
            value={settings.musicVolume}
            onChange={(musicVolume) => patchSettings({ musicVolume })}
            previewDisabled
            previewLabel={formatMessage("settings.audio.music.previewUnavailableLabel")}
            onTest={() => undefined}
          />
          <VolumeRow
            id="effects-volume"
            label={formatMessage("settings.audio.effects.label")}
            description={formatMessage("settings.audio.effects.description")}
            value={settings.effectsVolume}
            onChange={(effectsVolume) => patchSettings({ effectsVolume })}
            previewLabel={formatMessage("settings.audio.effects.previewLabel", {
              percent: settings.effectsVolume,
            })}
            onTest={() => preview("effects")}
          />
          <p
            id="audio-preview-status"
            className="night-audio-preview-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {previewStatus}
          </p>
        </div>

        <div className="night-settings__group">
          <h2>{formatMessage("settings.display.heading")}</h2>
          <ToggleRow
            label={formatMessage("settings.display.fullscreen.label")}
            description={formatMessage("settings.display.fullscreen.description")}
            checked={settings.fullscreen}
            onChange={(fullscreen) => onFullscreenChange(fullscreen)}
          />
          <ToggleRow
            label={formatMessage("settings.display.reduceMotion.label")}
            description={formatMessage("settings.display.reduceMotion.description")}
            checked={settings.reducedMotion}
            onChange={(reducedMotion) =>
              // A Settings toggle is always an explicit choice: it now wins
              // over the OS reduced-motion preference until changed again.
              patchSettings({ reducedMotion, reducedMotionExplicit: true })
            }
          />
          <ToggleRow
            label={formatMessage("settings.display.highContrast.label")}
            description={formatMessage("settings.display.highContrast.description")}
            checked={settings.colorAssist}
            onChange={(colorAssist) => patchSettings({ colorAssist })}
          />
          <p className="night-setting__hint" id="interface-scale-heading">
            {formatMessage("settings.display.interfaceScale.heading")}
          </p>
          <div
            className="night-speed"
            role="group"
            aria-labelledby="interface-scale-heading"
          >
            {(
              [
                ["compact", "settings.display.interfaceScale.compact"],
                ["standard", "settings.display.interfaceScale.standard"],
                ["large", "settings.display.interfaceScale.large"],
                ["extra-large", "settings.display.interfaceScale.extraLarge"],
              ] as const
            ).map(([value, labelKey]) => (
              <button
                key={value}
                type="button"
                className={settings.interfaceScale === value ? "is-selected" : ""}
                aria-pressed={settings.interfaceScale === value}
                onClick={() => patchSettings({ interfaceScale: value })}
              >
                {formatMessage(labelKey)}
              </button>
            ))}
          </div>
          <p className="night-setting__hint">
            {formatMessage("settings.display.interfaceScale.hint")}
          </p>
        </div>

        <div className="night-settings__group">
          <h2 id="deal-speed-heading">{formatMessage("settings.dealSpeed.heading")}</h2>
          <div
            className="night-speed"
            role="group"
            aria-labelledby="deal-speed-heading"
          >
            {(["cinematic", "standard", "quick"] as const).map((speed) => (
              <button
                key={speed}
                type="button"
                className={settings.dealSpeed === speed ? "is-selected" : ""}
                aria-pressed={settings.dealSpeed === speed}
                onClick={() => patchSettings({ dealSpeed: speed })}
              >
                {speed}
              </button>
            ))}
          </div>
        </div>

        <div className="night-settings__group">
          <h2>{formatMessage("settings.camera.heading")}</h2>
          <ToggleRow
            label={formatMessage("settings.camera.autoMovement.label")}
            description={formatMessage("settings.camera.autoMovement.description")}
            checked={settings.autoCameraMovement}
            onChange={(autoCameraMovement) =>
              patchSettings({ autoCameraMovement })
            }
          />
          <p className="night-setting__hint" id="camera-sensitivity-heading">
            {formatMessage("settings.camera.sensitivity.heading")}
          </p>
          <div
            className="night-speed"
            role="group"
            aria-labelledby="camera-sensitivity-heading"
          >
            {(["low", "standard", "high"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={
                  settings.cameraSensitivity === value ? "is-selected" : ""
                }
                aria-pressed={settings.cameraSensitivity === value}
                onClick={() => patchSettings({ cameraSensitivity: value })}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="night-setting__hint" id="camera-view-heading">
            {formatMessage("settings.camera.view.heading")}
          </p>
          <div
            className="night-speed"
            role="group"
            aria-labelledby="camera-view-heading"
          >
            {(["close", "standard", "wide"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={settings.cameraView === value ? "is-selected" : ""}
                aria-pressed={settings.cameraView === value}
                onClick={() => patchSettings({ cameraView: value })}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="night-settings__group">
          <h2>{formatMessage("settings.motion.heading")}</h2>
          <p className="night-setting__hint">
            {formatMessage("settings.motion.hint")}
          </p>
          <MotionControl
            id="menu-motion-heading"
            label={formatMessage("settings.motion.menu.label")}
            description={formatMessage("settings.motion.menu.description")}
            value={settings.menuMotion}
            onChange={(menuMotion) => patchSettings({ menuMotion })}
          />
          <MotionControl
            id="room-motion-heading"
            label={formatMessage("settings.motion.room.label")}
            description={formatMessage("settings.motion.room.description")}
            value={settings.roomMotion}
            onChange={(roomMotion) => patchSettings({ roomMotion })}
          />
          <MotionControl
            id="camera-motion-heading"
            label={formatMessage("settings.motion.camera.label")}
            description={formatMessage("settings.motion.camera.description")}
            value={settings.cameraMotion}
            onChange={(cameraMotion) => patchSettings({ cameraMotion })}
          />
          <MotionControl
            id="table-motion-heading"
            label={formatMessage("settings.motion.table.label")}
            description={formatMessage("settings.motion.table.description")}
            value={settings.tableMotion}
            onChange={(tableMotion) => patchSettings({ tableMotion })}
          />
          <MotionControl
            id="transition-motion-heading"
            label={formatMessage("settings.motion.transition.label")}
            description={formatMessage("settings.motion.transition.description")}
            value={settings.transitionMotion}
            onChange={(transitionMotion) => patchSettings({ transitionMotion })}
          />
        </div>

        <div className="night-settings__group">
          <h2>{formatMessage("settings.controls.heading")}</h2>
          <p className="night-setting__hint">
            {formatMessage("settings.controls.hint")}
          </p>
          <ControlsRemapPanel
            controlBindings={settings.controlBindings}
            onChange={(controlBindings) => patchSettings({ controlBindings })}
          />
        </div>

        {dataControls}

        {about}

        <button
          className="night-reset"
          type="button"
          onClick={() => {
            onChange(defaultSettings);
            onFullscreenChange(defaultSettings.fullscreen);
          }}
        >
          <RotateCcw size={15} /> {formatMessage("settings.footer.resetDefaults")}
        </button>
      </section>
    </main>
  );
}
