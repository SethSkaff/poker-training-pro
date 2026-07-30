import { describe, expect, it } from "vitest";
import {
  BODY_PROPORTIONS,
  FACE_PROPORTIONS,
  HAIR_PARTS,
  HEAD_RADIUS,
  bodyProportions,
  faceProportions,
  hairParts,
  headCentreHeight,
  MAX_HEIGHT_SCALE,
  MAX_SEATED_HEAD_HEIGHT,
} from "./characterModel";
import {
  describeOpponentCharacter,
  FEMALE_BODY_TYPES,
  FEMALE_HAIR_STYLES,
  hairColorAt,
  MALE_BODY_TYPES,
  MALE_HAIR_STYLES,
} from "../lib/opponentAppearance";

const identities = Array.from({ length: 600 }, (_, index) => `player-${index}`);

describe("the character library covers the owner's specified set", () => {
  it("has five male and three female body families", () => {
    expect(MALE_BODY_TYPES).toHaveLength(5);
    expect(FEMALE_BODY_TYPES).toHaveLength(3);
    for (const body of MALE_BODY_TYPES) {
      expect(BODY_PROPORTIONS[`male:${body}`]).toBeDefined();
    }
    for (const body of FEMALE_BODY_TYPES) {
      expect(BODY_PROPORTIONS[`female:${body}`]).toBeDefined();
    }
  });

  it("has five hair styles for each presented gender", () => {
    expect(MALE_HAIR_STYLES).toHaveLength(5);
    expect(FEMALE_HAIR_STYLES).toHaveLength(5);
    for (const style of MALE_HAIR_STYLES) {
      expect(hairParts("male", style).length).toBeGreaterThan(0);
    }
    for (const style of FEMALE_HAIR_STYLES) {
      expect(hairParts("female", style).length).toBeGreaterThan(0);
    }
  });

  it("gives every hair style a cap that cannot enclose the face", () => {
    for (const [key, parts] of Object.entries(HAIR_PARTS)) {
      const caps = parts.filter((part) => part.kind === "cap");
      expect(caps.length, `${key} needs a cap`).toBeGreaterThan(0);
      for (const cap of caps) {
        if (cap.kind !== "cap") continue;
        // A cap that floors below the chin would swallow the whole head.
        expect(cap.floorY).toBeGreaterThan(-HEAD_RADIUS);
      }
    }
  });

  /*
   * The regression this guards: Blender is Z-up with +Y running back through the
   * head, and porting those offsets into the renderer's Y-up frame turned "behind
   * the head" into "in front of the face". A ponytail hung down over the nose and
   * read as a limb crossing the face. +Z is forward here, so a long strand must
   * never be placed there.
   */
  it("keeps hanging hair behind the face, never across it", () => {
    for (const [key, parts] of Object.entries(HAIR_PARTS)) {
      for (const part of parts) {
        if (part.kind === "strand") {
          expect(part.offset[2], `${key} strand must hang behind the head`)
            .toBeLessThan(0);
        }
        if (part.kind === "blob") {
          // A blob may sit forward as a fringe, but only high on the skull where
          // a hairline actually is -- not down over the eyes and nose.
          if (part.offset[2] > 0) {
            expect(part.offset[1], `${key} forward blob must sit at the hairline`)
              .toBeGreaterThan(HEAD_RADIUS * 0.4);
          }
        }
      }
    }
  });

  it("varies every face preset's silhouette rather than only its colour", () => {
    const signatures = new Set(
      Object.values(FACE_PROPORTIONS).map((face) => JSON.stringify(face)),
    );
    expect(signatures.size).toBe(Object.keys(FACE_PROPORTIONS).length);
  });
});

describe("hair colour is a gradient, not a short list", () => {
  it("returns a well-formed hex colour across the whole range", () => {
    for (const t of [0, 0.13, 0.5, 0.77, 1]) {
      expect(hairColorAt(t)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("clamps out-of-range input rather than producing NaN channels", () => {
    expect(hairColorAt(-3)).toMatch(/^#[0-9a-f]{6}$/);
    expect(hairColorAt(9)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("moves continuously, so neighbouring identities are not forced to match", () => {
    // The defect this replaces: a six-entry list meant a six-handed table hit a
    // duplicate hair colour constantly.
    const shades = new Set(identities.map((id) => describeOpponentCharacter(id).hairColor));
    expect(shades.size).toBeGreaterThan(200);
  });
});

describe("characters are per-identity and independent of behaviour", () => {
  it("takes only the player id", () => {
    expect(describeOpponentCharacter.length).toBe(1);
  });

  it("is stable for an identity so a player keeps their look as seats rotate", () => {
    for (const id of identities.slice(0, 25)) {
      expect(describeOpponentCharacter(id)).toEqual(describeOpponentCharacter(id));
    }
  });

  it("only ever picks a body and hair style that exist for that gender", () => {
    for (const id of identities) {
      const character = describeOpponentCharacter(id);
      const bodies: readonly string[] =
        character.gender === "male" ? MALE_BODY_TYPES : FEMALE_BODY_TYPES;
      const hair: readonly string[] =
        character.gender === "male" ? MALE_HAIR_STYLES : FEMALE_HAIR_STYLES;
      expect(bodies).toContain(character.body);
      expect(hair).toContain(character.hairStyle);
      // And the geometry lookups must resolve without falling back.
      expect(BODY_PROPORTIONS[`${character.gender}:${character.body}`]).toBeDefined();
      expect(hairParts(character.gender, character.hairStyle).length).toBeGreaterThan(0);
    }
  });

  it("varies across a realistic pool so a table is not five clones", () => {
    const seen = {
      gender: new Set<string>(),
      body: new Set<string>(),
      hairStyle: new Set<string>(),
      face: new Set<string>(),
      outfit: new Set<string>(),
      height: new Set<number>(),
    };
    for (const id of identities) {
      const character = describeOpponentCharacter(id);
      seen.gender.add(character.gender);
      seen.body.add(`${character.gender}:${character.body}`);
      seen.hairStyle.add(`${character.gender}:${character.hairStyle}`);
      seen.face.add(character.face);
      seen.outfit.add(character.outfit.name);
      seen.height.add(character.heightScale);
    }
    expect(seen.gender.size).toBe(2);
    expect(seen.body.size).toBe(8);
    expect(seen.hairStyle.size).toBe(10);
    expect(seen.face.size).toBe(Object.keys(FACE_PROPORTIONS).length);
    expect(seen.outfit.size).toBeGreaterThanOrEqual(8);
    expect(seen.height.size).toBeGreaterThan(20);
  });
});

describe("seated proportions stay inside the camera's head envelope", () => {
  /*
   * The composition solver reserves horizontal frame room for a near seat's head.
   * It now derives that height from MAX_SEATED_HEAD_HEIGHT rather than a
   * hard-coded 1.13, which disagreed with these proportions by about 0.14 m -- the
   * same class of mismatch that produced the clipped near-seat heads in r27.
   */
  it("keeps every body family's head near the height the solver reserves for", () => {
    for (const key of Object.keys(BODY_PROPORTIONS)) {
      const [gender, body] = key.split(":");
      const proportions = bodyProportions(gender, body);
      for (const heightScale of [0.96, 1.0, MAX_HEIGHT_SCALE]) {
        const centre = headCentreHeight(proportions, heightScale);
        // A seated head on a 0.50 m chair pan with a short neck; the range is the
        // real spread of the eight body families, not an arbitrary window. The
        // point of the assertion is that MAX_SEATED_HEAD_HEIGHT bounds it, so the
        // camera solver and the renderer cannot disagree.
        expect(centre).toBeGreaterThan(1.10);
        expect(centre).toBeLessThanOrEqual(MAX_SEATED_HEAD_HEIGHT);
      }
    }
  });

  it("hands the camera solver the highest head any identity can produce", () => {
    // If this were lower than a real head, the solver would reserve too little
    // horizontal room and clip a near seat at the frame edge.
    for (const key of Object.keys(BODY_PROPORTIONS)) {
      const [gender, body] = key.split(":");
      expect(headCentreHeight(bodyProportions(gender, body), MAX_HEIGHT_SCALE))
        .toBeLessThanOrEqual(MAX_SEATED_HEAD_HEIGHT);
    }
  });

  it("falls back to a real body and face for an unknown name", () => {
    expect(bodyProportions("other", "nonexistent")).toEqual(
      BODY_PROPORTIONS["male:average"],
    );
    expect(faceProportions("nonexistent")).toEqual(FACE_PROPORTIONS.narrow);
    expect(hairParts("other", "nonexistent")).toEqual([]);
  });
});
