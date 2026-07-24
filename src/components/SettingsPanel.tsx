import { type ReactNode, useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { previewSettingsEffect } from "../lib/audioPreview";
import { defaultSettings } from "../lib/storage";
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
        aria-label={`${label} volume`}
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
        {previewDisabled ? "Unavailable" : "Preview"}
      </button>
    </div>
  );
}

const motionChoices = [
  ["full", "Full"],
  ["reduced", "Reduced"],
  ["off", "Off"],
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
        {motionChoices.map(([nextValue, nextLabel]) => (
          <button
            key={nextValue}
            type="button"
            className={value === nextValue ? "is-selected" : ""}
            aria-pressed={value === nextValue}
            onClick={() => onChange(nextValue)}
          >
            {nextLabel}
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
  const [previewStatus, setPreviewStatus] = useState(
    "Choose Preview to hear the saved Master or Table effects level.",
  );
  const patchSettings = (patch: Partial<GameSettings>) =>
    onChange({ ...settings, ...patch });
  const preview = (channel: "master" | "effects") => {
    const feedback = previewSettingsEffect(settings, channel);
    setPreviewStatus(feedback.message);
  };

  return (
    <main className="night-shell night-shell--overlay">
      <NightCircuitScene quiet />
      <section className="night-settings">
        <header>
          <button className="night-back" type="button" onClick={onBack}>
            <ArrowLeft size={18} /> Main menu
          </button>
          <p className="night-section-label">System</p>
          <h1>Settings</h1>
          {gamepadActive ? (
            <p className="controller-hint" role="note">
              Controller: D-pad move · A select · B back · D-pad ←/→ adjust
              sliders
            </p>
          ) : null}
        </header>

        <div className="night-settings__group">
          <h2>Audio</h2>
          <ToggleRow
            label="Mute all audio"
            description="Silence music and table effects without changing their levels."
            checked={settings.muted}
            onChange={(muted) => patchSettings({ muted })}
          />
          <VolumeRow
            id="master-volume"
            label="Master"
            description="Controls the combined level of all available game audio."
            value={settings.masterVolume}
            onChange={(masterVolume) => patchSettings({ masterVolume })}
            previewLabel={`Preview Master volume at ${settings.masterVolume} percent`}
            onTest={() => preview("master")}
          />
          <VolumeRow
            id="music-volume"
            label="Music"
            description="Preview unavailable — no approved licensed music masters are installed."
            value={settings.musicVolume}
            onChange={(musicVolume) => patchSettings({ musicVolume })}
            previewDisabled
            previewLabel="Music preview unavailable"
            onTest={() => undefined}
          />
          <VolumeRow
            id="effects-volume"
            label="Table effects"
            description="Controls card, chip, fold, and result cues."
            value={settings.effectsVolume}
            onChange={(effectsVolume) => patchSettings({ effectsVolume })}
            previewLabel={`Preview Table effects volume at ${settings.effectsVolume} percent`}
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
          <h2>Display</h2>
          <ToggleRow
            label="Fullscreen"
            description="Alt + Enter also changes display mode."
            checked={settings.fullscreen}
            onChange={(fullscreen) => onFullscreenChange(fullscreen)}
          />
          <ToggleRow
            label="Reduce motion"
            description="Use quiet fades instead of camera and object travel."
            checked={settings.reducedMotion}
            onChange={(reducedMotion) => patchSettings({ reducedMotion })}
          />
          <ToggleRow
            label="High contrast & four-color deck"
            description="Strengthen table edges and distinguish every suit."
            checked={settings.colorAssist}
            onChange={(colorAssist) => patchSettings({ colorAssist })}
          />
          <p className="night-setting__hint" id="interface-scale-heading">
            Interface size
          </p>
          <div
            className="night-speed"
            role="group"
            aria-labelledby="interface-scale-heading"
          >
            {(
              [
                ["compact", "Compact"],
                ["standard", "Standard"],
                ["large", "Large"],
                ["extra-large", "Extra large"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={settings.interfaceScale === value ? "is-selected" : ""}
                aria-pressed={settings.interfaceScale === value}
                onClick={() => patchSettings({ interfaceScale: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="night-setting__hint">
            Changes the size of menus, table labels, and action controls. You can
            scroll a larger interface; gameplay information is never hidden.
          </p>
        </div>

        <div className="night-settings__group">
          <h2 id="deal-speed-heading">Deal speed</h2>
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
          <h2>Table camera</h2>
          <ToggleRow
            label="Automatic camera movement"
            description="Play the room arrival and recenter your view at the start of a new hand."
            checked={settings.autoCameraMovement}
            onChange={(autoCameraMovement) =>
              patchSettings({ autoCameraMovement })
            }
          />
          <p className="night-setting__hint" id="camera-sensitivity-heading">
            Look sensitivity
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
            Table view
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
          <h2>Motion details</h2>
          <p className="night-setting__hint">
            Tune each surface independently. Reduce motion above remains a
            one-click safety override and temporarily stops every category.
          </p>
          <MotionControl
            id="menu-motion-heading"
            label="Menu background"
            description="Decorative title and selection movement."
            value={settings.menuMotion}
            onChange={(menuMotion) => patchSettings({ menuMotion })}
          />
          <MotionControl
            id="room-motion-heading"
            label="Room arrival"
            description="The championship-floor approach before a seat is shown."
            value={settings.roomMotion}
            onChange={(roomMotion) => patchSettings({ roomMotion })}
          />
          <MotionControl
            id="camera-motion-heading"
            label="Camera movement"
            description="Automatic recentering and the eased table-view response."
            value={settings.cameraMotion}
            onChange={(cameraMotion) => patchSettings({ cameraMotion })}
          />
          <MotionControl
            id="table-motion-heading"
            label="Card and chip flourish"
            description="Deal, fold, chip-push, and opponent thinking effects."
            value={settings.tableMotion}
            onChange={(tableMotion) => patchSettings({ tableMotion })}
          />
          <MotionControl
            id="transition-motion-heading"
            label="Screen transitions"
            description="Mode changes and the between-hand progress overlay."
            value={settings.transitionMotion}
            onChange={(transitionMotion) => patchSettings({ transitionMotion })}
          />
        </div>

        <div className="night-settings__group">
          <h2>Controls</h2>
          <p className="night-setting__hint">
            Rebind keyboard and controller actions. Conflicts and reserved
            system keys are flagged; reset either device to its defaults.
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
          <RotateCcw size={15} /> Reset defaults
        </button>
      </section>
    </main>
  );
}
