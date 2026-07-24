import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Keyboard, Gamepad2, RotateCcw } from "lucide-react";
import {
  ACTION_DEFINITIONS,
  describeGamepadToken,
  describeKeyToken,
  detectConflicts,
  detectReservedWarnings,
  emptyOverrides,
  getActionDefinition,
  isReservedKeyToken,
  keyEventToken,
  resetDeviceToDefaults,
  resolveBindings,
  setBinding,
  type ActionCategory,
  type ActionId,
  type ControlBindingOverrides,
  type DeviceKind,
} from "../lib/actionMap";
import {
  createGamepadPollState,
  readGamepadIntents,
  snapshotGamepads,
} from "../lib/gamepad";
import {
  setInputCaptureActive,
} from "../lib/inputCaptureGate";
import { useModalFocusTrap } from "../hooks/useModalFocusTrap";
import { formatMessage } from "../lib/localeMessages";

const CATEGORY_LABEL_KEYS: Record<ActionCategory, string> = {
  menu: "controls.category.menu",
  gameplay: "controls.category.gameplay",
  camera: "controls.category.camera",
  speed: "controls.category.speed",
  system: "controls.category.system",
};

const CATEGORY_ORDER: ActionCategory[] = [
  "gameplay",
  "camera",
  "speed",
  "menu",
  "system",
];

interface CaptureState {
  actionId: ActionId;
  device: DeviceKind;
}

function describeToken(device: DeviceKind, token: string): string {
  return device === "keyboard"
    ? describeKeyToken(token)
    : describeGamepadToken(token);
}

/** Modal that listens for the next key or controller button for one action. */
function CaptureDialog({
  capture,
  onCapture,
  onCancel,
}: {
  capture: CaptureState;
  onCapture: (tokens: string[]) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [reservedNotice, setReservedNotice] = useState<string | null>(null);
  useModalFocusTrap({
    active: true,
    containerRef: dialogRef,
    initialFocusRef: cancelRef,
  });

  const definition = getActionDefinition(capture.actionId);

  // Raise the global input-capture gate so poker hotkeys and menu shortcuts are
  // suppressed while this dialog owns input.
  useEffect(() => {
    setInputCaptureActive(true);
    return () => setInputCaptureActive(false);
  }, []);

  // Keyboard capture.
  useEffect(() => {
    if (capture.device !== "keyboard") return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const token = keyEventToken(event);
      if (token === "escape") {
        onCancel();
        return;
      }
      if (isReservedKeyToken(token)) {
        setReservedNotice(
          formatMessage("controls.capture.reservedNotice", {
            keyName: describeKeyToken(token),
          }),
        );
        return;
      }
      onCapture([token]);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [capture.device, onCancel, onCapture]);

  // Controller capture (own poll loop; the shared nav loop is gated off).
  useEffect(() => {
    if (capture.device !== "gamepad") return;
    if (typeof navigator === "undefined" || !("getGamepads" in navigator)) {
      return;
    }
    const state = createGamepadPollState();
    let raf = 0;
    const poll = () => {
      const snapshot = snapshotGamepads(
        () => Array.from(navigator.getGamepads?.() ?? []),
        performance.now(),
      );
      if (snapshot) {
        const intents = readGamepadIntents(state, snapshot);
        const pressed = intents.find((intent) => intent.buttonToken);
        if (pressed?.buttonToken) {
          onCapture([pressed.buttonToken]);
          return;
        }
      }
      raf = window.requestAnimationFrame(poll);
    };
    raf = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(raf);
  }, [capture.device, onCapture]);

  return (
    <div className="remap-capture-scrim" role="presentation">
      <section
        className="remap-capture"
        role="dialog"
        aria-modal="true"
        aria-labelledby="remap-capture-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <p className="eyebrow">{formatMessage("controls.capture.eyebrow")}</p>
        <h2 id="remap-capture-title">
          {formatMessage("controls.capture.title", {
            inputKind: formatMessage(
              capture.device === "keyboard"
                ? "controls.capture.inputKind.key"
                : "controls.capture.inputKind.controllerButton",
            ),
            actionLabel: definition.label,
          })}
        </h2>
        <p>
          {formatMessage(
            capture.device === "keyboard"
              ? "controls.capture.instructionsKeyboard"
              : "controls.capture.instructionsGamepad",
          )}
        </p>
        {reservedNotice ? (
          <p className="remap-capture__warning" role="alert">
            <AlertTriangle size={15} /> {reservedNotice}
          </p>
        ) : null}
        <button type="button" ref={cancelRef} onClick={onCancel}>
          {formatMessage("common.cancel")}
        </button>
      </section>
    </div>
  );
}

export interface ControlsRemapPanelProps {
  controlBindings?: ControlBindingOverrides;
  onChange: (next: ControlBindingOverrides) => void;
  /** Optional Back/close control shown in the panel header. */
  onClose?: () => void;
}

/**
 * In-game remapping for every gameplay and menu control. Provides per-device
 * capture, conflict detection, reserved-key warnings, and Reset to Defaults per
 * device. Bindings are lifted to the caller which persists them through the
 * durable settings path.
 */
export function ControlsRemapPanel({
  controlBindings,
  onChange,
  onClose,
}: ControlsRemapPanelProps) {
  const [device, setDevice] = useState<DeviceKind>("keyboard");
  const [capture, setCapture] = useState<CaptureState | null>(null);

  const overrides = controlBindings ?? emptyOverrides();
  const resolved = useMemo(() => resolveBindings(overrides), [overrides]);
  const conflicts = useMemo(
    () => detectConflicts(resolved, device),
    [resolved, device],
  );
  const reservedWarnings = useMemo(
    () => detectReservedWarnings(resolved),
    [resolved],
  );

  const conflictByAction = useMemo(() => {
    const map = new Map<ActionId, string>();
    for (const conflict of conflicts) {
      for (const actionId of conflict.actions) {
        map.set(actionId, conflict.token);
      }
    }
    return map;
  }, [conflicts]);

  const reservedByAction = useMemo(() => {
    const map = new Map<ActionId, string>();
    for (const warning of reservedWarnings) {
      map.set(warning.actionId, warning.token);
    }
    return map;
  }, [reservedWarnings]);

  const grouped = useMemo(() => {
    const byCategory = new Map<ActionCategory, typeof ACTION_DEFINITIONS[number][]>();
    for (const definition of ACTION_DEFINITIONS) {
      const list = byCategory.get(definition.category) ?? [];
      list.push(definition);
      byCategory.set(definition.category, list);
    }
    return CATEGORY_ORDER.map((category) => ({
      category,
      actions: byCategory.get(category) ?? [],
    })).filter((group) => group.actions.length > 0);
  }, []);

  return (
    <section className="controls-remap" aria-label={formatMessage("controls.panel.ariaLabel")}>
      <header className="controls-remap__header">
        {onClose ? (
          <button
            className="controls-remap__back"
            type="button"
            onClick={onClose}
          >
            {formatMessage("common.back")}
          </button>
        ) : null}
        <div
          className="controls-remap__tabs"
          role="tablist"
          aria-label={formatMessage("controls.tabs.ariaLabel")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={device === "keyboard"}
            className={device === "keyboard" ? "is-active" : ""}
            onClick={() => setDevice("keyboard")}
          >
            <Keyboard size={16} /> {formatMessage("controls.device.keyboard")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={device === "gamepad"}
            className={device === "gamepad" ? "is-active" : ""}
            onClick={() => setDevice("gamepad")}
          >
            <Gamepad2 size={16} /> {formatMessage("controls.device.controller")}
          </button>
        </div>
        <button
          className="controls-remap__reset"
          type="button"
          onClick={() => onChange(resetDeviceToDefaults(overrides, device))}
        >
          <RotateCcw size={15} />{" "}
          {formatMessage("controls.reset.button", { device })}
        </button>
      </header>

      {conflicts.length > 0 ? (
        <p className="controls-remap__alert" role="alert">
          <AlertTriangle size={15} />{" "}
          {formatMessage("controls.conflict.alert", { device })}
        </p>
      ) : null}

      {grouped.map((group) => (
        <div className="controls-remap__group" key={group.category}>
          <h3>{formatMessage(CATEGORY_LABEL_KEYS[group.category])}</h3>
          <ul>
            {group.actions.map((definition) => {
              const tokens = resolved[definition.id][device];
              const hasConflict = conflictByAction.has(definition.id);
              const reservedToken =
                device === "keyboard"
                  ? reservedByAction.get(definition.id)
                  : undefined;
              return (
                <li key={definition.id}>
                  <span className="controls-remap__label">
                    {definition.label}
                    <small>{definition.pointerHint}</small>
                  </span>
                  <span className="controls-remap__binding">
                    {tokens.length > 0 ? (
                      tokens.map((token) => (
                        <kbd
                          key={token}
                          className={hasConflict ? "is-conflict" : ""}
                        >
                          {describeToken(device, token)}
                        </kbd>
                      ))
                    ) : (
                      <em>{formatMessage("controls.action.unbound")}</em>
                    )}
                    {reservedToken ? (
                      <span
                        className="controls-remap__reserved"
                        title={formatMessage("controls.reserved.title")}
                      >
                        <AlertTriangle size={13} />{" "}
                        {formatMessage("controls.reserved.label")}
                      </span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    aria-label={formatMessage("controls.action.rebindAriaLabel", {
                      actionLabel: definition.label,
                      device,
                    })}
                    onClick={() =>
                      setCapture({ actionId: definition.id, device })
                    }
                  >
                    {formatMessage("controls.action.rebindButton")}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {capture ? (
        <CaptureDialog
          capture={capture}
          onCancel={() => setCapture(null)}
          onCapture={(tokens) => {
            onChange(
              setBinding(overrides, capture.device, capture.actionId, tokens),
            );
            setCapture(null);
          }}
        />
      ) : null}
    </section>
  );
}
