/**
 * The authored 2D player-model library.
 *
 * These are deliberately small data records instead of downloaded portraits:
 * `TwoDAvatar` turns each record into an original, blocky SVG at render time.
 * That keeps the 2D table crisp at every UI scale and makes the whole identity
 * set inspectable, deterministic, and offline-safe.
 *
 * The roster is intentionally explicit: 75 male names and 25 female names.
 * Gender is a presentation constraint only. It never reaches a poker policy,
 * rating, stack, or action decision.
 */

export const TWO_D_MALE_NAMES = [
  "Adrian",
  "Caleb",
  "Darius",
  "Elias",
  "Jonah",
  "Mateo",
  "Nolan",
  "Rafael",
  "Tomas",
  "Jules",
  "Ari",
  "Sol",
  "Kei",
  "Ivo",
  "Noor",
  "Rin",
  "Marcus",
  "Julian",
  "Victor",
  "Theo",
  "Malcolm",
  "Andre",
  "Bruno",
  "Cameron",
  "Dominic",
  "Everett",
  "Felix",
  "Gabriel",
  "Hugo",
  "Isaac",
  "Javier",
  "Kieran",
  "Leo",
  "Micah",
  "Nico",
  "Omar",
  "Paolo",
  "Quentin",
  "Roman",
  "Simon",
  "Tristan",
  "Uriel",
  "Wesley",
  "Xavier",
  "Zane",
  "Arlo",
  "Bennett",
  "Clark",
  "Desmond",
  "Emmett",
  "Finn",
  "Graham",
  "Holden",
  "Ivan",
  "Jasper",
  "Kai",
  "Luca",
  "Milo",
  "Nash",
  "Orion",
  "Pierce",
  "Reid",
  "Stefan",
  "Tate",
  "Vaughn",
  "Wyatt",
  "Xander",
  "Yusuf",
  "Anton",
  "Blake",
  "Cedric",
  "Dante",
  "Enzo",
  "Francis",
  "Marius",
] as const;

export const TWO_D_FEMALE_NAMES = [
  "Amara",
  "Elena",
  "Isla",
  "Juno",
  "Lena",
  "Maya",
  "Nadia",
  "Talia",
  "Mara",
  "Nia",
  "Alina",
  "Brielle",
  "Celeste",
  "Daphne",
  "Esme",
  "Freya",
  "Gia",
  "Hazel",
  "Ines",
  "Kiara",
  "Layla",
  "Mira",
  "Naomi",
  "Priya",
  "Sofia",
] as const;

export type TwoDAvatarGender = "male" | "female";

export type TwoDAvatarFaceShape = "round" | "oval" | "square" | "angular" | "soft";
export type TwoDAvatarHairStyle =
  | "crop"
  | "fade"
  | "sweep"
  | "waves"
  | "buzz"
  | "cap"
  | "side-part"
  | "bob"
  | "long"
  | "bun"
  | "braid"
  | "pixie"
  | "ponytail"
  | "curls";
export type TwoDAvatarAccessory =
  | "none"
  | "glasses"
  | "headset"
  | "earrings"
  | "cap"
  | "hoops";
export type TwoDAvatarExpression = "smile" | "focused" | "calm" | "confident";
export type TwoDAvatarBodyShape = "narrow" | "standard" | "broad" | "soft";
export type TwoDAvatarShirtDetail = "collar" | "stripe" | "zip" | "pocket" | "crew";
export type TwoDAvatarFacialHair = "none" | "stubble" | "beard" | "goatee";

export interface TwoDAvatarModel {
  /** Stable library index, 0..99. */
  readonly index: number;
  /** Stable asset-like key used in DOM diagnostics and test snapshots. */
  readonly id: string;
  /** The first name shown under the blocky portrait. */
  readonly name: string;
  readonly gender: TwoDAvatarGender;
  readonly background: string;
  readonly backgroundAccent: string;
  readonly shirt: string;
  readonly shirtAccent: string;
  readonly skinTone: string;
  readonly hairColor: string;
  readonly hairHighlight: string;
  readonly eyeColor: string;
  readonly faceShape: TwoDAvatarFaceShape;
  readonly hairStyle: TwoDAvatarHairStyle;
  readonly accessory: TwoDAvatarAccessory;
  readonly expression: TwoDAvatarExpression;
  readonly bodyShape: TwoDAvatarBodyShape;
  readonly shirtDetail: TwoDAvatarShirtDetail;
  readonly facialHair: TwoDAvatarFacialHair;
}

const SKIN_TONES = [
  "#f4d2b5",
  "#e9bb96",
  "#d89b73",
  "#c07d59",
  "#a76448",
  "#8b513b",
  "#6e3e31",
  "#513128",
] as const;

const HAIR_COLORS = [
  "#171b25",
  "#2a1c23",
  "#4a2d25",
  "#70402a",
  "#9b6334",
  "#c48c49",
  "#74645f",
  "#d0b69b",
] as const;

const BACKGROUNDS = [
  ["#21344b", "#365775"],
  ["#392b54", "#634b7d"],
  ["#163e3d", "#2b7168"],
  ["#4a3036", "#8b5057"],
  ["#5a3d24", "#a8753e"],
  ["#263d2c", "#4d7651"],
  ["#2c344f", "#5e6da2"],
  ["#4a2948", "#884f7e"],
  ["#183c55", "#317293"],
  ["#3c3a25", "#7a7442"],
  ["#4a2d2c", "#9c5950"],
  ["#213b48", "#3b7081"],
] as const;

const MALE_SHIRTS = [
  ["#1d5f72", "#43a2aa"],
  ["#3f3a82", "#8278c9"],
  ["#8a3d45", "#d16b63"],
  ["#2c6a4c", "#65a47a"],
  ["#3c4759", "#7890aa"],
  ["#9a6728", "#d0a04c"],
  ["#6b3a66", "#a86198"],
  ["#314f7b", "#5d8fc1"],
] as const;

const FEMALE_SHIRTS = [
  ["#1b6d70", "#4fb4aa"],
  ["#75416f", "#c172a3"],
  ["#a34d42", "#e2846e"],
  ["#436748", "#82ae72"],
  ["#3f4c76", "#7c8dc4"],
  ["#a36a2c", "#ddb55c"],
  ["#365d7c", "#6fa5c3"],
  ["#674058", "#aa6a83"],
] as const;

const MALE_HAIR_STYLES: readonly TwoDAvatarHairStyle[] = [
  "crop",
  "fade",
  "sweep",
  "waves",
  "buzz",
  "cap",
  "side-part",
];

const FEMALE_HAIR_STYLES: readonly TwoDAvatarHairStyle[] = [
  "bob",
  "long",
  "waves",
  "bun",
  "braid",
  "pixie",
  "ponytail",
  "curls",
];

const FACE_SHAPES: readonly TwoDAvatarFaceShape[] = [
  "round",
  "oval",
  "square",
  "angular",
  "soft",
];

const EXPRESSIONS: readonly TwoDAvatarExpression[] = [
  "smile",
  "focused",
  "calm",
  "confident",
];

const BODY_SHAPES: readonly TwoDAvatarBodyShape[] = [
  "narrow",
  "standard",
  "broad",
  "soft",
];

const SHIRT_DETAILS: readonly TwoDAvatarShirtDetail[] = [
  "collar",
  "stripe",
  "zip",
  "pocket",
  "crew",
];

const MALE_ACCESSORIES: readonly TwoDAvatarAccessory[] = [
  "none",
  "none",
  "glasses",
  "headset",
  "cap",
  "none",
];

const FEMALE_ACCESSORIES: readonly TwoDAvatarAccessory[] = [
  "none",
  "none",
  "glasses",
  "earrings",
  "hoops",
  "headset",
];

function hashNumber(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(options: readonly T[], seed: string): T {
  return options[hashNumber(seed) % options.length];
}

function createModel(
  name: string,
  gender: TwoDAvatarGender,
  index: number,
): TwoDAvatarModel {
  const seed = `${gender}:${name}:${index}`;
  const background = BACKGROUNDS[index % BACKGROUNDS.length];
  const shirts = gender === "male" ? MALE_SHIRTS : FEMALE_SHIRTS;
  const shirt = shirts[(index * 5 + hashNumber(`${seed}:shirt`)) % shirts.length];
  const hairColor = HAIR_COLORS[(index * 3 + hashNumber(`${seed}:hair`)) % HAIR_COLORS.length];
  const hairHighlight = HAIR_COLORS[(index * 3 + 3 + hashNumber(`${seed}:highlight`)) % HAIR_COLORS.length];
  const hairStyles = gender === "male" ? MALE_HAIR_STYLES : FEMALE_HAIR_STYLES;
  const accessories = gender === "male" ? MALE_ACCESSORIES : FEMALE_ACCESSORIES;
  return {
    index,
    id: `player-model-${String(index + 1).padStart(3, "0")}`,
    name,
    gender,
    background: background[0],
    backgroundAccent: background[1],
    shirt: shirt[0],
    shirtAccent: shirt[1],
    skinTone: pick(SKIN_TONES, `${seed}:skin`),
    hairColor,
    hairHighlight,
    eyeColor: pick(["#171b25", "#2f2223", "#183d46", "#352d58"], `${seed}:eyes`),
    faceShape: pick(FACE_SHAPES, `${seed}:face`),
    hairStyle: pick(hairStyles, `${seed}:style`),
    accessory: pick(accessories, `${seed}:accessory`),
    expression: pick(EXPRESSIONS, `${seed}:expression`),
    bodyShape: pick(BODY_SHAPES, `${seed}:body`),
    shirtDetail: pick(SHIRT_DETAILS, `${seed}:shirt-detail`),
    facialHair:
      gender === "male"
        ? pick(["none", "none", "stubble", "beard", "goatee"] as const, `${seed}:facial-hair`)
        : "none",
  };
}

/** The complete 100-model library: exactly 75 male and 25 female models. */
export const TWO_D_AVATAR_MODELS: readonly TwoDAvatarModel[] = Object.freeze([
  ...TWO_D_MALE_NAMES.map((name, index) => createModel(name, "male", index)),
  ...TWO_D_FEMALE_NAMES.map((name, index) => createModel(name, "female", 75 + index)),
]);

export const TWO_D_MALE_AVATAR_MODELS = Object.freeze(
  TWO_D_AVATAR_MODELS.filter((model) => model.gender === "male"),
);
export const TWO_D_FEMALE_AVATAR_MODELS = Object.freeze(
  TWO_D_AVATAR_MODELS.filter((model) => model.gender === "female"),
);

export const TWO_D_AVATAR_MODEL_COUNT = TWO_D_AVATAR_MODELS.length;
export const TWO_D_AVATAR_GENDER_COUNTS = Object.freeze({
  male: TWO_D_MALE_AVATAR_MODELS.length,
  female: TWO_D_FEMALE_AVATAR_MODELS.length,
});

const MALE_NAME_SET = new Set(TWO_D_MALE_NAMES.map((name) => name.toLowerCase()));
const FEMALE_NAME_SET = new Set(TWO_D_FEMALE_NAMES.map((name) => name.toLowerCase()));

/**
 * Classify a visible name for presentation. Unknown or ambiguous names default
 * to male, matching the requested fallback instead of guessing from style.
 */
export function genderFor2DName(name: string | undefined): TwoDAvatarGender {
  const firstName = name?.trim().split(/\s+/u)[0]?.toLowerCase();
  if (firstName && FEMALE_NAME_SET.has(firstName)) return "female";
  if (firstName && MALE_NAME_SET.has(firstName)) return "male";
  return "male";
}

/** Pick one model from the correct gender pool using only identity/name data. */
export function twoDAvatarModelForPlayer(
  playerId: string,
  playerName?: string,
): TwoDAvatarModel {
  const gender = genderFor2DName(playerName);
  const pool = gender === "female" ? TWO_D_FEMALE_AVATAR_MODELS : TWO_D_MALE_AVATAR_MODELS;
  return pool[hashNumber(`${playerId}:2d-model:${gender}`) % pool.length];
}

export interface TwoDPlayerIdentityInput {
  readonly id: string;
  readonly name?: string;
}

export interface TwoDPlayerIdentity {
  readonly model: TwoDAvatarModel;
  readonly displayName: string;
}

function asIdentityInput(
  player: string | TwoDPlayerIdentityInput,
): TwoDPlayerIdentityInput {
  return typeof player === "string" ? { id: player } : player;
}

/**
 * Resolve a visible table roster to distinct models. Sorting by id keeps a
 * replay, a seat rotation, and a differently ordered snapshot identical.
 */
export function unique2DPlayerIdentities(
  players: readonly (string | TwoDPlayerIdentityInput)[],
): ReadonlyMap<string, TwoDPlayerIdentity> {
  const inputs = new Map<string, TwoDPlayerIdentityInput>();
  for (const rawPlayer of players) {
    const player = asIdentityInput(rawPlayer);
    if (!inputs.has(player.id)) inputs.set(player.id, player);
  }

  const identities = new Map<string, TwoDPlayerIdentity>();
  const usedModels = new Set<string>();
  for (const player of [...inputs.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )) {
    const preferred = twoDAvatarModelForPlayer(player.id, player.name);
    const pool = preferred.gender === "female"
      ? TWO_D_FEMALE_AVATAR_MODELS
      : TWO_D_MALE_AVATAR_MODELS;
    const preferredIndex = pool.findIndex((model) => model.id === preferred.id);
    let model = preferred;
    for (let offset = 0; offset < pool.length; offset += 1) {
      const candidate = pool[(preferredIndex + offset) % pool.length];
      if (!usedModels.has(candidate.id)) {
        model = candidate;
        break;
      }
    }
    usedModels.add(model.id);
    identities.set(player.id, { model, displayName: model.name });
  }
  return identities;
}

export function unique2DPlayerModels(
  players: readonly (string | TwoDPlayerIdentityInput)[],
): ReadonlyMap<string, TwoDAvatarModel> {
  return new Map(
    [...unique2DPlayerIdentities(players)].map(([id, identity]) => [id, identity.model]),
  );
}

export function unique2DPlayerDisplayNames(
  players: readonly (string | TwoDPlayerIdentityInput)[],
): ReadonlyMap<string, string> {
  return new Map(
    [...unique2DPlayerIdentities(players)].map(([id, identity]) => [id, identity.displayName]),
  );
}
