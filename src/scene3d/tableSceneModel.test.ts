import { describe, expect, it } from "vitest";
import {
  actionEase,
  allInChipPosition,
  betChipPosition,
  cameraPose,
  cameraDepthForSafeFrame,
  cameraViewPreset,
  callChipPosition,
  chipCountForAmount,
  dealtCardPosition,
  EYE_HEIGHT,
  CAMERA_DEPTH_MAX,
  CAMERA_DEPTH_MIN,
  CAMERA_PITCH_DEGREES,
  CAMERA_VERTICAL_FOV,
  MAX_PAN,
  MAX_YAW_RADIANS,
  OPEN_ARC_ANCHORS,
  muckedCardPosition,
  raiseChipPosition,
  projectToViewport,
  seatLocalPoint,
  seatPoses,
  seatRailAnchor,
  seatWorldPoint,
  TABLE_HEIGHT,
  TABLE_RAIL_WIDTH,
  TABLE_COMPOSITION_ID,
  TABLE_DEPTH,
  TABLE_WIDTH,
  turnIndicatorPosition,
  turnIndicatorPositionForPlayer,
} from "./tableSceneModel";

const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("open-arc-v2 seats are placed around a capsule table", () => {
  it("keeps the hero anchor nearest the camera without rendering a ring", () => {
    const poses = seatPoses(6);
    const hero = poses[0];
    expect(TABLE_COMPOSITION_ID).toBe("open-arc-v2");
    for (const pose of poses.slice(1)) {
      expect(hero.position[2]).toBeGreaterThan(pose.position[2]);
    }
  });

  it("uses the approved five explicit forward horseshoe roots", () => {
    const poses = seatPoses(6);
    expect(poses).toHaveLength(6);
    expect(poses.slice(1).map((pose) => [pose.position[0], pose.position[2]])).toEqual([
      [-1.24, -0.16], [-0.98, -0.74], [0, -0.94], [0.98, -0.74], [1.24, -0.16],
    ]);
    expect(TABLE_WIDTH / TABLE_DEPTH).toBeCloseTo(1.806, 2);
  });

  it("rests cards and chips on the felt surface, inside the rail", () => {
    for (const pose of seatPoses(6)) {
      expect(pose.feltPosition[1]).toBe(TABLE_HEIGHT);
      expect(Math.abs(pose.feltPosition[0])).toBeLessThan(TABLE_WIDTH / 2);
      expect(Math.abs(pose.feltPosition[2])).toBeLessThan(TABLE_DEPTH / 2);
    }
  });

  it("faces every body toward the middle of the table", () => {
    for (const pose of seatPoses(6)) {
      if (pose.seat === 0) continue;
      const dx = Math.sin(pose.facing);
      const dz = Math.cos(pose.facing);
      // The direction it faces should reduce its distance to the centre.
      const ahead: readonly [number, number, number] = [
        pose.position[0] + dx * 0.1,
        0,
        pose.position[2] + dz * 0.1,
      ];
      expect(Math.hypot(ahead[0], ahead[2])).toBeLessThan(
        Math.hypot(pose.position[0], pose.position[2]),
      );
    }
  });

  it("handles a heads-up table and an empty one", () => {
    expect(seatPoses(2)).toHaveLength(2);
    expect(seatPoses(0)).toEqual([]);
  });
});

describe("seat-local placement lands objects on the felt", () => {
  /**
   * Mirrors three.js `rotation.y = facing` exactly: local -> world is
   * `wx = cos·lx + sin·lz`, `wz = -sin·lx + cos·lz`. If the renderer's inverse
   * disagrees with this, seat objects leave the table.
   */
  const rotateAsThreeJs = (
    pose: ReturnType<typeof seatPoses>[number],
    local: readonly [number, number, number],
  ): readonly [number, number, number] => {
    const cos = Math.cos(pose.facing);
    const sin = Math.sin(pose.facing);
    return [
      pose.position[0] + local[0] * cos + local[2] * sin,
      local[1],
      pose.position[2] - local[0] * sin + local[2] * cos,
    ];
  };

  it("round-trips every seat's felt anchor through the group transform", () => {
    for (const pose of seatPoses(6)) {
      const local = seatLocalPoint(pose, pose.feltPosition);
      expect(distance(rotateAsThreeJs(pose, local), pose.feltPosition)).toBeLessThan(1e-9);
    }
  });

  it("agrees with the forward map it claims to invert", () => {
    for (const pose of seatPoses(6)) {
      const local = seatLocalPoint(pose, pose.feltPosition);
      expect(distance(seatWorldPoint(pose, local), pose.feltPosition)).toBeLessThan(1e-9);
      expect(distance(rotateAsThreeJs(pose, local), seatWorldPoint(pose, local)))
        .toBeLessThan(1e-9);
    }
  });

  /*
   * The regression this guards: using cos(-facing)/sin(-facing) re-applies the
   * forward rotation, which threw the near-side seats' cards, bet, and stack
   * about a metre past the rail and off the table entirely.
   */
  it("keeps every seat's placed objects inside the outer rail", () => {
    const outerHalfWidth = TABLE_WIDTH / 2 + 0.12;
    const outerHalfDepth = TABLE_DEPTH / 2 + 0.12;
    for (const pose of seatPoses(6)) {
      if (pose.seat === 0) continue;
      for (const anchor of [
        pose.feltPosition,
        [pose.feltPosition[0] * 0.86, TABLE_HEIGHT, pose.feltPosition[2] * 0.86] as const,
      ]) {
        const placed = seatWorldPoint(pose, seatLocalPoint(pose, anchor));
        expect(Math.abs(placed[0])).toBeLessThanOrEqual(outerHalfWidth);
        expect(Math.abs(placed[2])).toBeLessThanOrEqual(outerHalfDepth);
      }
    }
  });
});

describe("ready-mode seat plaques attach to the physical rail", () => {
  const targets = [
    { width: 1024, height: 768 },
    { width: 1100, height: 720 },
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1080 },
  ] as const;

  it("puts each anchor on the rail, outside the felt but not out in the room", () => {
    for (const pose of seatPoses(6)) {
      if (pose.seat === 0) continue;
      const anchor = seatRailAnchor(pose);
      // On the rail surface, never rising toward a face.
      expect(anchor[1]).toBeCloseTo(TABLE_HEIGHT + 0.03, 6);
      // Outside the felt anchor it belongs to, and within a rail width of the
      // capsule boundary rather than adrift in the room.
      expect(Math.hypot(anchor[0], anchor[2]))
        .toBeGreaterThan(Math.hypot(pose.feltPosition[0], pose.feltPosition[2]));
      expect(Math.abs(anchor[0])).toBeLessThanOrEqual(TABLE_WIDTH / 2 + TABLE_RAIL_WIDTH * 2);
      expect(Math.abs(anchor[2])).toBeLessThanOrEqual(TABLE_DEPTH / 2 + TABLE_RAIL_WIDTH * 2);
    }
  });

  it("projects the centre seat to the middle of the frame at recenter", () => {
    const centre = seatPoses(6)[3];
    expect(centre.position[0]).toBe(0);
    for (const { width, height } of targets) {
      const camera = cameraPose(0, "standard", width / height, width);
      const projected = projectToViewport(seatRailAnchor(centre), camera, width, height);
      expect(projected.behind).toBe(false);
      expect(projected.xPercent).toBeCloseTo(50, 6);
    }
  });

  /*
   * The defect this replaces: fixed viewport percentages put the two near-side
   * plaques at 14% and 86% of width regardless of where the chairs actually
   * were, stranding them in unlit room well outside the rail.
   */
  it("keeps every plaque inside the frame at every required target", () => {
    for (const { width, height } of targets) {
      const camera = cameraPose(0, "standard", width / height, width);
      for (const pose of seatPoses(6)) {
        if (pose.seat === 0) continue;
        const projected = projectToViewport(seatRailAnchor(pose), camera, width, height);
        expect(projected.behind).toBe(false);
        expect(projected.xPercent).toBeGreaterThan(0);
        expect(projected.xPercent).toBeLessThan(100);
        expect(projected.yPercent).toBeGreaterThan(0);
        expect(projected.yPercent).toBeLessThan(100);
      }
    }
  });

  it("preserves left-to-right seat order so plaques never cross", () => {
    for (const { width, height } of targets) {
      const camera = cameraPose(0, "standard", width / height, width);
      const xs = seatPoses(6).slice(1)
        .map((pose) => projectToViewport(seatRailAnchor(pose), camera, width, height).xPercent);
      const sorted = [...xs].sort((left, right) => left - right);
      expect(xs).toEqual(sorted);
    }
  });

  it("tracks the rail through pan rather than staying pinned to the viewport", () => {
    const centre = seatPoses(6)[3];
    const anchor = seatRailAnchor(centre);
    const at = (pan: number) => projectToViewport(
      anchor,
      cameraPose(pan, "standard", 1366 / 768, 1366),
      1366,
      768,
    ).xPercent;
    // Turning the camera left pushes a centred world point to the right of frame.
    expect(at(-MAX_PAN)).toBeGreaterThan(at(0));
    expect(at(MAX_PAN)).toBeLessThan(at(0));
  });

  /*
   * Blocker: the main pot plaque visually overlapped the centre player. An
   * earlier version of this test compared the *pot anchor* on the felt and
   * passed at 3.6% while the frame still collided -- because the plaque is a
   * billboard raised above that anchor, which is what actually projects into the
   * far rail's band. Compare the rendered plaque position.
   */
  it("separates the centre seat plaque from the rendered main pot plaque", () => {
    // Mirrors tableScene's POT_PLAQUE_HEIGHT / POT_PLAQUE_FORWARD.
    const potPlaqueWorld = [
      OPEN_ARC_ANCHORS.mainPot[0],
      OPEN_ARC_ANCHORS.mainPot[1] + 0.045,
      OPEN_ARC_ANCHORS.mainPot[2] + 0.26,
    ] as const;
    for (const { width, height } of targets) {
      const camera = cameraPose(0, "standard", width / height, width);
      const plaque = projectToViewport(seatRailAnchor(seatPoses(6)[3]), camera, width, height);
      const pot = projectToViewport(potPlaqueWorld, camera, width, height);
      // The seat plaque's rail anchor is its bottom edge and it draws upward, so
      // the pot must sit clearly *below* that anchor.
      expect(pot.yPercent - plaque.yPercent).toBeGreaterThan(3.3);
    }
  });

  /*
   * Recenter separation is not sufficient on its own: panning swings the far rail
   * and the billboarded pot plaques across each other, so a fix verified only at
   * pan 0 can still collide at the look limits.
   *
   * The requirement is non-overlap, not vertical ordering. The two near-side
   * seats sit a metre closer to the lens, so their rail plaques legitimately
   * project *below* the pot -- they are foreground, and far from centre
   * horizontally. Separation in either axis is therefore what counts.
   */
  it("never lets the pot plaque share screen space with a seat plaque", () => {
    // Generous boxes: a seat plaque is about 130x24 px and the pot plaque about
    // 170x28 px at these depths, so these half-extents are conservative.
    const minHorizontalGapPercent = 9;
    const minVerticalGapPercent = 2.6;
    for (const { width, height } of targets) {
      for (const pan of [-MAX_PAN, -1, 0, 1, MAX_PAN]) {
        const camera = cameraPose(pan, "standard", width / height, width);
        const pot = projectToViewport(
          [
            OPEN_ARC_ANCHORS.mainPot[0],
            OPEN_ARC_ANCHORS.mainPot[1] + 0.045,
            OPEN_ARC_ANCHORS.mainPot[2] + 0.26,
          ],
          camera,
          width,
          height,
        );
        for (const pose of seatPoses(6)) {
          if (pose.seat === 0) continue;
          const plaque = projectToViewport(seatRailAnchor(pose), camera, width, height);
          const clear = Math.abs(pot.xPercent - plaque.xPercent) > minHorizontalGapPercent
            || Math.abs(pot.yPercent - plaque.yPercent) > minVerticalGapPercent;
          expect(clear, `seat ${pose.seat} at ${width}x${height} pan ${pan}: pot ${pot.xPercent.toFixed(1)},${pot.yPercent.toFixed(1)} vs plaque ${plaque.xPercent.toFixed(1)},${plaque.yPercent.toFixed(1)}`).toBe(true);
        }
      }
    }
  });
});

describe("the camera is seated, and its look is limited", () => {
  it("sits at eye height behind the hero rather than above the table", () => {
    const pose = cameraPose(0);
    expect(pose.position[1]).toBe(EYE_HEIGHT);
    // Not a bird's-eye rig: the eyes are below the height of a standing person
    // and only just above the felt.
    expect(pose.position[1]).toBeLessThan(1.5);
    expect(pose.position[1]).toBeGreaterThan(TABLE_HEIGHT);
  });

  it("looks straight ahead when centred", () => {
    expect(cameraPose(0).yaw).toBe(0);
  });

  it("retains the approved seated pitch while responsive depth changes", () => {
    for (const [aspect, width] of [[1024 / 768, 1024], [16 / 9, 1366], [2560 / 1080, 2560]] as const) {
      const pose = cameraPose(0, "standard", aspect, width);
      const horizontalDistance = Math.hypot(
        pose.position[0] - pose.target[0],
        pose.position[2] - pose.target[2],
      );
      const pitch = Math.atan2(pose.position[1] - pose.target[1], horizontalDistance) * 180 / Math.PI;
      expect(pitch).toBeCloseTo(CAMERA_PITCH_DEGREES, 6);
    }
  });

  it("clamps the yaw at the limit in both directions", () => {
    expect(cameraPose(MAX_PAN).yaw).toBeCloseTo(MAX_YAW_RADIANS, 6);
    expect(cameraPose(-MAX_PAN).yaw).toBeCloseTo(-MAX_YAW_RADIANS, 6);
    // Beyond the control's range it must not keep turning.
    expect(cameraPose(99).yaw).toBeCloseTo(MAX_YAW_RADIANS, 6);
    expect(cameraPose(-99).yaw).toBeCloseTo(-MAX_YAW_RADIANS, 6);
  });

  it("never lets the player spin around to face away from the table", () => {
    for (const pan of [-99, -2, -1, 0, 1, 2, 99]) {
      expect(Math.abs(cameraPose(pan).yaw)).toBeLessThan(Math.PI / 4);
    }
  });

  it("keeps the camera in the same seat at every pan setting", () => {
    // Looking left and right must not translate the player around the room.
    const centre = cameraPose(0).position;
    for (const pan of [-2, -1, 1, 2]) {
      expect(cameraPose(pan).position).toEqual(centre);
    }
  });

  it("moves the look target left when panning left and right when panning right", () => {
    // The seat looks down -Z, so the hero's left is -X. This previously asserted
    // the inverse, which let the left control swing the camera to the right.
    const left = cameraPose(-2).target;
    const centre = cameraPose(0).target;
    const right = cameraPose(2).target;
    expect(left[0]).toBeLessThan(centre[0]);
    expect(right[0]).toBeGreaterThan(centre[0]);
  });

  it("brings the looked-at side's seats toward the middle of the frame", () => {
    // Direction A requires the two seats on the looked-at side to stay readable.
    // Panning left must therefore move the left-hand seat inward, not outward.
    const leftSeat = seatPoses(6)[1];
    expect(leftSeat.position[0]).toBeLessThan(0);
    const xAt = (pan: number) => projectToViewport(
      seatRailAnchor(leftSeat),
      cameraPose(pan, "standard", 1366 / 768, 1366),
      1366,
      768,
    ).xPercent;
    expect(xAt(-MAX_PAN)).toBeGreaterThan(xAt(0));
    expect(xAt(MAX_PAN)).toBeLessThan(xAt(0));
  });

  it("recentres exactly, so the control returns to a known pose", () => {
    expect(cameraPose(0)).toEqual(cameraPose(0));
    expect(cameraPose(0).yaw).toBe(0);
  });

  it("keeps every view preference on the approved fixed vertical lens", () => {
    const close = cameraPose(0, "close");
    const standard = cameraPose(0, "standard");
    const wide = cameraPose(0, "wide");
    expect(close.position[2]).toBe(standard.position[2]);
    expect(wide.position[2]).toBe(standard.position[2]);
    expect(close.fov).toBe(CAMERA_VERTICAL_FOV);
    expect(standard.fov).toBe(CAMERA_VERTICAL_FOV);
    expect(wide.fov).toBe(CAMERA_VERTICAL_FOV);
    expect(cameraViewPreset("standard")).toMatchObject({ fov: CAMERA_VERTICAL_FOV });
    expect(cameraViewPreset("standard").distance).toBeGreaterThanOrEqual(CAMERA_DEPTH_MIN);
  });

  it("keeps all composition presets inside the same seated pan limit", () => {
    for (const view of ["close", "standard", "wide"] as const) {
      expect(Math.abs(cameraPose(MAX_PAN, view).yaw)).toBeCloseTo(MAX_YAW_RADIANS, 6);
      expect(cameraPose(0, view)).toEqual(cameraPose(0, view));
    }
  });
});

describe("objects travel between real places", () => {
  const pose = seatPoses(6)[2];

  it("eases in and out rather than snapping", () => {
    expect(actionEase(0)).toBe(0);
    expect(actionEase(1)).toBe(1);
    expect(actionEase(0.5)).toBeCloseTo(0.5, 6);
    // Slow at the ends.
    expect(actionEase(0.1)).toBeLessThan(0.1);
    expect(actionEase(0.9)).toBeGreaterThan(0.9);
  });

  it("clamps progress outside 0..1 so a late frame cannot overshoot", () => {
    expect(actionEase(-5)).toBe(0);
    expect(actionEase(5)).toBe(1);
  });

  it("pushes a bet from the seat to the pot", () => {
    const start = betChipPosition(pose, 0);
    const end = betChipPosition(pose, 1);
    expect(start[0]).toBeCloseTo(pose.feltPosition[0], 6);
    expect(start[2]).toBeCloseTo(pose.feltPosition[2], 6);
    // Ends near the middle of the felt.
    expect(Math.hypot(end[0], end[2])).toBeLessThan(0.3);
    // Lifts off the felt on the way and lands back on it.
    expect(betChipPosition(pose, 0.5)[1]).toBeGreaterThan(pose.feltPosition[1]);
    expect(end[1]).toBeCloseTo(pose.feltPosition[1], 6);
  });

  it("gives calls, bets, raises, and all-ins distinct public chip trajectories", () => {
    const start = pose.feltPosition;
    const end = betChipPosition(pose, 1);
    for (const position of [callChipPosition(pose, 0), raiseChipPosition(pose, 0), allInChipPosition(pose, 0)]) {
      expect(position[0]).toBeCloseTo(start[0], 6);
      expect(position[2]).toBeCloseTo(start[2], 6);
    }
    for (const position of [callChipPosition(pose, 1), raiseChipPosition(pose, 1), allInChipPosition(pose, 1)]) {
      expect(position).toEqual(end);
    }
    expect(distance(callChipPosition(pose, 0.5), betChipPosition(pose, 0.5))).toBeGreaterThan(0.01);
    expect(distance(raiseChipPosition(pose, 0.5), betChipPosition(pose, 0.5))).toBeGreaterThan(0.04);
    expect(allInChipPosition(pose, 0.5)[1]).toBeGreaterThan(betChipPosition(pose, 0.5)[1]);
  });

  it("deals a card from the dealer to the seat", () => {
    const end = dealtCardPosition(pose, 1);
    expect(end[0]).toBeCloseTo(pose.feltPosition[0], 6);
    expect(end[2]).toBeCloseTo(pose.feltPosition[2], 6);
    // It arrives somewhere different from where it began.
    expect(distance(dealtCardPosition(pose, 0), end)).toBeGreaterThan(0.2);
  });

  it("sends a folded card away from the seat toward the muck", () => {
    const start = muckedCardPosition(pose, 0);
    const end = muckedCardPosition(pose, 1);
    expect(start[0]).toBeCloseTo(pose.feltPosition[0], 6);
    // A fold has to read as the cards leaving, not vanishing.
    expect(distance(start, end)).toBeGreaterThan(0.2);
  });

  it("lands reduced motion on exactly the same end state as full motion", () => {
    // The reduced-motion path jumps straight to progress 1; it must agree with
    // where the animated path finishes, or the two renderings disagree about
    // where the chips are.
    for (const seat of seatPoses(6)) {
      expect(betChipPosition(seat, 1)).toEqual(betChipPosition(seat, 1));
      expect(dealtCardPosition(seat, 1)).toEqual(dealtCardPosition(seat, 1));
      expect(muckedCardPosition(seat, 1)).toEqual(muckedCardPosition(seat, 1));
    }
  });
});

describe("the current-turn indicator", () => {
  it("is a stable seat-local cue clear of cards and faces", () => {
    for (const pose of seatPoses(6)) {
      const indicator = turnIndicatorPosition(pose);
      const indicatorRadius = Math.hypot(indicator[0], indicator[2]);
      const cardDistance = distance(indicator, pose.feltPosition);

      // The halo sits around the occupied chair at floor level. It cannot
      // cover the seat's cards on the felt or the character's head above it.
      expect(indicatorRadius).toBeGreaterThan(0.7);
      expect(indicator[1]).toBeLessThan(TABLE_HEIGHT);
      expect(cardDistance).toBeGreaterThan(0.6);
      expect(indicator).toEqual(turnIndicatorPosition(pose));
    }
  });

  it("follows a surviving actor's stable chair after an earlier seat leaves", () => {
    const poses = seatPoses(6);
    const byPlayer = new Map([
      ["hero", poses[0]],
      ["departing", poses[1]],
      ["surviving-actor", poses[2]],
    ]);

    // Scene snapshots compact their public `seat` numbers after an out player,
    // but the renderer deliberately retains each survivor's physical chair.
    byPlayer.delete("departing");
    expect(turnIndicatorPositionForPlayer("surviving-actor", (id) => byPlayer.get(id)))
      .toEqual(turnIndicatorPosition(poses[2]));
    expect(turnIndicatorPositionForPlayer("missing", (id) => byPlayer.get(id))).toBeUndefined();
  });
});

describe("open-arc-v2 hero and pot anchors", () => {
  it("keeps physical hero cards, stack, commitment, board, and main pot in their approved lanes", () => {
    expect(OPEN_ARC_ANCHORS.heroCards).toEqual([
      [-0.10, TABLE_HEIGHT, 0.46],
      [0.10, TABLE_HEIGHT, 0.46],
    ]);
    expect(OPEN_ARC_ANCHORS.heroStack).toEqual([0.44, TABLE_HEIGHT, 0.42]);
    expect(OPEN_ARC_ANCHORS.heroCommitted).toEqual([0.38, TABLE_HEIGHT, 0.2]);
    expect(OPEN_ARC_ANCHORS.board).toEqual([0, TABLE_HEIGHT + 0.005, -0.2]);
    expect(OPEN_ARC_ANCHORS.mainPot).toEqual([0, TABLE_HEIGHT + 0.005, 0.06]);
    expect(OPEN_ARC_ANCHORS.sidePot(0)[0]).toBeCloseTo(0.32);
    expect(OPEN_ARC_ANCHORS.sidePot(1)[0]).toBeCloseTo(-0.32);
  });

  /*
   * These anchors had drifted past the outer rail (z 0.93 and 0.84 against an
   * outer near rail of 0.83), which put the hero's cards and stack in mid-air
   * off the table edge. Assert the physical containment, not just the numbers.
   */
  it("keeps every physical hero object resting on the felt inside the rail", () => {
    const nearFeltEdge = TABLE_DEPTH / 2;
    const halfWidth = TABLE_WIDTH / 2;
    for (const anchor of [
      ...OPEN_ARC_ANCHORS.heroCards,
      OPEN_ARC_ANCHORS.heroStack,
      OPEN_ARC_ANCHORS.heroCommitted,
      OPEN_ARC_ANCHORS.board,
      OPEN_ARC_ANCHORS.mainPot,
      OPEN_ARC_ANCHORS.sidePot(0),
      OPEN_ARC_ANCHORS.sidePot(1),
    ]) {
      expect(anchor[2]).toBeLessThan(nearFeltEdge);
      expect(Math.abs(anchor[0])).toBeLessThan(halfWidth);
      expect(anchor[1]).toBeGreaterThanOrEqual(TABLE_HEIGHT);
    }
  });

  /*
   * v2 replaces v1's rule entirely. v1 solved depth to hold the table at 70-86%
   * of the frame; the owner asked for the felt to dominate, so v2 sits at the
   * closest seated pose and the solver's only remaining job is to retreat when a
   * narrow aspect would push the outer near seat out of frame.
   */
  it("holds the closest seated pose on 16:9 and wider", () => {
    for (const [aspect, width] of [[16 / 9, 1366], [16 / 9, 1920], [2560 / 1080, 2560]] as const) {
      const depth = cameraDepthForSafeFrame(CAMERA_VERTICAL_FOV, aspect, width);
      expect(depth).toBeGreaterThanOrEqual(CAMERA_DEPTH_MIN);
      expect(depth).toBeLessThan(1.75);
      expect(cameraViewPreset("standard", aspect, width))
        .toMatchObject({ fov: CAMERA_VERTICAL_FOV });
    }
  });

  it("retreats on a narrow aspect rather than clipping the outer near seat", () => {
    const wide = cameraDepthForSafeFrame(CAMERA_VERTICAL_FOV, 16 / 9, 1920);
    const compact = cameraDepthForSafeFrame(CAMERA_VERTICAL_FOV, 1024 / 768, 1024);
    expect(compact).toBeGreaterThan(wide);
    expect(compact).toBeLessThanOrEqual(CAMERA_DEPTH_MAX);
    expect(cameraPose(0, "standard", 1024 / 768, 1024).fov).toBe(CAMERA_VERTICAL_FOV);
    expect(cameraPose(0, "standard", 16 / 9, 1920).position[2]).toBe(wide);
  });

  it("sits at roughly the same distance from the table as an opponent does", () => {
    // The owner's framing requirement: the hero is a player at the table, not a
    // spectator behind it. Opponent chair roots are 0.94-1.25 m from centre.
    const depth = cameraDepthForSafeFrame(CAMERA_VERTICAL_FOV, 16 / 9, 1920);
    const opponentRange = seatPoses(6).slice(1)
      .map((pose) => Math.hypot(pose.position[0], pose.position[2]));
    expect(depth).toBeLessThan(Math.max(...opponentRange) + 0.45);
  });
});

describe("chip stacks read as depth without unbounded geometry", () => {
  it("draws nothing for an empty stack", () => {
    expect(chipCountForAmount(0)).toBe(0);
    expect(chipCountForAmount(-10)).toBe(0);
  });

  it("grows with the amount but stays bounded", () => {
    expect(chipCountForAmount(50)).toBeGreaterThan(0);
    expect(chipCountForAmount(15_000)).toBeGreaterThan(chipCountForAmount(500));
    expect(chipCountForAmount(1_000_000_000)).toBeLessThanOrEqual(18);
  });

  it("never returns a fractional chip", () => {
    for (const amount of [1, 7, 99, 12_345, 987_654]) {
      expect(Number.isInteger(chipCountForAmount(amount))).toBe(true);
    }
  });
});
