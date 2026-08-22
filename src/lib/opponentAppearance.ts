/**
 * Deterministic visual identity for a seated opponent.
 *
 * **The only input is the player id.** That is the whole design: appearance can
 * never correlate with playing behavior, skill, rating, personality profile,
 * stack, position, or anything the player could learn to read, because none of
 * those values are in scope here. A reviewer checking the non-correlation
 * requirement (E10-001) only has to check this function's signature.
 *
 * The values are CSS-ready rather than art assets. Six portrait cells exist in
 * the sprite sheet; everything else — chair, torso, shoulders, hair silhouette,
 * accessory, posture lean, ground shadow — is drawn procedurally, so a fresh
 * field looks like a fresh field without shipping a portrait per opponent.
 */

export const SKIN_TONES = [
  "#f0d3ba",
  "#e5bd9a",
  "#cf9e78",
  "#b47b53",
  "#8d5a3a",
  "#65402a",
] as const;

export const HAIR_COLORS = [
  "#1b1613",
  "#3b2a1e",
  "#6b4426",
  "#9d7442",
  "#c9c3bb",
  "#4a2f4b",
] as const;

export const HAIR_STYLES = [
  "cropped",
  "swept",
  "curls",
  "bun",
  "long",
  "undercut",
  "bald",
] as const;

/**
 * Presented gender, used only to pick a body and hair set. It carries no
 * behavioural meaning, exactly like every other dimension here: the sole input
 * remains the player id.
 */
export const PRESENTED_GENDERS = ["male", "female"] as const;

/**
 * Five male and three female body types, per the design owner's spec. These are
 * silhouette families for the 3D character rig, not the older CSS `BODY_TYPES`
 * (which the 2.5D fallback still uses and which stays untouched).
 */
export const MALE_BODY_TYPES = [
  "lean",
  "average",
  "stocky",
  "broad",
  "heavy",
] as const;
export const FEMALE_BODY_TYPES = ["slight", "average", "curvy"] as const;

/** Five hair styles per presented gender. */
export const MALE_HAIR_STYLES = [
  "buzz",
  "short-side-part",
  "textured-crop",
  "slick-back",
  "bald",
] as const;
export const FEMALE_HAIR_STYLES = [
  "ponytail",
  "bob",
  "long-straight",
  "curly-shoulder",
  "top-knot",
] as const;

/**
 * Hair colour is sampled along a continuous gradient rather than picked from a
 * fixed list, so two opponents almost never share an exact shade. The gradient
 * runs black -> dark brown -> chestnut -> blond -> auburn -> grey -> silver,
 * which covers the natural range plus the greys that make an older table read
 * as mixed-age.
 */
/*
  The pale end is honey and pewter, not cream and white.

  0xd8b06a and 0xd7d4d0 were within a few percent of every light skin tone in
  the roster, so a fair-haired identity beside a fair-skinned one rendered as a
  bald head with a slightly different patch on the crown -- there was hair, it
  simply had no edge against the face it sat on. Hair needs to differ from skin
  in *value*, not only in hue.
*/
export const HAIR_GRADIENT_STOPS = [
  [0x14, 0x0f, 0x0d],
  [0x33, 0x22, 0x16],
  [0x5c, 0x38, 0x1e],
  [0x8e, 0x63, 0x33],
  [0xb4, 0x8a, 0x46],
  [0x7a, 0x33, 0x20],
  [0x77, 0x71, 0x6d],
  [0xa8, 0xa4, 0x9e],
] as const;

export const FACE_PRESETS = [
  "broad-jaw",
  "narrow",
  "soft-round",
  "angular",
  "high-cheek",
  "heavy-brow",
] as const;

export const OUTFITS = [
  /*
    Mid-tone rather than near-black. The first v2 palette reused the 2.5D CSS
    colours, which are all around #2b2b30 -- correct behind a bright DOM card but
    invisible on the dim far side of a 3D room, where five torsos merged into one
    dark slab. A card room is full of colour; these read as separate people while
    still letting the felt stay the brightest thing on screen.
  */
  { name: "hoodie", base: "#3f5a74", trim: "#557595" },
  { name: "track-jacket", base: "#5b3a70", trim: "#7a4f94" },
  { name: "polo", base: "#1f6f5c", trim: "#2b9179" },
  { name: "blazer", base: "#37415c", trim: "#4a5578" },
  { name: "flannel", base: "#bf2f34", trim: "#d9564f" },
  { name: "tee", base: "#5a7f4a", trim: "#779c66" },
  { name: "puffer", base: "#2f5f8a", trim: "#3f7cb0" },
  /*
    Nothing in this list may fall inside SKIN_TONES.

    `cardigan` was #7a6248 and `turtleneck` #8f7d5e -- both tans, both within a
    few percent of the #b47b53 and #cf9e78 skin tones they were most likely to be
    drawn over. Under the room's warm key an identity that rolled either one came
    out a single unbroken tan from collar to knuckles and read, unmistakably, as
    a naked person sitting at a poker table. Torso and sleeve are the largest
    areas of a character, so this is the one palette collision that cannot be
    allowed to happen at all.
  */
  { name: "cardigan", base: "#a8801f", trim: "#c49c33" },
  { name: "waistcoat", base: "#4a3348", trim: "#63455f" },
  { name: "turtleneck", base: "#7d3346", trim: "#9a4a5e" },
] as const;

export const CLOTHING = [
  { name: "hoodie", base: "#28323d", trim: "#3d4c5c" },
  { name: "track-jacket", base: "#2c1f38", trim: "#4b3358" },
  { name: "polo", base: "#123a34", trim: "#1d574b" },
  { name: "blazer", base: "#1c2530", trim: "#0f1620" },
  { name: "flannel", base: "#402420", trim: "#5d3630" },
  { name: "tee", base: "#33372f", trim: "#4a5042" },
  { name: "puffer", base: "#1d2c3c", trim: "#2f4761" },
  { name: "cardigan", base: "#3a3128", trim: "#54473a" },
] as const;

export const ACCESSORIES = [
  "none",
  "none",
  "glasses",
  "cap",
  "visor",
  "headset",
  "chain",
] as const;

export const FACE_SHAPES = ["oval", "square", "round", "long", "heart"] as const;
export const BODY_TYPES = ["slim", "average", "broad", "heavy"] as const;
export const AGE_PRESENTATIONS = ["young", "adult", "middle", "senior"] as const;
export const POSTURES = ["upright", "leaning", "hunched", "reclined"] as const;

export interface OpponentAppearance {
  /** Which cell of the six-portrait sprite sheet supplies the face. */
  portrait: number;
  faceShape: (typeof FACE_SHAPES)[number];
  skinTone: string;
  hairStyle: (typeof HAIR_STYLES)[number];
  hairColor: string;
  clothing: (typeof CLOTHING)[number];
  accessory: (typeof ACCESSORIES)[number];
  bodyType: (typeof BODY_TYPES)[number];
  agePresentation: (typeof AGE_PRESENTATIONS)[number];
  posture: (typeof POSTURES)[number];
  /** Degrees of seated lean; small by design so the table stays readable. */
  postureLeanDeg: number;
  /** Seconds. Staggers idle motion so a table does not breathe in unison. */
  idlePhaseSeconds: number;
}

/**
 * FNV-1a over the id plus a per-dimension salt. Using a distinct salt per
 * dimension keeps the dimensions independent of one another, so two opponents
 * sharing a portrait cell rarely share hair, clothing, and posture as well.
 */
function dimensionHash(playerId: string, salt: string): number {
  let hash = 2166136261;
  for (const character of `${salt}\u0000${playerId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick<T>(playerId: string, salt: string, options: readonly T[]): T {
  return options[dimensionHash(playerId, salt) % options.length];
}

/** A stable 0..1 fraction for a dimension, for continuous rather than listed values. */
function dimensionFraction(playerId: string, salt: string): number {
  return dimensionHash(playerId, salt) / 0x1_0000_0000;
}

/**
 * Sample the hair gradient at `t` (0..1) and return a hex colour string.
 *
 * Continuous sampling is the point: a fixed six-colour list made hair the most
 * obvious "these two are the same person" tell at a six-handed table.
 */
export function hairColorAt(t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const span = HAIR_GRADIENT_STOPS.length - 1;
  const scaled = clamped * span;
  const index = Math.min(span - 1, Math.floor(scaled));
  const local = scaled - index;
  const from = HAIR_GRADIENT_STOPS[index];
  const to = HAIR_GRADIENT_STOPS[index + 1];
  const channel = (position: number) =>
    Math.round(from[position] + (to[position] - from[position]) * local)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

/** The 3D character build for one identity: body, hair, face, and outfit. */
export interface OpponentCharacter {
  gender: (typeof PRESENTED_GENDERS)[number];
  /** Body family within the presented gender's set. */
  body: string;
  hairStyle: string;
  /** Continuous gradient position, retained so the renderer can shade roots. */
  hairGradient: number;
  hairColor: string;
  face: (typeof FACE_PRESETS)[number];
  skinTone: string;
  outfit: (typeof OUTFITS)[number];
  /** Small per-identity height scale so a table is not one uniform height. */
  heightScale: number;
}

/**
 * Deterministic 3D character for an identity. Same contract as
 * `describeOpponentAppearance`: the player id is the only input, so appearance
 * can never encode how someone plays.
 */
export function describeOpponentCharacter(playerId: string): OpponentCharacter {
  const gender = pick(playerId, "gender", PRESENTED_GENDERS);
  const bodies = gender === "male" ? MALE_BODY_TYPES : FEMALE_BODY_TYPES;
  const hair = gender === "male" ? MALE_HAIR_STYLES : FEMALE_HAIR_STYLES;
  const hairGradient = dimensionFraction(playerId, "hair-gradient");
  return {
    gender,
    body: pick(playerId, "body-3d", bodies),
    hairStyle: pick(playerId, "hair-3d", hair),
    hairGradient,
    hairColor: hairColorAt(hairGradient),
    face: pick(playerId, "face-3d", FACE_PRESETS),
    skinTone: pick(playerId, "skin", SKIN_TONES),
    outfit: pick(playerId, "outfit", OUTFITS),
    // +/-4%: enough that seated shoulder lines differ, never enough to break the
    // camera envelope the composition solver reserves for a head.
    heightScale: 0.96 + (dimensionHash(playerId, "height") % 81) / 1000,
  };
}

export function describeOpponentAppearance(playerId: string): OpponentAppearance {
  const posture = pick(playerId, "posture", POSTURES);
  return {
    portrait: dimensionHash(playerId, "portrait") % 6,
    faceShape: pick(playerId, "face", FACE_SHAPES),
    skinTone: pick(playerId, "skin", SKIN_TONES),
    hairStyle: pick(playerId, "hair-style", HAIR_STYLES),
    hairColor: pick(playerId, "hair-color", HAIR_COLORS),
    clothing: pick(playerId, "clothing", CLOTHING),
    accessory: pick(playerId, "accessory", ACCESSORIES),
    bodyType: pick(playerId, "body", BODY_TYPES),
    agePresentation: pick(playerId, "age", AGE_PRESENTATIONS),
    posture,
    postureLeanDeg:
      posture === "upright"
        ? 0
        : posture === "leaning"
          ? 2.5
          : posture === "hunched"
            ? -1.5
            : -3,
    idlePhaseSeconds: (dimensionHash(playerId, "idle") % 24) / 10,
  };
}

/**
 * Stable visual identity for the flat table's visible roster.
 *
 * `describeOpponentAppearance` intentionally describes one identity in
 * isolation, so independent hashes can theoretically collide when six players
 * share a table. The 2D renderer resolves those rare collisions in sorted
 * player-id order by rotating only face, hair, hair colour, and shirt choices.
 * That makes the result deterministic, independent of seat rotation, and keeps
 * the original identity's skin/accessory/age/posture choices intact.
 */
export function unique2DPlayerAppearances(
  playerIds: readonly string[],
): ReadonlyMap<string, OpponentAppearance> {
  const appearances = new Map<string, OpponentAppearance>();
  const used = new Set<string>();
  const orderedIds = [...new Set(playerIds)].sort();
  const faceCount = FACE_SHAPES.length;
  const hairStyleCount = HAIR_STYLES.length;
  const hairColorCount = HAIR_COLORS.length;
  const clothingCount = CLOTHING.length;

  for (const playerId of orderedIds) {
    const preferred = describeOpponentAppearance(playerId);
    const preferredSignature = appearanceSignature(preferred);
    let chosen = preferred;

    if (used.has(preferredSignature)) {
      const faceStart = dimensionHash(playerId, "2d-face") % faceCount;
      const hairStyleStart = dimensionHash(playerId, "2d-hair-style") % hairStyleCount;
      const hairColorStart = dimensionHash(playerId, "2d-hair-color") % hairColorCount;
      const clothingStart = dimensionHash(playerId, "2d-clothing") % clothingCount;
      const maxVariants = faceCount * hairStyleCount * hairColorCount * clothingCount;

      for (let variant = 1; variant < maxVariants; variant += 1) {
        const candidate: OpponentAppearance = {
          ...preferred,
          faceShape: FACE_SHAPES[(faceStart + variant) % faceCount],
          hairStyle: HAIR_STYLES[
            (hairStyleStart + Math.floor(variant / faceCount)) % hairStyleCount
          ],
          hairColor: HAIR_COLORS[
            (hairColorStart + Math.floor(variant / (faceCount * hairStyleCount))) % hairColorCount
          ],
          clothing: CLOTHING[
            (clothingStart + Math.floor(variant / (faceCount * hairStyleCount * hairColorCount))) % clothingCount
          ],
        };
        if (!used.has(appearanceSignature(candidate))) {
          chosen = candidate;
          break;
        }
      }
    }

    used.add(appearanceSignature(chosen));
    appearances.set(playerId, chosen);
  }

  return appearances;
}

/** Stable full-combination key used only by the 2D roster collision resolver. */
export function appearanceSignature(appearance: OpponentAppearance): string {
  return [
    appearance.portrait,
    appearance.faceShape,
    appearance.skinTone,
    appearance.hairStyle,
    appearance.hairColor,
    appearance.clothing.name,
    appearance.accessory,
    appearance.bodyType,
    appearance.agePresentation,
    appearance.posture,
  ].join("|");
}

/** CSS custom properties for one seated figure. */
export function opponentAppearanceStyle(
  appearance: OpponentAppearance,
): Record<string, string> {
  return {
    "--seat-skin": appearance.skinTone,
    "--seat-hair": appearance.hairColor,
    "--seat-cloth": appearance.clothing.base,
    "--seat-cloth-trim": appearance.clothing.trim,
    "--seat-lean": `${appearance.postureLeanDeg}deg`,
    "--seat-idle-phase": `${appearance.idlePhaseSeconds}s`,
  };
}
