import { describe, expect, it } from "vitest";
import {
  cameraPose,
  DEALER_ANGLE_DEGREES,
  dealerStation,
  EYE_HEIGHT,
  heroStationIndex,
  MAX_PAN,
  MAX_YAW_RADIANS,
  PLAYER_ANGLES_DEGREES,
  PLAYER_STATION_COUNT,
  playerStations,
  stationAsPose,
  stationIndexForRelativeSeat,
  TABLE_ANCHORS,
  TABLE_COMPOSITION_ID,
  TABLE_DEPTH,
  TABLE_RAIL_WIDTH,
  TABLE_WIDTH,
  CAMERA_VERTICAL_FOV,
  CAMERA_PITCH_DEGREES,
} from "./tableStations";

const DEG = Math.PI / 180;

/** Mirrors the renderer's projection, so framing can be asserted without a GPU. */
function project(
  world: readonly [number, number, number],
  camera: ReturnType<typeof cameraPose>,
  aspect: number,
): { x: number; y: number; depth: number } {
  const forward = [
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ];
  const length = Math.hypot(...forward) || 1;
  const f = forward.map((value) => value / length);
  const rightLength = Math.hypot(f[2], f[0]) || 1;
  const r = [-f[2] / rightLength, 0, f[0] / rightLength];
  const u = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ];
  const d = [
    world[0] - camera.position[0],
    world[1] - camera.position[1],
    world[2] - camera.position[2],
  ];
  const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const halfTangent = Math.tan((camera.fov * DEG) / 2);
  return {
    x: ((d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / (depth * halfTangent * aspect) + 1) / 2 * 100,
    y: (1 - (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (depth * halfTangent)) / 2 * 100,
    depth,
  };
}

const onScreen = (p: { x: number; y: number; depth: number }) =>
  p.depth > 0.15 && p.x > 1 && p.x < 99 && p.y > 0 && p.y < 100;

const HEAD_Y = 1.2;

describe("seated-ring-v3 puts the hero in a player seat, not the dealer's spot", () => {
  it("is a six-player ring with a separate dealer station", () => {
    expect(TABLE_COMPOSITION_ID).toBe("seated-ring-v3");
    expect(PLAYER_STATION_COUNT).toBe(6);
    expect(playerStations()).toHaveLength(6);
    // The dealer holds the far long side and is not one of the six.
    expect(DEALER_ANGLE_DEGREES).toBe(180);
    const dealer = dealerStation();
    expect(dealer.position[2]).toBeLessThan(0);
    for (const station of playerStations()) {
      expect(Math.hypot(
        station.position[0] - dealer.position[0],
        station.position[2] - dealer.position[2],
      )).toBeGreaterThan(0.6);
    }
  });

  it("leaves room for shoulders between neighbours", () => {
    const stations = playerStations();
    for (let i = 0; i < stations.length; i += 1) {
      for (let j = i + 1; j < stations.length; j += 1) {
        expect(Math.hypot(
          stations[i].position[0] - stations[j].position[0],
          stations[i].position[2] - stations[j].position[2],
        )).toBeGreaterThan(0.5);
      }
    }
  });

  it("seats every station outside the rail and anchors its felt inside it", () => {
    const outerA = TABLE_WIDTH / 2 + TABLE_RAIL_WIDTH;
    const outerB = TABLE_DEPTH / 2 + TABLE_RAIL_WIDTH;
    for (const station of [...playerStations(), dealerStation()]) {
      // Outside the table in at least one axis, i.e. not sitting on the felt.
      const inside =
        Math.abs(station.position[0]) <= outerA && Math.abs(station.position[2]) <= outerB;
      expect(inside).toBe(false);
      expect(Math.abs(station.feltPosition[0])).toBeLessThan(TABLE_WIDTH / 2);
      expect(Math.abs(station.feltPosition[2])).toBeLessThan(TABLE_DEPTH / 2);
    }
  });

  it("faces every body at the middle of the table", () => {
    for (const station of [...playerStations(), dealerStation()]) {
      const ahead: readonly [number, number] = [
        station.position[0] + Math.sin(station.facing) * 0.1,
        station.position[2] + Math.cos(station.facing) * 0.1,
      ];
      expect(Math.hypot(ahead[0], ahead[1]))
        .toBeLessThan(Math.hypot(station.position[0], station.position[2]));
    }
  });

  it("picks a hero seat deterministically and reaches every seat across tables", () => {
    expect(heroStationIndex("event-a")).toBe(heroStationIndex("event-a"));
    const seen = new Set(
      Array.from({ length: 400 }, (_, index) => heroStationIndex(`table-${index}`)),
    );
    expect(seen.size).toBe(PLAYER_STATION_COUNT);
  });

  it("maps hero-relative seats onto stations without collision", () => {
    for (const heroIndex of [0, 1, 2, 3, 4, 5]) {
      expect(stationIndexForRelativeSeat(0, heroIndex)).toBe(heroIndex);
      const mapped = new Set(
        Array.from({ length: PLAYER_STATION_COUNT }, (_, seat) =>
          stationIndexForRelativeSeat(seat, heroIndex),
        ),
      );
      expect(mapped.size).toBe(PLAYER_STATION_COUNT);
    }
  });
});

describe("the hero's camera is a seated player's eyes", () => {
  it("sits at the hero's own station at eye height, wherever that seat is", () => {
    const stations = playerStations();
    for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
      const camera = cameraPose(0, heroIndex);
      expect(camera.position[1]).toBe(EYE_HEIGHT);
      // Within the eye setback of its own station, and nowhere near any other.
      const own = Math.hypot(
        camera.position[0] - stations[heroIndex].position[0],
        camera.position[2] - stations[heroIndex].position[2],
      );
      expect(own).toBeLessThan(0.2);
      for (let other = 0; other < PLAYER_STATION_COUNT; other += 1) {
        if (other === heroIndex) continue;
        expect(Math.hypot(
          camera.position[0] - stations[other].position[0],
          camera.position[2] - stations[other].position[2],
        )).toBeGreaterThan(own);
      }
    }
  });

  it("never places the hero at the dealer's station", () => {
    const dealer = dealerStation();
    for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
      const camera = cameraPose(0, heroIndex);
      expect(Math.hypot(
        camera.position[0] - dealer.position[0],
        camera.position[2] - dealer.position[2],
      )).toBeGreaterThan(0.6);
    }
  });

  it("looks down at the felt at the specified pitch from every seat", () => {
    for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
      const camera = cameraPose(0, heroIndex);
      const horizontal = Math.hypot(
        camera.position[0] - camera.target[0],
        camera.position[2] - camera.target[2],
      );
      const pitch = Math.atan2(camera.position[1] - camera.target[1], horizontal) / DEG;
      expect(pitch).toBeCloseTo(CAMERA_PITCH_DEGREES, 4);
    }
  });

  it("frames the board, the pot and the hero's own cards from every seat", () => {
    const stations = playerStations();
    for (const aspect of [16 / 9, 1366 / 768, 1024 / 768, 2560 / 1080]) {
      for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
        const camera = cameraPose(0, heroIndex, aspect);
        for (const [label, anchor] of [
          ["board", TABLE_ANCHORS.board],
          ["pot", TABLE_ANCHORS.mainPot],
          ["own cards", stations[heroIndex].feltPosition],
        ] as const) {
          const projected = project(anchor, camera, aspect);
          expect(onScreen(projected), `${label} from seat ${heroIndex} at ${aspect.toFixed(2)}`)
            .toBe(true);
        }
      }
    }
  });

  /*
   * This is the deliberate trade of the v3 seating. At a real seat your immediate
   * neighbours are beside you, so a natural lens cannot hold all five at rest --
   * measured at 3.3 of 5 on average. What must hold is that every opponent is
   * reachable by turning your head, which is what the composition doc's
   * off-screen-actor edge cue exists to support.
   */
  it("reaches every opponent within the head-turn limit from every seat", () => {
    const stations = playerStations();
    for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
      const reachable = new Set<number>();
      for (const pan of [-MAX_PAN, -1, 0, 1, MAX_PAN]) {
        const camera = cameraPose(pan, heroIndex, 16 / 9);
        stations.forEach((station, index) => {
          if (index === heroIndex) return;
          if (onScreen(project([station.position[0], HEAD_Y, station.position[2]], camera, 16 / 9))) {
            reachable.add(index);
          }
        });
      }
      expect(reachable.size, `seat ${heroIndex}`).toBe(PLAYER_STATION_COUNT - 1);
    }
  });

  it("keeps the dealer reachable too, so dealing is visible", () => {
    const dealer = dealerStation();
    for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
      const seen = [-MAX_PAN, -1, 0, 1, MAX_PAN].some((pan) =>
        onScreen(project(
          [dealer.position[0], 1.35, dealer.position[2]],
          cameraPose(pan, heroIndex, 16 / 9),
          16 / 9,
        )),
      );
      expect(seen, `dealer from seat ${heroIndex}`).toBe(true);
    }
  });

  it("clamps the head turn and stays in the same chair through a pan", () => {
    for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
      const centre = cameraPose(0, heroIndex).position;
      for (const pan of [-99, -2, -1, 1, 2, 99]) {
        const camera = cameraPose(pan, heroIndex);
        expect(camera.position).toEqual(centre);
        expect(Math.abs(camera.yaw)).toBeLessThanOrEqual(MAX_YAW_RADIANS + 1e-9);
      }
      expect(cameraPose(99, heroIndex).yaw).toBeCloseTo(MAX_YAW_RADIANS, 6);
      expect(cameraPose(-99, heroIndex).yaw).toBeCloseTo(-MAX_YAW_RADIANS, 6);
    }
  });

  it("uses one lens for every seat and aspect", () => {
    for (const aspect of [16 / 9, 4 / 3, 21 / 9]) {
      for (let heroIndex = 0; heroIndex < PLAYER_STATION_COUNT; heroIndex += 1) {
        expect(cameraPose(0, heroIndex, aspect).fov).toBe(CAMERA_VERTICAL_FOV);
      }
    }
  });
});

describe("dealt objects originate with the dealer", () => {
  it("puts the shoe and muck on the dealer's side of the felt", () => {
    const dealer = dealerStation();
    for (const anchor of [TABLE_ANCHORS.dealerShoe, TABLE_ANCHORS.muck]) {
      // Same side of the table as the dealer, and on the playing surface.
      expect(Math.sign(anchor[2])).toBe(Math.sign(dealer.position[2]));
      expect(Math.abs(anchor[0])).toBeLessThan(TABLE_WIDTH / 2);
      expect(Math.abs(anchor[2])).toBeLessThan(TABLE_DEPTH / 2);
    }
  });

  it("adapts a station to the shape the object-motion helpers consume", () => {
    const station = playerStations()[2];
    const pose = stationAsPose(station, 2);
    expect(pose.seat).toBe(2);
    expect(pose.position).toEqual(station.position);
    expect(pose.feltPosition).toEqual(station.feltPosition);
    expect(pose.facing).toBe(station.facing);
  });
});
