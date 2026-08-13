import type { SceneTransition } from "./sceneTransition";

export type AnimationBeatPhase =
  | "idle"
  | "reach"
  | "tap-one"
  | "tap-two"
  | "grasp"
  | "lift"
  | "transfer"
  | "place"
  | "burn"
  | "deal"
  | "recover"
  | "settle";

export interface AnimationBeat {
  readonly eventId: string;
  readonly owner: string;
  readonly phase: AnimationBeatPhase;
  readonly phaseProgress: number;
  /** Progress of the physical card/chip object, distinct from body anticipation. */
  readonly objectProgress: number;
  readonly source: "rack" | "cards" | "wager" | "pot" | "deck" | "dealer";
  readonly destination: "felt" | "wager" | "muck" | "pot" | "winner" | "board";
}

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
const segment = (value: number, start: number, end: number) => clamp((value - start) / (end - start));

/**
 * Public presentation-event timeline for visible cause and effect.
 *
 * Event id is the identity: repeating the same action creates a fresh beat.
 * Anticipation and recovery never move gameplay objects; `objectProgress`
 * advances only while ownership visibly transfers between physical anchors.
 */
export function animationBeatFor(
  transition: SceneTransition | undefined,
  playerId?: string,
): AnimationBeat | undefined {
  if (!transition) return undefined;
  const t = clamp(transition.progress);
  const ownsSeatBeat = playerId !== undefined && transition.playerIds.includes(playerId);
  const owner = ownsSeatBeat ? playerId : "dealer";

  if (transition.kind === "board-card-dealt") {
    // Burning and turning a board card is dealer-owned work. `applySeat` asks
    // for a beat once per player, so returning the dealer's burn-to-muck beat
    // from those calls makes every player reach toward the muck as though they
    // had folded. Seats must remain inert while the dealer works the board.
    if (playerId !== undefined) return undefined;
    if (t < 0.36) return beat(transition.id, "dealer", "burn", segment(t, 0, 0.36), segment(t, 0.08, 0.32), "deck", "muck");
    if (t < 0.9) return beat(transition.id, "dealer", "deal", segment(t, 0.36, 0.9), segment(t, 0.36, 0.9), "deck", "board");
    return beat(transition.id, "dealer", "recover", segment(t, 0.9, 1), 1, "dealer", "board");
  }
  if (transition.kind === "pot-awarded") {
    if (t < 0.18) return beat(transition.id, "dealer", "reach", segment(t, 0, 0.18), 0, "pot", "winner");
    if (t < 0.86) return beat(transition.id, "dealer", "transfer", segment(t, 0.18, 0.86), segment(t, 0.18, 0.86), "pot", "winner");
    return beat(transition.id, "dealer", "recover", segment(t, 0.86, 1), 1, "pot", "winner");
  }
  if (!ownsSeatBeat) return undefined;

  if (transition.action === "check") {
    if (t < 0.16) return beat(transition.id, owner, "reach", segment(t, 0, 0.16), 0, "dealer", "felt");
    if (t < 0.31) return beat(transition.id, owner, "tap-one", segment(t, 0.16, 0.31), 0, "dealer", "felt");
    if (t < 0.43) return beat(transition.id, owner, "recover", segment(t, 0.31, 0.43), 0, "dealer", "felt");
    if (t < 0.58) return beat(transition.id, owner, "tap-two", segment(t, 0.43, 0.58), 0, "dealer", "felt");
    return beat(transition.id, owner, "recover", segment(t, 0.58, 1), 0, "dealer", "felt");
  }
  if (["call", "bet", "raise", "all-in"].includes(transition.action ?? "")) {
    if (t < 0.2) return beat(transition.id, owner, "reach", segment(t, 0, 0.2), 0, "rack", "wager");
    if (t < 0.32) return beat(transition.id, owner, "grasp", segment(t, 0.2, 0.32), 0, "rack", "wager");
    if (t < 0.42) return beat(transition.id, owner, "lift", segment(t, 0.32, 0.42), segment(t, 0.32, 0.42) * 0.08, "rack", "wager");
    if (t < 0.8) return beat(transition.id, owner, "transfer", segment(t, 0.42, 0.8), 0.08 + segment(t, 0.42, 0.8) * 0.82, "rack", "wager");
    if (t < 0.9) return beat(transition.id, owner, "place", segment(t, 0.8, 0.9), 0.9 + segment(t, 0.8, 0.9) * 0.1, "rack", "wager");
    return beat(transition.id, owner, "recover", segment(t, 0.9, 1), 1, "rack", "wager");
  }
  if (transition.action === "fold") {
    if (t < 0.18) return beat(transition.id, owner, "reach", segment(t, 0, 0.18), 0, "cards", "muck");
    if (t < 0.82) return beat(transition.id, owner, "transfer", segment(t, 0.18, 0.82), segment(t, 0.18, 0.82), "cards", "muck");
    return beat(transition.id, owner, "recover", segment(t, 0.82, 1), 1, "cards", "muck");
  }
  if (transition.action === "collect") {
    if (t < 0.16) return beat(transition.id, "dealer", "reach", segment(t, 0, 0.16), 0, "wager", "pot");
    if (t < 0.86) return beat(transition.id, "dealer", "transfer", segment(t, 0.16, 0.86), segment(t, 0.16, 0.86), "wager", "pot");
    return beat(transition.id, "dealer", "recover", segment(t, 0.86, 1), 1, "wager", "pot");
  }
  return beat(transition.id, owner, t < 1 ? "deal" : "settle", t, t, "deck", "felt");
}

function beat(
  eventId: string,
  owner: string,
  phase: AnimationBeatPhase,
  phaseProgress: number,
  objectProgress: number,
  source: AnimationBeat["source"],
  destination: AnimationBeat["destination"],
): AnimationBeat {
  return { eventId, owner, phase, phaseProgress: clamp(phaseProgress), objectProgress: clamp(objectProgress), source, destination };
}
