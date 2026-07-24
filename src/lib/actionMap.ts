/**
 * Shared action map for Poker Training Pro.
 *
 * A single versioned registry gives every menu, gameplay, camera, and speed
 * action a stable identifier with per-device default bindings (keyboard token,
 * gamepad button/axis token, and a pointer affordance hint). Mouse, keyboard,
 * and controller all resolve through this module so that every action has an
 * equivalent non-pointer operation and remapping is device-aware.
 *
 * The module is intentionally free of DOM/React dependencies: it is pure data
 * plus pure functions, so it can be unit-tested in the Node/Vitest bundle and
 * imported by both the desktop renderer and the iOS bundle.
 */

export const ACTION_MAP_VERSION = 1;

export type DeviceKind = "keyboard" | "gamepad";

/**
 * Actions live in one of two logical contexts. The same physical input (for
 * example the spacebar) may be bound to different actions in different
 * contexts without being a conflict: menu navigation and table gameplay are
 * never active at the same time.
 */
export type ActionContext = "menu" | "game";

export type ActionCategory =
  | "menu"
  | "gameplay"
  | "camera"
  | "speed"
  | "system";

export type MenuActionId =
  | "menu.up"
  | "menu.down"
  | "menu.left"
  | "menu.right"
  | "menu.activate"
  | "menu.back";

export type GameActionId =
  | "game.fold"
  | "game.checkCall"
  | "game.raiseCustom"
  | "game.raiseDouble"
  | "game.raiseTwoFive"
  | "game.raiseTriple"
  | "game.pot"
  | "game.allIn"
  | "game.peek"
  | "game.history"
  | "game.pause"
  | "camera.left"
  | "camera.right"
  | "camera.center"
  | "speed.down"
  | "speed.up";

export type ActionId = MenuActionId | GameActionId;

export interface ActionDefinition {
  id: ActionId;
  label: string;
  context: ActionContext;
  category: ActionCategory;
  /**
   * Whether the player may rebind this action. Every action is remappable, but
   * a few (Back/Pause) default to reserved keys and surface a warning when a
   * different action is bound onto those reserved keys.
   */
  remappable: boolean;
  defaults: {
    keyboard: string[];
    gamepad: string[];
  };
  /** Human-readable description of the pointer affordance for the same action. */
  pointerHint: string;
}

/**
 * Canonical registry. The keyboard defaults here reproduce the exact keys the
 * shipping build already used, so routing hotkeys through the map is a pure
 * refactor with no behavior change.
 */
export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  // ----- Menu / dialog navigation -----
  {
    id: "menu.up",
    label: "Move focus up",
    context: "menu",
    category: "menu",
    remappable: true,
    defaults: { keyboard: ["arrowup"], gamepad: ["button:12"] },
    pointerHint: "Move the cursor to the control above",
  },
  {
    id: "menu.down",
    label: "Move focus down",
    context: "menu",
    category: "menu",
    remappable: true,
    defaults: { keyboard: ["arrowdown"], gamepad: ["button:13"] },
    pointerHint: "Move the cursor to the control below",
  },
  {
    id: "menu.left",
    label: "Move focus left / decrease",
    context: "menu",
    category: "menu",
    remappable: true,
    defaults: { keyboard: ["arrowleft"], gamepad: ["button:14"] },
    pointerHint: "Drag a slider left or move to the previous control",
  },
  {
    id: "menu.right",
    label: "Move focus right / increase",
    context: "menu",
    category: "menu",
    remappable: true,
    defaults: { keyboard: ["arrowright"], gamepad: ["button:15"] },
    pointerHint: "Drag a slider right or move to the next control",
  },
  {
    id: "menu.activate",
    label: "Activate",
    context: "menu",
    category: "menu",
    remappable: true,
    defaults: { keyboard: ["enter", "space"], gamepad: ["button:0"] },
    pointerHint: "Click the focused control",
  },
  {
    id: "menu.back",
    label: "Back / close",
    context: "menu",
    category: "system",
    remappable: true,
    defaults: { keyboard: ["escape"], gamepad: ["button:1"] },
    pointerHint: "Click Back or the close control",
  },

  // ----- Gameplay actions (table context) -----
  {
    id: "game.fold",
    label: "Fold",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["f"], gamepad: ["button:2"] },
    pointerHint: "Click Fold, or drag the hole cards toward the dealer",
  },
  {
    id: "game.checkCall",
    label: "Check / Call",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["c"], gamepad: ["button:0"] },
    pointerHint: "Click Check / Call",
  },
  {
    id: "game.raiseCustom",
    label: "Custom raise",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["r"], gamepad: ["button:3"] },
    pointerHint: "Click Raise to open the bet composer",
  },
  {
    id: "game.raiseDouble",
    label: "Raise 2× big blind",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["2"], gamepad: [] },
    pointerHint: "Choose the 2× preset in the bet composer",
  },
  {
    id: "game.raiseTwoFive",
    label: "Raise 2.5× big blind",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["5"], gamepad: [] },
    pointerHint: "Choose the 2.5× preset in the bet composer",
  },
  {
    id: "game.raiseTriple",
    label: "Raise 3× big blind",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["3"], gamepad: [] },
    pointerHint: "Choose the 3× preset in the bet composer",
  },
  {
    id: "game.pot",
    label: "Pot-sized raise",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["p"], gamepad: [] },
    pointerHint: "Choose the pot preset in the bet composer",
  },
  {
    id: "game.allIn",
    label: "All-in",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["a"], gamepad: ["button:5"] },
    pointerHint: "Choose All-in in the bet composer",
  },
  {
    id: "game.peek",
    label: "Peek / hide cards",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["space"], gamepad: ["button:4"] },
    pointerHint: "Click the hole cards to peek or hide",
  },
  {
    id: "game.history",
    label: "Hand history",
    context: "game",
    category: "gameplay",
    remappable: true,
    defaults: { keyboard: ["h"], gamepad: ["button:9"] },
    pointerHint: "Click Prior action",
  },
  {
    id: "game.pause",
    label: "Pause",
    context: "game",
    category: "system",
    remappable: true,
    defaults: { keyboard: ["escape"], gamepad: ["button:8"] },
    pointerHint: "Click the pause control",
  },
  {
    id: "camera.left",
    label: "Look left",
    context: "game",
    category: "camera",
    remappable: true,
    defaults: { keyboard: ["q"], gamepad: ["button:14"] },
    pointerHint: "Click the look-left control",
  },
  {
    id: "camera.right",
    label: "Look right",
    context: "game",
    category: "camera",
    remappable: true,
    defaults: { keyboard: ["e"], gamepad: ["button:15"] },
    pointerHint: "Click the look-right control",
  },
  {
    id: "camera.center",
    label: "Recenter view",
    context: "game",
    category: "camera",
    remappable: true,
    defaults: { keyboard: ["x"], gamepad: ["button:13"] },
    pointerHint: "Click Table view to recenter",
  },
  {
    id: "speed.down",
    label: "Slow opponents down",
    context: "game",
    category: "speed",
    remappable: true,
    defaults: { keyboard: ["[", "-"], gamepad: ["button:6"] },
    pointerHint: "Lower the speed slider",
  },
  {
    id: "speed.up",
    label: "Speed opponents up",
    context: "game",
    category: "speed",
    remappable: true,
    defaults: { keyboard: ["]", "=", "+"], gamepad: ["button:7"] },
    pointerHint: "Raise the speed slider",
  },
] as const;

const DEFINITION_BY_ID = new Map<ActionId, ActionDefinition>(
  ACTION_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getActionDefinition(id: ActionId): ActionDefinition {
  const definition = DEFINITION_BY_ID.get(id);
  if (!definition) {
    throw new Error(`Unknown action id: ${id}`);
  }
  return definition;
}

export const ALL_ACTION_IDS: readonly ActionId[] = ACTION_DEFINITIONS.map(
  (definition) => definition.id,
);

/**
 * Reserved keyboard tokens. Binding an ordinary action onto one of these is
 * allowed but surfaces a warning, because these keys carry operating-system or
 * app-wide meaning (Escape closes/pauses, F11 toggles fullscreen, Tab moves
 * focus, and the bare modifier keys are not usable as sole bindings).
 */
export const RESERVED_KEY_TOKENS: ReadonlySet<string> = new Set([
  "escape",
  "tab",
  "f11",
  "meta",
  "control",
  "alt",
  "shift",
  "contextmenu",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f12",
]);

export function isReservedKeyToken(token: string): boolean {
  return RESERVED_KEY_TOKENS.has(token.toLowerCase());
}

/** Minimal shape of a keyboard event needed to derive a stable token. */
export interface KeyTokenSource {
  key: string;
  code?: string;
}

/**
 * Converts a keyboard event into a stable lowercase token. Space becomes the
 * word `space` (so it is legible in the remap UI and JSON), other single keys
 * are lowercased, and named keys keep their lowercase `key` name.
 */
export function keyEventToken(event: KeyTokenSource): string {
  const key = event.key;
  if (key === " " || key === "Spacebar" || event.code === "Space") {
    return "space";
  }
  return key.toLowerCase();
}

/** A human-readable label for a stored keyboard token, for the remap UI. */
export function describeKeyToken(token: string): string {
  if (token === "space") return "Space";
  if (token === "arrowup") return "↑";
  if (token === "arrowdown") return "↓";
  if (token === "arrowleft") return "←";
  if (token === "arrowright") return "→";
  if (token === "escape") return "Esc";
  if (token === "enter") return "Enter";
  if (token.length === 1) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/** A human-readable label for a stored gamepad token, for the remap UI. */
export function describeGamepadToken(token: string): string {
  const standardButtons: Record<string, string> = {
    "button:0": "A",
    "button:1": "B",
    "button:2": "X",
    "button:3": "Y",
    "button:4": "LB",
    "button:5": "RB",
    "button:6": "LT",
    "button:7": "RT",
    "button:8": "View",
    "button:9": "Menu",
    "button:10": "L-stick",
    "button:11": "R-stick",
    "button:12": "D-pad ↑",
    "button:13": "D-pad ↓",
    "button:14": "D-pad ←",
    "button:15": "D-pad →",
  };
  return standardButtons[token] ?? token;
}

// ---------------------------------------------------------------------------
// Persistable overrides
// ---------------------------------------------------------------------------

/**
 * Only the differences from defaults are persisted, keyed by device. Storing
 * overrides (not the full resolved map) keeps saves small and lets future
 * default changes reach players who never touched a given action.
 */
export interface ControlBindingOverrides {
  version: number;
  keyboard: Partial<Record<ActionId, string[]>>;
  gamepad: Partial<Record<ActionId, string[]>>;
}

export type ResolvedBindings = Record<
  ActionId,
  { keyboard: string[]; gamepad: string[] }
>;

export function emptyOverrides(): ControlBindingOverrides {
  return { version: ACTION_MAP_VERSION, keyboard: {}, gamepad: {} };
}

/** The default bindings for one device as a full action→tokens record. */
export function defaultBindingsForDevice(
  device: DeviceKind,
): Record<ActionId, string[]> {
  const result = {} as Record<ActionId, string[]>;
  for (const definition of ACTION_DEFINITIONS) {
    result[definition.id] = [...definition.defaults[device]];
  }
  return result;
}

/** Merge overrides onto defaults to produce the full resolved binding map. */
export function resolveBindings(
  overrides?: ControlBindingOverrides | null,
): ResolvedBindings {
  const result = {} as ResolvedBindings;
  for (const definition of ACTION_DEFINITIONS) {
    const keyboardOverride = overrides?.keyboard?.[definition.id];
    const gamepadOverride = overrides?.gamepad?.[definition.id];
    result[definition.id] = {
      keyboard: keyboardOverride
        ? [...keyboardOverride]
        : [...definition.defaults.keyboard],
      gamepad: gamepadOverride
        ? [...gamepadOverride]
        : [...definition.defaults.gamepad],
    };
  }
  return result;
}

function bindingsForDevice(
  resolved: ResolvedBindings,
  device: DeviceKind,
): Record<ActionId, string[]> {
  const result = {} as Record<ActionId, string[]>;
  for (const id of ALL_ACTION_IDS) {
    result[id] = resolved[id][device];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Resolve a physical token to the single action it should trigger in a context.
 * Menu and game contexts are searched independently so a token may map to
 * different actions in each. Returns the first matching action in registry
 * order (stable and deterministic).
 */
export function resolveAction(
  resolved: ResolvedBindings,
  device: DeviceKind,
  context: ActionContext,
  token: string,
): ActionId | null {
  const needle = token.toLowerCase();
  for (const definition of ACTION_DEFINITIONS) {
    if (definition.context !== context) continue;
    const tokens = resolved[definition.id][device];
    if (tokens.some((candidate) => candidate.toLowerCase() === needle)) {
      return definition.id;
    }
  }
  return null;
}

export function resolveKeyboardAction(
  resolved: ResolvedBindings,
  context: ActionContext,
  event: KeyTokenSource,
): ActionId | null {
  return resolveAction(resolved, "keyboard", context, keyEventToken(event));
}

export function resolveGamepadAction(
  resolved: ResolvedBindings,
  context: ActionContext,
  token: string,
): ActionId | null {
  return resolveAction(resolved, "gamepad", context, token);
}

// ---------------------------------------------------------------------------
// Conflict + reserved detection
// ---------------------------------------------------------------------------

export interface BindingConflict {
  device: DeviceKind;
  context: ActionContext;
  token: string;
  actions: ActionId[];
}

/**
 * Detect when the same token drives more than one action within the same
 * device and context. Cross-context reuse (menu vs game) is never a conflict.
 */
export function detectConflicts(
  resolved: ResolvedBindings,
  device: DeviceKind,
): BindingConflict[] {
  const byContextToken = new Map<string, ActionId[]>();
  for (const definition of ACTION_DEFINITIONS) {
    for (const token of resolved[definition.id][device]) {
      const composite = `${definition.context}:${token.toLowerCase()}`;
      const bucket = byContextToken.get(composite) ?? [];
      bucket.push(definition.id);
      byContextToken.set(composite, bucket);
    }
  }
  const conflicts: BindingConflict[] = [];
  for (const [composite, actions] of byContextToken) {
    if (actions.length < 2) continue;
    const separator = composite.indexOf(":");
    const context = composite.slice(0, separator) as ActionContext;
    const token = composite.slice(separator + 1);
    conflicts.push({ device, context, token, actions });
  }
  return conflicts;
}

/** Reserved-key warnings for a device's keyboard bindings. */
export interface ReservedWarning {
  actionId: ActionId;
  token: string;
}

export function detectReservedWarnings(
  resolved: ResolvedBindings,
): ReservedWarning[] {
  const warnings: ReservedWarning[] = [];
  for (const definition of ACTION_DEFINITIONS) {
    // Back/Pause intentionally default to Escape; do not warn about their own
    // reserved default, only about additional/foreign reserved bindings.
    const defaults = new Set(
      definition.defaults.keyboard.map((token) => token.toLowerCase()),
    );
    for (const token of resolved[definition.id].keyboard) {
      const lower = token.toLowerCase();
      if (isReservedKeyToken(lower) && !defaults.has(lower)) {
        warnings.push({ actionId: definition.id, token: lower });
      }
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Remap mutations (immutable)
// ---------------------------------------------------------------------------

function overrideMatchesDefault(
  device: DeviceKind,
  actionId: ActionId,
  tokens: string[],
): boolean {
  const defaults = getActionDefinition(actionId).defaults[device];
  if (defaults.length !== tokens.length) return false;
  return defaults.every((token, index) => token === tokens[index]);
}

/**
 * Set the bindings for one action on one device. When the requested tokens
 * equal the built-in default, the override is dropped so the action keeps
 * tracking future default changes.
 */
export function setBinding(
  overrides: ControlBindingOverrides | null | undefined,
  device: DeviceKind,
  actionId: ActionId,
  tokens: string[],
): ControlBindingOverrides {
  const base = normalizeControlBindingOverrides(overrides) ?? emptyOverrides();
  const next: ControlBindingOverrides = {
    version: ACTION_MAP_VERSION,
    keyboard: { ...base.keyboard },
    gamepad: { ...base.gamepad },
  };
  const cleaned = tokens.map((token) => token.toLowerCase());
  const bucket = next[device];
  if (overrideMatchesDefault(device, actionId, cleaned)) {
    delete bucket[actionId];
  } else {
    bucket[actionId] = cleaned;
  }
  return next;
}

/** Reset every action on one device back to its default binding. */
export function resetDeviceToDefaults(
  overrides: ControlBindingOverrides | null | undefined,
  device: DeviceKind,
): ControlBindingOverrides {
  const base = normalizeControlBindingOverrides(overrides) ?? emptyOverrides();
  return {
    version: ACTION_MAP_VERSION,
    keyboard: device === "keyboard" ? {} : { ...base.keyboard },
    gamepad: device === "gamepad" ? {} : { ...base.gamepad },
  };
}

// ---------------------------------------------------------------------------
// Persistence normalization
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDeviceOverrides(
  value: unknown,
): Partial<Record<ActionId, string[]>> {
  const result: Partial<Record<ActionId, string[]>> = {};
  if (!isRecord(value)) return result;
  for (const id of ALL_ACTION_IDS) {
    const tokens = value[id];
    if (!Array.isArray(tokens)) continue;
    const cleaned = tokens
      .filter((token): token is string => typeof token === "string")
      .map((token) => token.toLowerCase())
      .filter((token, index, array) => array.indexOf(token) === index);
    // Drop an override that merely restates the default so persistence stays
    // minimal and forward-compatible.
    if (cleaned.length === 0) continue;
    result[id] = cleaned;
  }
  return result;
}

/**
 * Validate an untrusted persisted value into a safe overrides object, or
 * `undefined` when nothing meaningful is stored. Unknown action ids and
 * non-string tokens are discarded rather than trusted.
 */
export function normalizeControlBindingOverrides(
  value: unknown,
): ControlBindingOverrides | undefined {
  if (!isRecord(value)) return undefined;
  const keyboard = normalizeDeviceOverrides(value.keyboard);
  const gamepad = normalizeDeviceOverrides(value.gamepad);
  if (
    Object.keys(keyboard).length === 0 &&
    Object.keys(gamepad).length === 0
  ) {
    return undefined;
  }
  return { version: ACTION_MAP_VERSION, keyboard, gamepad };
}

export { bindingsForDevice };
