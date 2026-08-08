export type DealerCardJobKind = "hole-card" | "burn-card" | "board-card" | "payout";
export type DealerCardPhase =
  | "rest"
  | "reach"
  | "grasp"
  | "lift"
  | "transport"
  | "place"
  | "reveal"
  | "release"
  | "return"
  | "settle";

export interface DealerCardFrame {
  readonly phase: DealerCardPhase;
  readonly ownership: "deck" | "dealer-hand" | "airborne" | "destination" | "muck";
  readonly visible: boolean;
  readonly faceUp: boolean;
  /** Quaternion in three.js [x, y, z, w] order. */
  readonly quaternion: readonly [number, number, number, number];
  readonly pitchRadians: number;
  readonly rollRadians: number;
}

const PHASES: readonly DealerCardPhase[] = [
  "rest", "reach", "grasp", "lift", "transport", "place", "reveal", "release", "return", "settle",
];

export const DEALER_PHASE_SEQUENCE: Readonly<Record<DealerCardJobKind, readonly DealerCardPhase[]>> = {
  "hole-card": ["rest", "reach", "grasp", "lift", "transport", "place", "release", "return", "settle"],
  "burn-card": ["rest", "reach", "grasp", "lift", "transport", "place", "release", "return", "settle"],
  "board-card": PHASES,
  payout: ["rest", "reach", "grasp", "lift", "transport", "place", "release", "return", "settle"],
};

function phaseFor(kind: DealerCardJobKind, progress: number): DealerCardPhase {
  const t = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 1));
  const sequence = DEALER_PHASE_SEQUENCE[kind];
  const index = Math.min(sequence.length - 1, Math.floor(t * sequence.length));
  return sequence[index] ?? sequence[sequence.length - 1];
}

function normalizedPhaseProgress(kind: DealerCardJobKind, progress: number): number {
  const sequence = DEALER_PHASE_SEQUENCE[kind];
  const t = Math.min(1, Math.max(0, progress));
  const index = Math.min(sequence.length - 1, Math.floor(t * sequence.length));
  const start = index / sequence.length;
  return Math.min(1, Math.max(0, (t - start) * sequence.length));
}

function faceDownQuaternion(roll: number): readonly [number, number, number, number] {
  const halfRoll = roll / 2;
  return [Math.cos(halfRoll), Math.sin(halfRoll), 0, 0] as const;
}

function faceUpQuaternion(): readonly [number, number, number, number] {
  return [0, 0, 0, 1] as const;
}

/** One deterministic owner/phase/orientation frame for a card job. */
export function dealerCardFrame(
  kind: DealerCardJobKind,
  progress: number,
): DealerCardFrame {
  const phase = phaseFor(kind, progress);
  const local = normalizedPhaseProgress(kind, progress);
  const faceUp = kind === "board-card" && (phase === "reveal" || phase === "release" || phase === "return" || phase === "settle");
  const airborne = phase === "lift" || phase === "transport";
  const intentionalReveal = kind === "board-card" && phase === "reveal";
  const pitchRadians = intentionalReveal ? Math.PI * (1 - local) : airborne ? 0.12 * Math.sin(Math.PI * local) : 0;
  const rollRadians = airborne ? 0.10 * Math.sin(Math.PI * local) : 0;
  const quaternion = faceUp
    ? faceUpQuaternion()
    : faceDownQuaternion(rollRadians);
  const ownership = phase === "rest" || phase === "reach" || phase === "grasp"
    ? "deck"
    : phase === "lift"
      ? "dealer-hand"
      : phase === "transport"
        ? "airborne"
        : kind === "burn-card" && (phase === "place" || phase === "release" || phase === "return")
          ? "muck"
          : phase === "return" || phase === "settle"
            ? "destination"
            : "destination";
  return {
    phase,
    ownership,
    visible: phase !== "rest" && phase !== "reach" && phase !== "grasp",
    faceUp,
    quaternion,
    pitchRadians,
    rollRadians,
  };
}

export function dealerPhaseIndex(kind: DealerCardJobKind, phase: DealerCardPhase): number {
  return DEALER_PHASE_SEQUENCE[kind].indexOf(phase);
}
