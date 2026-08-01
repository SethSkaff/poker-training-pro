import type { SceneSeatState, TableSceneState } from "./tableScene";
import type { SceneCameraMotion, SceneCameraView, SeatActionKind } from "./tableSceneModel";
import type { SceneTransition } from "./sceneTransition";

/** Public-only presenter input. This module intentionally imports no engine or card types. */
export interface PublicScenePlayer {
  readonly id: string;
  readonly canonicalSeat: number;
  readonly stack: number;
  readonly bet: number;
  readonly status: "active" | "folded" | "all-in" | "out";
}

export interface TableSceneSnapshotInput {
  /** Stable public identity for the active hand's physical deck. */
  readonly handId?: string;
  readonly players: readonly PublicScenePlayer[];
  readonly heroId: string;
  readonly actingPlayerId?: string;
  readonly publicActions?: Readonly<Record<string, SeatActionKind | undefined>>;
  readonly pot: number;
  readonly pots?: readonly { id: string; kind: "main" | "side"; amount: number }[];
  readonly boardCards: number;
  readonly publicBoardCardCodes?: readonly string[];
  readonly heroCardCodes?: readonly string[];
  /**
   * True only while the player is actively holding their own cards up.
   *
   * The hero's hole cards lie face down on the felt like everyone else's, which
   * is what a poker table looks like and what stops a shoulder-surfer reading
   * them. This is the squeeze: it lifts the near corner and turns the faces up
   * for exactly as long as the player holds. It is never persisted and never
   * part of a replay -- it describes a hand on a card, not a game state.
   */
  readonly heroPeeked?: boolean;
  readonly revealedCardCodesByPlayer?: Readonly<Record<string, readonly string[]>>;
  readonly cameraPan: number;
  /** Which player station the hero occupies; the seated camera sits there. */
  readonly heroStationIndex?: number;
  readonly cameraView?: SceneCameraView;
  readonly cameraMotion?: SceneCameraMotion;
  readonly reducedMotion: boolean;
  readonly buttonCanonicalSeat?: number;
  readonly smallBlindCanonicalSeat?: number;
  readonly bigBlindCanonicalSeat?: number;
  readonly revealedPlayerIds?: readonly string[];
  readonly tier?: "local" | "regional" | "national" | "championship";
  readonly transition?: SceneTransition;
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
  const collectedBetAmounts = new Map(
    input.transition?.action === "collect"
      ? input.transition.collectedBets?.map((collection) => [collection.playerId, collection.amount])
      : [],
  );
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
      // The next betting street clears its authoritative `bet` values before
      // this public presentation beat plays. Retain only the public swept
      // amount long enough for the decorative chip pile to reach the pot.
      bet: collectedBetAmounts.get(player.id) ?? player.bet,
      folded: player.status === "folded" || input.transition?.foldedPlayerIds.includes(player.id) === true,
      acting: input.actingPlayerId === player.id,
      isHero: player.id === input.heroId,
      cardVisibility: (player.id === input.heroId && input.heroPeeked) || revealed.has(player.id)
        ? "shown"
        : "hidden",
      /*
        A face-down card carries no rank. The hero's codes used to be handed to
        the renderer unconditionally, so the physical hole cards painted their
        faces whatever `cardVisibility` said -- the visibility flag was computed
        and then not used by the thing that draws. Gating the codes themselves
        means "face down" is a property of the data, not a rule the renderer has
        to remember to apply.
      */
      publicCardCodes: player.id === input.heroId
        ? (input.heroPeeked || revealed.has(player.id) ? input.heroCardCodes ?? [] : [])
        : revealed.has(player.id)
          ? input.revealedCardCodesByPlayer?.[player.id] ?? []
          : [],
      appearance: appearanceForId(player.id),
      ...(input.publicActions?.[player.id]
        ? { action: input.publicActions[player.id] }
        : collectedBetAmounts.has(player.id)
          ? { action: "collect" as const }
          : {}),
    }));
  const relative = (canonicalSeat: number | undefined) => canonicalSeat === undefined ? undefined : (canonicalSeat - hero.canonicalSeat + 10) % 10;
  const playerIdAt = (canonicalSeat: number | undefined) => canonicalSeat === undefined
    ? undefined
    : seats.find((seat) => seat.canonicalSeat === canonicalSeat)?.id;
  return {
    handId: input.handId,
    seats,
    pot: input.pot,
    pots: input.pots,
    boardCards: input.boardCards,
    publicBoardCardCodes: input.publicBoardCardCodes ?? [],
    cameraPan: input.cameraPan,
    heroStationIndex: input.heroStationIndex,
    heroPeeked: input.heroPeeked ?? false,
    cameraView: input.cameraView ?? "standard",
    cameraMotion: input.cameraMotion ?? "full",
    reducedMotion: input.reducedMotion,
    buttonRelativeSeat: relative(input.buttonCanonicalSeat),
    smallBlindRelativeSeat: relative(input.smallBlindCanonicalSeat),
    bigBlindRelativeSeat: relative(input.bigBlindCanonicalSeat),
    buttonPlayerId: playerIdAt(input.buttonCanonicalSeat),
    smallBlindPlayerId: playerIdAt(input.smallBlindCanonicalSeat),
    bigBlindPlayerId: playerIdAt(input.bigBlindCanonicalSeat),
    tier: input.tier ?? "local",
    transition: input.transition,
  };
}

function appearanceForId(id: string): number {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
