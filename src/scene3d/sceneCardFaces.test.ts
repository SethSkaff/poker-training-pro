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
    expect(proceduralCardFaceBytes() * 52 / 1024 / 1024).toBeLessThan(3);
    expect(proceduralTableMarkerBytes() * 3 / 1024 / 1024).toBeLessThan(0.1);
  });
});
