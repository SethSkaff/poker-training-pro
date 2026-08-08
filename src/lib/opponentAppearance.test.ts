import { describe, expect, it } from "vitest";
import {
  ACCESSORIES,
  AGE_PRESENTATIONS,
  BODY_TYPES,
  CLOTHING,
  FACE_SHAPES,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFITS,
  POSTURES,
  SKIN_TONES,
  describeOpponentAppearance,
  opponentAppearanceStyle,
} from "./opponentAppearance";

const ids = Array.from({ length: 400 }, (_, index) => `opponent-${index}`);

describe("opponent appearance", () => {
  it("is stable per identity, so a player keeps their face as seats rotate", () => {
    // The original defect was the opposite: appearance was keyed to seat slot,
    // so the same named opponent changed face whenever the button moved.
    for (const id of ids.slice(0, 20)) {
      expect(describeOpponentAppearance(id)).toEqual(
        describeOpponentAppearance(id),
      );
    }
    expect(describeOpponentAppearance("alex-moreno")).not.toEqual(
      describeOpponentAppearance("blair-woods"),
    );
  });

  it("cannot correlate with behavior because behavior is not an input", () => {
    // Structural guarantee, asserted rather than assumed: the function takes a
    // single string. There is no rating, profile, stack, position, or mode in
    // scope, so no appearance dimension can encode how a player plays.
    expect(describeOpponentAppearance.length).toBe(1);

    // And behaviorally: two entrants that differ in every behavioral field but
    // share an id are visually identical.
    const aggressive = { id: "kai-santos", rating: 1_480, profile: "maniac" };
    const passive = { id: "kai-santos", rating: 1_003, profile: "rock" };
    expect(describeOpponentAppearance(aggressive.id)).toEqual(
      describeOpponentAppearance(passive.id),
    );
  });

  it("varies every declared dimension across a realistic pool of identities", () => {
    const seen = {
      portrait: new Set<number>(),
      faceShape: new Set<string>(),
      skinTone: new Set<string>(),
      hairStyle: new Set<string>(),
      hairColor: new Set<string>(),
      clothing: new Set<string>(),
      accessory: new Set<string>(),
      bodyType: new Set<string>(),
      agePresentation: new Set<string>(),
      posture: new Set<string>(),
    };
    const combinations = new Set<string>();

    for (const id of ids) {
      const appearance = describeOpponentAppearance(id);
      seen.portrait.add(appearance.portrait);
      seen.faceShape.add(appearance.faceShape);
      seen.skinTone.add(appearance.skinTone);
      seen.hairStyle.add(appearance.hairStyle);
      seen.hairColor.add(appearance.hairColor);
      seen.clothing.add(appearance.clothing.name);
      seen.accessory.add(appearance.accessory);
      seen.bodyType.add(appearance.bodyType);
      seen.agePresentation.add(appearance.agePresentation);
      seen.posture.add(appearance.posture);
      combinations.add(JSON.stringify(appearance));
    }

    expect(seen.portrait.size).toBe(6);
    expect(seen.faceShape.size).toBe(FACE_SHAPES.length);
    expect(seen.skinTone.size).toBe(SKIN_TONES.length);
    expect(seen.hairStyle.size).toBe(HAIR_STYLES.length);
    expect(seen.hairColor.size).toBe(HAIR_COLORS.length);
    expect(seen.clothing.size).toBe(CLOTHING.length);
    expect(seen.accessory.size).toBe(new Set(ACCESSORIES).size);
    expect(seen.bodyType.size).toBe(BODY_TYPES.length);
    expect(seen.agePresentation.size).toBe(AGE_PRESENTATIONS.length);
    expect(seen.posture.size).toBe(POSTURES.length);

    // The dimensions must be genuinely independent, not one hash fanned out:
    // 400 identities should produce close to 400 distinct seated people.
    expect(combinations.size).toBeGreaterThan(360);
  });

  it("emits only CSS custom properties the stylesheet consumes", () => {
    const style = opponentAppearanceStyle(describeOpponentAppearance("gale-hart"));
    expect(Object.keys(style).sort()).toEqual([
      "--seat-cloth",
      "--seat-cloth-trim",
      "--seat-hair",
      "--seat-idle-phase",
      "--seat-lean",
      "--seat-skin",
    ]);
    expect(style["--seat-lean"]).toMatch(/^-?\d+(\.\d+)?deg$/);
    expect(style["--seat-skin"]).toMatch(/^#[0-9a-f]{6}$/);
  });

  /*
    Two outfits used to be tans within a few percent of two of the skin tones, so
    any identity that rolled the pair came out one unbroken colour from collar to
    knuckles and read as a naked person at the table. Torso and sleeves are the
    largest areas of a character; this is the one collision the palette cannot be
    allowed to have, and it is invisible in every other kind of test.
  */
  it("never dresses anyone in their own skin", () => {
    /*
      A garment has to differ from skin in hue *or* in lightness -- not both.

      Neither half works alone, and trying each in turn is how the rule got
      written. Raw RGB distance flagged a dark sage tee against pale skin, which
      nobody could confuse. Hue alone, with lightness divided out, flagged the
      same pair for the opposite reason: both are low-chroma and warm-ish, and
      the 110 points of lightness between them are exactly what separates them.
      Requiring either is the actual perceptual rule. Be honest about the margin
      though: the worst real offender was 40 apart in hue and the closest colour
      worth keeping is 45, so the hue threshold has five points of room and no
      more. A new outfit landing in that gap deserves a look at the frame rather
      than an argument with the number.
    */
    const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    // The two opponent-colour axes: warm-cool and green-magenta, sans lightness.
    const hue = (hex: string) => {
      const [r, g, b] = channels(hex);
      return [r - g, g - b] as const;
    };
    const lightness = (hex: string) => {
      const [r, g, b] = channels(hex);
      return (r + g + b) / 3;
    };
    for (const outfit of OUTFITS) {
      for (const skin of SKIN_TONES) {
        const [ox, oy] = hue(outfit.base);
        const [sx, sy] = hue(skin);
        const hueApart = Math.hypot(ox - sx, oy - sy);
        const lightApart = Math.abs(lightness(outfit.base) - lightness(skin));
        expect(
          hueApart > 44 || lightApart > 60,
          `${outfit.name} (${outfit.base}) reads as bare skin ${skin}: `
            + `${hueApart.toFixed(0)} apart in hue, ${lightApart.toFixed(0)} in lightness`,
        ).toBe(true);
      }
    }
  });

  it("keeps the seated lean small enough that the table stays readable", () => {
    for (const id of ids) {
      const { postureLeanDeg } = describeOpponentAppearance(id);
      expect(Math.abs(postureLeanDeg)).toBeLessThanOrEqual(3);
    }
  });
});
