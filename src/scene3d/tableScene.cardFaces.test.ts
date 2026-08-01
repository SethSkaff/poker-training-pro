import { describe, expect, it } from "vitest";
import { cardWithFaces } from "./tableScene";
import { tableMeshGeometry } from "./tableGeometryLibrary";

/*
  A card has to be able to be two things at once.

  The authored mesh is a single material group, so a card could only ever be
  entirely its back or entirely its face. That is why showing the hero their own
  hand used to mean turning the card over -- and showing it to the whole table
  at the same time. Splitting by facing is what lets a card be face down to the
  room and readable to the one player tilting it.
*/
describe("two-sided cards", () => {
  it("splits a card into back, print and edge", () => {
    const source = tableMeshGeometry("card");
    const split = cardWithFaces(source);
    expect(split.groups).toHaveLength(3);

    const total = split.groups.reduce((sum, group) => sum + group.count, 0);
    // Every triangle is accounted for exactly once: none dropped, none doubled.
    expect(total).toBe(source.getIndex()?.count);

    // Contiguous and in order, which is what makes them valid draw ranges.
    let cursor = 0;
    for (const group of split.groups) {
      expect(group.start).toBe(cursor);
      cursor += group.count;
    }

    /*
      A slab has as many triangles facing one way as the other, so back and
      print must match exactly -- that equality is the real check that the
      split found the two sides rather than mis-binning part of one. The rim
      legitimately outnumbers both: it is a rounded rectangle swept around the
      outline, while each flat side is a coarse fan.
    */
    const [back, print, edge] = split.groups;
    expect(print.count).toBe(back.count);
    expect(back.count).toBeGreaterThan(0);
    expect(edge.count).toBeGreaterThan(0);
  });

  it("returns the same split for the same geometry rather than rebuilding it", () => {
    const source = tableMeshGeometry("card");
    const split = cardWithFaces(source);
    // Not the source handed straight back: that would silently give every group
    // the same material and put the print on the side facing the room.
    expect(split).not.toBe(source);
    expect(split.groups).toHaveLength(3);
    expect(cardWithFaces(source)).toBe(split);
  });

  it("assigns each group its own material slot", () => {
    const split = cardWithFaces(tableMeshGeometry("card"));
    expect(split.groups.map((group) => group.materialIndex)).toEqual([0, 1, 2]);
  });
});
