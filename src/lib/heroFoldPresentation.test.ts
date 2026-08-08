import { describe, expect, it } from "vitest";
import {
  areHeroCardsMucked,
  canStartHeroGesture,
  foldOffsetProgress,
  isFoldReleaseArmed,
  shouldShowFoldRelease,
  type HeroFoldState,
} from "./heroFoldPresentation";

const idle: HeroFoldState = {
  dragging: false,
  foldProgress: 0,
  action: null,
  seatStatus: "active",
};

describe("the fold-release affordance belongs to the gesture that raised it", () => {
  it("is hidden while idle", () => {
    expect(shouldShowFoldRelease(idle)).toBe(false);
  });

  it("appears once a real drag passes the threshold", () => {
    expect(
      shouldShowFoldRelease({ ...idle, dragging: true, foldProgress: 40 }),
    ).toBe(true);
  });

  it("stays hidden for a drag that has barely started", () => {
    expect(
      shouldShowFoldRelease({ ...idle, dragging: true, foldProgress: 4 }),
    ).toBe(false);
  });

  it("arms only past the commit threshold", () => {
    const armed = { ...idle, dragging: true, foldProgress: 90 };
    const unarmed = { ...idle, dragging: true, foldProgress: 50 };
    expect(isFoldReleaseArmed(armed)).toBe(true);
    expect(isFoldReleaseArmed(unarmed)).toBe(false);
  });

  /*
    The exact regression. A fold submitted by BUTTON used to write
    `foldProgress = 100` to drive the card slide. The banner keyed off that
    number and `!action`, so the moment the engine's next update cleared the
    submitted action the drag banner appeared -- with no pointer down, seconds
    after the click -- and stayed up through the showdown and into the next
    hand. Reproduced in the packaged build on 2026-07-26.
  */
  it("never appears from a button fold, at any leftover progress value", () => {
    for (const foldProgress of [0, 11, 82, 100]) {
      // While the action is pending.
      expect(
        shouldShowFoldRelease({
          ...idle,
          dragging: false,
          foldProgress,
          action: "fold",
        }),
      ).toBe(false);
      // And after the engine clears it, which is when the banner used to appear.
      expect(
        shouldShowFoldRelease({
          ...idle,
          dragging: false,
          foldProgress,
          action: null,
          seatStatus: "folded",
        }),
      ).toBe(false);
    }
  });

  it("walks the whole reported sequence without ever raising the banner", () => {
    // 1. Hero's turn.
    let state: HeroFoldState = { ...idle };
    expect(shouldShowFoldRelease(state)).toBe(false);
    // 2. Hero clicks the Fold button; no gesture is involved.
    state = { ...state, action: "fold" };
    expect(shouldShowFoldRelease(state)).toBe(false);
    expect(areHeroCardsMucked(state)).toBe(true);
    // 3. An opponent acts: the engine clears the submitted action. This is the
    //    frame where the banner used to appear.
    state = { ...state, action: null, seatStatus: "folded" };
    expect(shouldShowFoldRelease(state)).toBe(false);
    expect(areHeroCardsMucked(state)).toBe(true);
    // 4. Showdown, still folded.
    expect(shouldShowFoldRelease(state)).toBe(false);
    // 5. Next hand: seat is active again and nothing is left over.
    state = { ...idle };
    expect(shouldShowFoldRelease(state)).toBe(false);
    expect(areHeroCardsMucked(state)).toBe(false);
  });
});

describe("mucked cards stay mucked for the rest of the hand", () => {
  it("mucks on the submitting frame, before the engine answers", () => {
    expect(areHeroCardsMucked({ ...idle, action: "fold" })).toBe(true);
  });

  it("stays mucked once the engine reports the seat folded", () => {
    // The regression: this used to be derived from the submitted action alone,
    // which the next engine update cleared, so the cards came back.
    expect(
      areHeroCardsMucked({ ...idle, action: null, seatStatus: "folded" }),
    ).toBe(true);
  });

  it("is not mucked for a hero who is still in the hand", () => {
    expect(areHeroCardsMucked(idle)).toBe(false);
    expect(areHeroCardsMucked({ ...idle, action: "call" })).toBe(false);
    expect(areHeroCardsMucked({ ...idle, seatStatus: "all-in" })).toBe(false);
  });

  it("refuses a new gesture on a mucked hand", () => {
    expect(canStartHeroGesture(idle)).toBe(true);
    expect(
      canStartHeroGesture({ ...idle, action: null, seatStatus: "folded" }),
    ).toBe(false);
    expect(canStartHeroGesture({ ...idle, action: "fold" })).toBe(false);
  });
});

describe("the cards rest in the same place however the fold was submitted", () => {
  it("rests at the commit threshold after a button fold", () => {
    expect(foldOffsetProgress({ ...idle, action: "fold" })).toBe(82);
  });

  it("rests at the commit threshold after a dragged fold", () => {
    expect(
      foldOffsetProgress({ ...idle, seatStatus: "folded", foldProgress: 95 }),
    ).toBe(82);
  });

  it("tracks the gesture while dragging", () => {
    expect(
      foldOffsetProgress({ ...idle, dragging: true, foldProgress: 40 }),
    ).toBe(40);
  });

  it("ignores stale progress when no gesture is active", () => {
    // A leftover value must not silently displace the cards.
    expect(foldOffsetProgress({ ...idle, foldProgress: 70 })).toBe(0);
  });
});
