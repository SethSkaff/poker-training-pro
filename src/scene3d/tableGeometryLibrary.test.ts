import { describe, expect, it } from "vitest";
import {
  TABLE_MESH_NAMES,
  tableMeshGeometry,
  tableMeshTriangles,
  type TableMeshName,
} from "./tableGeometryLibrary";
import {
  playerStations,
  stationLedgeAnchor,
  TABLE_DEPTH,
  TABLE_RAIL_WIDTH,
  TABLE_WIDTH,
} from "./tableStations";

function bounds(name: TableMeshName) {
  const geometry = tableMeshGeometry(name);
  const positions = geometry.getAttribute("position");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.count; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions.getComponent(index, axis);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  geometry.dispose();
  return { min, max };
}

describe("authored table geometry", () => {
  it("ships every mesh the renderer builds the table from", () => {
    expect(TABLE_MESH_NAMES.sort()).toEqual([
      "card",
      "card/peeked",
      "chip/body",
      "chip/edge",
      "hand/peek",
      "table/felt",
      "table/ledge",
      "table/pedestal",
      "table/play-zone",
      "table/print",
      "table/rail",
      "table/seat-inlay",
      "table/trim",
    ]);
  });

  it("decodes positions, normals, and indices", () => {
    const geometry = tableMeshGeometry("table/rail");
    expect(geometry.getAttribute("position").count).toBeGreaterThan(100);
    expect(geometry.getAttribute("normal").count).toBe(geometry.getAttribute("position").count);
    expect(geometry.getIndex()?.count).toBe(tableMeshTriangles("table/rail") * 3);
    geometry.dispose();
  });

  /*
    The exporter converts Blender's Z-up authoring to the scene's Y-up axes. A
    silent regression there would rotate the whole table onto its side, so the
    felt's own extents are the assertion: wide in x, deep in z, flat in y.
  */
  it("arrives in scene space with the felt plane at y=0", () => {
    const felt = bounds("table/felt");
    expect(felt.max[0]).toBeCloseTo(TABLE_WIDTH / 2, 2);
    expect(felt.min[0]).toBeCloseTo(-TABLE_WIDTH / 2, 2);
    expect(felt.max[2]).toBeCloseTo(TABLE_DEPTH / 2, 2);
    expect(felt.min[2]).toBeCloseTo(-TABLE_DEPTH / 2, 2);
    expect(felt.max[1]).toBeCloseTo(0, 3);
    expect(felt.min[1]).toBeLessThan(0);
  });

  it("keeps the three-zone top inside the composition's rail width", () => {
    const outer = TABLE_WIDTH / 2 + TABLE_RAIL_WIDTH;
    for (const name of ["table/felt", "table/ledge", "table/rail", "table/trim"] as const) {
      const zone = bounds(name);
      expect(zone.max[0]).toBeLessThanOrEqual(outer + 1e-3);
      expect(zone.max[2]).toBeLessThanOrEqual(TABLE_DEPTH / 2 + TABLE_RAIL_WIDTH + 1e-3);
    }
    // Each zone must actually reach further out than the one it sits inside,
    // or the top reads as one flat oval again.
    expect(bounds("table/ledge").max[0]).toBeGreaterThan(bounds("table/felt").max[0]);
    expect(bounds("table/rail").max[0]).toBeGreaterThan(bounds("table/ledge").max[0]);
  });

  it("prints felt graphics flush with the felt, never above the ledge", () => {
    const print = bounds("table/print");
    const ledge = bounds("table/ledge");
    expect(print.max[1]).toBeGreaterThan(0);
    expect(print.max[1]).toBeLessThan(ledge.max[1]);
    expect(print.max[1]).toBeLessThan(0.005);
  });

  it("hangs the pedestal entirely below the felt", () => {
    const pedestal = bounds("table/pedestal");
    expect(pedestal.max[1]).toBeLessThan(0);
    expect(pedestal.min[1]).toBeCloseTo(-0.76, 2);
  });

  it("models a card at the real 0.714 card ratio with a mapped face", () => {
    const card = bounds("card");
    const width = card.max[0] - card.min[0];
    const length = card.max[2] - card.min[2];
    expect(width / length).toBeCloseTo(0.714, 2);
    expect(card.max[1] - card.min[1]).toBeLessThan(0.005);
    const geometry = tableMeshGeometry("card");
    const uv = geometry.getAttribute("uv");
    expect(uv.count).toBe(geometry.getAttribute("position").count);
    let minU = Infinity;
    let maxU = -Infinity;
    for (let index = 0; index < uv.count; index += 1) {
      minU = Math.min(minU, uv.getX(index));
      maxU = Math.max(maxU, uv.getX(index));
    }
    expect(minU).toBeCloseTo(0, 2);
    expect(maxU).toBeCloseTo(1, 2);
    geometry.dispose();
  });

  it("models a chip whose edge spots stand proud of the body", () => {
    const body = bounds("chip/body");
    const edge = bounds("chip/edge");
    expect(body.max[0] - body.min[0]).toBeCloseTo(0.048, 3);
    expect(body.max[1] - body.min[1]).toBeCloseTo(0.0035, 4);
    expect(edge.max[0]).toBeGreaterThan(body.max[0]);
    // The spots are a band around the rim, not a second full-height cylinder.
    expect(edge.max[1] - edge.min[1]).toBeLessThan(body.max[1] - body.min[1]);
  });

  /*
    The seat medallion has to land on the hard ledge shelf. The felt top is a
    capsule, so scaling ellipse semi-axes -- the obvious way to walk out along a
    seat's bearing -- misses it by up to 27 mm at the corner stations and drops
    the inlay onto the felt chamfer instead.
  */
  it("inlays every seat medallion on the ledge shelf, not on the felt", () => {
    const felt = bounds("table/felt");
    const ledge = bounds("table/ledge");
    for (const station of playerStations()) {
      const anchor = stationLedgeAnchor(station);
      const straight = TABLE_WIDTH / 2 - TABLE_DEPTH / 2;
      const clamped = Math.min(straight, Math.max(-straight, anchor[0]));
      const distance = Math.hypot(anchor[0] - clamped, anchor[2]);
      // Between the felt's own outline and the ledge's outer edge.
      expect(distance).toBeGreaterThan(TABLE_DEPTH / 2);
      expect(distance).toBeLessThan(TABLE_DEPTH / 2 + (ledge.max[2] - felt.max[2]));
    }
  });

  /*
    The squeezed card must be the same card, only bent: same outline, same
    thickness, same UVs. If it drifted in size the faces would jump when a
    player pressed to look at their hand.
  */
  it("bends the peeked card up at one corner without resizing it", () => {
    const flat = bounds("card");
    const peeked = bounds("card/peeked");
    expect(peeked.max[0] - peeked.min[0]).toBeCloseTo(flat.max[0] - flat.min[0], 4);
    expect(peeked.max[2] - peeked.min[2]).toBeCloseTo(flat.max[2] - flat.min[2], 4);
    // Lifted, and lifted at exactly one corner rather than tilted as a whole.
    expect(peeked.max[1]).toBeGreaterThan(flat.max[1] + 0.02);
    expect(peeked.min[1]).toBeCloseTo(flat.min[1], 4);
  });

  it("models a hand at human scale", () => {
    const hand = bounds("hand/peek");
    const length = hand.max[2] - hand.min[2];
    const width = hand.max[0] - hand.min[0];
    expect(length).toBeGreaterThan(0.15);
    expect(length).toBeLessThan(0.24);
    expect(width).toBeGreaterThan(0.06);
    expect(width).toBeLessThan(0.13);
  });

  it("stays well inside the scene triangle budget when instanced", () => {
    const total = TABLE_MESH_NAMES.reduce((sum, name) => sum + tableMeshTriangles(name), 0);
    expect(total).toBeLessThan(6_000);
  });
});
