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

export interface GameSettings {
  masterVolume: number;
  muted: boolean;
  musicVolume: number;
  effectsVolume: number;
  fullscreen: boolean;
  reducedMotion: boolean;
  dealSpeed: "cinematic" | "standard" | "quick";
  colorAssist: boolean;
  controlBindings?: ControlBindingOverrides;
}
