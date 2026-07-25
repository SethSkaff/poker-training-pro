export type Suit = "clubs" | "diamonds" | "hearts" | "spades";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "T"
  | "J"
  | "Q"
  | "K"
  | "A";

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type GameMode = "training" | "rational" | "normal";
export type Street = "preflop" | "flop" | "turn" | "river";
export type PokerAction = "fold" | "check" | "call" | "raise" | "all-in";
export type MathTopic =
  | "pot-odds"
  | "equity"
  | "outs"
  | "implied-odds"
  | "expected-value"
  | "stack-to-pot-ratio"
  | "minimum-defense-frequency"
  | "tournament-pressure";

export interface SeatPlayer {
  id: string;
  name: string;
  stack: number;
  seat: number;
  status: "active" | "folded" | "all-in" | "out";
  bet: number;
  cards?: Card[];
  personality?: "solver" | "balanced" | "aggressive" | "patient" | "tricky";
}

export interface MathQuestion {
  topic: MathTopic;
  prompt: string;
  unit: "%" | "chips" | "outs" | "ratio";
  correctValue: number;
  tolerance: number;
  explanation: string;
}

export interface TrainingScenario {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  street: Street;
  blinds: [number, number];
  ante?: number;
  heroSeat: number;
  buttonSeat: number;
  /** Public seat currently required to act; absent for static Training prompts. */
  actingPlayerId?: string;
  pot: number;
  amountToCall: number;
  minimumRaise: number;
  heroCards: Card[];
  board: Card[];
  players: SeatPlayer[];
  prompt: string;
  recommendedAction: PokerAction;
  acceptableActions?: PokerAction[];
  actionReason: string;
  mathQuestion: MathQuestion;
  tags: string[];
}

export interface TrainingResult {
  scenarioId: string;
  completedAt: string;
  action: PokerAction;
  actionCorrect: boolean;
  mathAnswer?: number;
  mathCorrect: boolean;
  elapsedMs: number;
  eloDelta: number;
}

export interface PlayerProgress {
  onboardingCompleted: boolean;
  /** One-time interactive play-chip disclosure acknowledgment. */
  playChipsAcknowledged: boolean;
  playerName: string;
  decisionElo: number;
  mathElo: number;
  tournamentElo: number;
  trainingCompleted: number;
  currentStreak: number;
  bestStreak: number;
  totalDecisionMs: number;
  results: TrainingResult[];
  unlockedCircuit: number;
}

// Persisted per-device control remaps. Only differences from the built-in
// defaults are stored; see `src/lib/actionMap.ts`. Optional so existing saves
// (and the iOS bundle) remain valid without it.
export type { ControlBindingOverrides } from "../lib/actionMap";
import type { ControlBindingOverrides } from "../lib/actionMap";

/** Per-surface motion intensity. The global reduced-motion control remains an
 * emergency override, while these preferences let players keep only the motion
 * they find useful. */
export type MotionIntensity = "full" | "reduced" | "off";

export interface GameSettings {
  masterVolume: number;
  muted: boolean;
  musicVolume: number;
  effectsVolume: number;
  fullscreen: boolean;
  reducedMotion: boolean;
  /** True once the player has explicitly chosen a reduced-motion preference
   * (first-run setup's Save action, or the Settings toggle). While false,
   * `reducedMotion` is treated as unset and the renderer instead follows the
   * operating system's live `prefers-reduced-motion` preference; see
   * `src/lib/motionPreference.ts`. Safe Mode still overrides both. */
  reducedMotionExplicit: boolean;
  dealSpeed: "cinematic" | "standard" | "quick";
  colorAssist: boolean;
  /** How far one look-left/right command moves the seated table camera. */
  cameraSensitivity: "low" | "standard" | "high";
  /** A compact, standard, or wider seated-table field of view. */
  cameraView: "close" | "standard" | "wide";
  /** Enables room travel and automatically recenters at a new hand. */
  autoCameraMovement: boolean;
  /** Decorative title/menu movement. */
  menuMotion: MotionIntensity;
  /** Championship-room arrival movement. */
  roomMotion: MotionIntensity;
  /** Automatic camera pans and the eased seated-view response. */
  cameraMotion: MotionIntensity;
  /** Card, chip, timer, and opponent-action flourish. */
  tableMotion: MotionIntensity;
  /** Screen and between-hand transition intensity. */
  transitionMotion: MotionIntensity;
  /** Applies a readable desktop interface scale without changing game rules. */
  interfaceScale: "compact" | "standard" | "large" | "extra-large";
  controlBindings?: ControlBindingOverrides;
}
