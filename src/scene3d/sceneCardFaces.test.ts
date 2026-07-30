import { describe, expect, it } from "vitest";
import {
  parsePublicCardFace,
  PROCEDURAL_CARD_FACE_USE_MIPMAPS,
  proceduralTableMarkerBytes,
  proceduralCardFaceBytes,
} from "./sceneCardFaces";

describe("public scene card faces", () => {
  it("accepts both public DOM labels and compact fixture codes", () => {
    expect(parsePublicCardFace("A♠")).toEqual({ rank: "A", suit: "spades", glyph: "♠", red: false });
    expect(parsePublicCardFace("Kd")).toEqual({ rank: "K", suit: "diamonds", glyph: "♦", red: true });
  });

  it("rejects non-card strings instead of creating an unbounded texture cache", () => {
    expect(parsePublicCardFace("Ace of spades")).toBeNull();
    expect(parsePublicCardFace("A♠ private-equity=1")).toBeNull();
    expect(PROCEDURAL_CARD_FACE_USE_MIPMAPS).toBe(false);
    /*
      6 MiB for a full deck of faces, raised from 3 when the faces grew to
      132x186 so a board card lying flat on the felt could be read without a
      floating DOM overlay in front of it. This is a guard against an unbounded
      cache, not the release budget -- the packaged audit measures the scene's
      real decoded texture estimate against 128 MiB.
    */
    expect(proceduralCardFaceBytes() * 52 / 1024 / 1024).toBeLessThan(6);
    expect(proceduralTableMarkerBytes() * 3 / 1024 / 1024).toBeLessThan(0.1);
  });
});
