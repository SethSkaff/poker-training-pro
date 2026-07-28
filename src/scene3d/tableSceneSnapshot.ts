import type { SceneSeatState, TableSceneState } from "./tableScene";
import type { SeatActionKind } from "./tableSceneModel";

/** Public-only presenter input. This module intentionally imports no engine or card types. */
export interface PublicScenePlayer {
  readonly id: string;
  readonly canonicalSeat: number;
  readonly stack: number;
  readonly bet: number;
  readonly status: "active" | "folded" | "all-in" | "out";
}

export interface TableSceneSnapshotInput {
  readonly players: readonly PublicScenePlayer[];
  readonly heroId: string;
  readonly actingPlayerId?: string;
  readonly publicActions?: Readonly<Record<string, SeatActionKind | undefined>>;
  readonly pot: number;
  readonly boardCards: number;
  readonly publicBoardCardCodes?: readonly string[];
  readonly heroCardCodes?: readonly string[];
  readonly revealedCardCodesByPlayer?: Readonly<Record<string, readonly string[]>>;
  readonly cameraPan: number;
  readonly reducedMotion: boolean;
  readonly buttonCanonicalSeat?: number;
  readonly smallBlindCanonicalSeat?: number;
  readonly bigBlindCanonicalSeat?: number;
  readonly revealedPlayerIds?: readonly string[];
  readonly tier?: "local" | "regional" | "national" | "championship";
}

export interface SceneSnapshotSeat extends SceneSeatState {
  readonly canonicalSeat: number;
  readonly relativeSeat: number;
  readonly cardVisibility: "hidden" | "shown";
  /** Stable seed for procedural M2 appearance; never card/policy-derived. */
  readonly appearance: number;
  readonly publicCardCodes: readonly string[];
}

export interface TableSceneSnapshot extends TableSceneState {
  readonly seats: readonly SceneSnapshotSeat[];
  readonly buttonRelativeSeat?: number;
  readonly smallBlindRelativeSeat?: number;
  readonly bigBlindRelativeSeat?: number;
  readonly tier: "local" | "regional" | "national" | "championship";
  readonly publicBoardCardCodes: readonly string[];
}

/** Deterministically projects canonical engine seats into hero-relative scene seats. */
export function createTableSceneSnapshot(input: TableSceneSnapshotInput): TableSceneSnapshot {
  const hero = input.players.find((player) => player.id === input.heroId);
  if (!hero) throw new Error("scene snapshot requires the public hero seat");
  const revealed = new Set(input.revealedPlayerIds);
  const seats = input.players
    .filter((player) => player.status !== "out")
    .map((player) => ({
      player,
      relativeSeat: (player.canonicalSeat - hero.canonicalSeat + 10) % 10,
    }))
    .sort((left, right) => left.relativeSeat - right.relativeSeat || left.player.id.localeCompare(right.player.id))
    .slice(0, 6)
    .map(({ player, relativeSeat }, seat): SceneSnapshotSeat => ({
      id: player.id,
      canonicalSeat: player.canonicalSeat,
      relativeSeat,
      seat,
      stack: player.stack,
      bet: player.bet,
      folded: player.status === "folded",
      acting: input.actingPlayerId === player.id,
      isHero: player.id === input.heroId,
      cardVisibility: player.id === input.heroId || revealed.has(player.id) ? "shown" : "hidden",
      publicCardCodes: player.id === input.heroId
        ? input.heroCardCodes ?? []
        : revealed.has(player.id)
          ? input.revealedCardCodesByPlayer?.[player.id] ?? []
          : [],
      appearance: appearanceForId(player.id),
      ...(input.publicActions?.[player.id] ? { action: input.publicActions[player.id] } : {}),
    }));
  const relative = (canonicalSeat: number | undefined) => canonicalSeat === undefined ? undefined : (canonicalSeat - hero.canonicalSeat + 10) % 10;
  return { seats, pot: input.pot, boardCards: input.boardCards, publicBoardCardCodes: input.publicBoardCardCodes ?? [], cameraPan: input.cameraPan, reducedMotion: input.reducedMotion, buttonRelativeSeat: relative(input.buttonCanonicalSeat), smallBlindRelativeSeat: relative(input.smallBlindCanonicalSeat), bigBlindRelativeSeat: relative(input.bigBlindCanonicalSeat), tier: input.tier ?? "local" };
}

function appearanceForId(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
