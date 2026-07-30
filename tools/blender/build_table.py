"""
Generate the table assembly, playing card, and casino chip as a glTF binary.

Run headlessly:

    blender --background --factory-startup \
        --python tools/blender/build_table.py -- --out src/assets/table.glb

Why a generator rather than a hand-modelled file: every dimension here is
derived from `src/scene3d/tableStations.ts`, which is where the composition
solver and its tests live. A hand-modelled table would silently drift from the
seat ring the moment a station angle or the rail width changed. Deriving the
mesh from the same numbers keeps the model and the solver in one system, makes
the output reproducible from source, and means the result is original work with
nothing to license.

Shape language follows the three-zone top that reads as a modern VR poker
table rather than a generic felt oval:

    printed felt (racetrack line, centre medallion, per-seat play zones)
      -> hard ledge ring with a per-seat inlaid medallion
        -> padded rail with a metal trim edge

No materials and no textures are exported. The runtime tints each named mesh,
so nothing here bakes a colour the renderer needs to vary, and the library
costs no texture memory.

Blender is Z-up and glTF is Y-up. Everything below is authored with +Z as
height and the felt surface at z=0; the exporter converts, so the runtime
receives a Y-up assembly whose origin sits exactly on the felt plane. The
exporter also maps Blender +Y to glTF -Z, so "toward the hero" (three.js +Z)
is authored here as -Y.
"""
import argparse
import math
import os
import sys

import bpy
import bmesh
import addon_utils


# --- Dimensions --------------------------------------------------------------
#
# Mirrors src/scene3d/tableStations.ts. TABLE_WIDTH/TABLE_DEPTH describe the
# felt, and the ledge plus rail together consume TABLE_RAIL_WIDTH beyond it, so
# the outer silhouette is unchanged and the seat ring still clears the table.

TABLE_WIDTH = 2.30
TABLE_DEPTH = 1.15
TABLE_RAIL_WIDTH = 0.13
TABLE_HEIGHT = 0.76

LEDGE_WIDTH = 0.055
RAIL_WIDTH = TABLE_RAIL_WIDTH - LEDGE_WIDTH

LEDGE_RISE = 0.011
RAIL_CREST = 0.052

OUTLINE_SEGMENTS = 72

# Printed felt graphics.
#
# The racetrack betting line has to run *inside* the seat play zones -- it is
# the line a bet is pushed across. At a 0.105 inset it cut straight through
# every play zone and the two graphics read as one scribble. 0.275 puts it a
# clean 40 mm inboard of the play zones' inner edge on both axes.
MEDALLION_RADIUS = 0.170
RACETRACK_INSET = 0.275
PRINT_LIFT = 0.0012

# Per-seat printed play zone, authored facing -Y (three.js +Z, toward its owner).
PLAY_ZONE_WIDTH = 0.300
# 0.25 deep, not 0.17. At 0.17 the bet circle had nowhere to go: two hole cards
# span 0.123 m of the zone's depth on their own, so a 0.09 m circle placed
# anywhere inside it landed on top of them -- and so did the actor cue drawn on
# that circle. A deeper zone puts the cards and the betting spot side by side,
# which is the layout a printed play zone exists to provide.
PLAY_ZONE_DEPTH = 0.250
PLAY_ZONE_CORNER = 0.035
BET_CIRCLE_RADIUS = 0.040
BET_CIRCLE_FORWARD = -0.082

# 1.25x a real playing card, at the true 0.714 card ratio.
CARD_WIDTH = 0.088
CARD_LENGTH = 0.123
CARD_THICKNESS = 0.0035
CARD_CORNER = 0.008

# Casino chip: 39 mm real, 48 mm here so the denomination band reads seated.
CHIP_RADIUS = 0.024
CHIP_HEIGHT = 0.0035
CHIP_SEGMENTS = 20
CHIP_EDGE_SPOTS = 8


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_mesh(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, bmesh.new()


def finish(obj, bm, smooth=False):
    bm.to_mesh(obj.data)
    bm.free()
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


# --- Outline helpers ---------------------------------------------------------


def capsule_outline(width, depth, segments=OUTLINE_SEGMENTS):
    """
    The table silhouette: a rectangle capped by semicircles, sampled evenly.

    Offsetting this shape outward is just `capsule_outline(width + 2 * off,
    depth + 2 * off)` because the straight run keeps its length, which is what
    lets every zone below be swept from one profile.
    """
    radius = depth / 2.0
    straight = max(0.0, width / 2.0 - radius)
    points = []
    caps = max(4, segments // 2)
    for index in range(caps + 1):
        angle = -math.pi / 2.0 + math.pi * index / caps
        points.append((straight + math.cos(angle) * radius, math.sin(angle) * radius))
    for index in range(caps + 1):
        angle = math.pi / 2.0 + math.pi * index / caps
        points.append((-straight + math.cos(angle) * radius, math.sin(angle) * radius))
    # The sweep closes the loop itself; drop the duplicated final vertex.
    return points[:-1]


def sweep_profile(bm, width, depth, profile):
    """
    Sweep a cross-section around the table outline.

    `profile` is a list of (outward offset, height) pairs describing the shape
    in the plane normal to the outline. Consecutive pairs become one quad ring,
    which is how the ledge, the rail crown, and the trim band are all built.
    """
    rings = []
    for offset, height in profile:
        outline = capsule_outline(width + 2.0 * offset, depth + 2.0 * offset)
        rings.append([bm.verts.new((x, y, height)) for x, y in outline])
    bm.verts.ensure_lookup_table()
    count = len(rings[0])
    for index in range(len(rings) - 1):
        lower, upper = rings[index], rings[index + 1]
        for step in range(count):
            nxt = (step + 1) % count
            bm.faces.new((lower[step], lower[nxt], upper[nxt], upper[step]))
    return rings


def fill_outline(bm, width, depth, height):
    """A flat capsule cap, fanned from the centre."""
    outline = capsule_outline(width, depth)
    centre = bm.verts.new((0.0, 0.0, height))
    ring = [bm.verts.new((x, y, height)) for x, y in outline]
    bm.verts.ensure_lookup_table()
    for index in range(len(ring)):
        bm.faces.new((centre, ring[index], ring[(index + 1) % len(ring)]))
    return ring


def disc(bm, radius, height, segments=48, centre=(0.0, 0.0)):
    hub = bm.verts.new((centre[0], centre[1], height))
    ring = [
        bm.verts.new(
            (
                centre[0] + math.cos(2.0 * math.pi * i / segments) * radius,
                centre[1] + math.sin(2.0 * math.pi * i / segments) * radius,
                height,
            )
        )
        for i in range(segments)
    ]
    bm.verts.ensure_lookup_table()
    for index in range(segments):
        bm.faces.new((hub, ring[index], ring[(index + 1) % segments]))
    return ring


def annulus(bm, inner, outer, height, segments=48, start=0.0, sweep=2.0 * math.pi, centre=(0.0, 0.0)):
    """A flat ring, or an arc of one when `sweep` is less than a full turn."""
    closed = abs(sweep - 2.0 * math.pi) < 1e-6
    steps = segments if closed else max(2, int(segments * sweep / (2.0 * math.pi)) + 1)
    inner_ring, outer_ring = [], []
    for index in range(steps if closed else steps + 1):
        angle = start + sweep * (index / (steps if closed else steps))
        cos, sin = math.cos(angle), math.sin(angle)
        inner_ring.append(bm.verts.new((centre[0] + cos * inner, centre[1] + sin * inner, height)))
        outer_ring.append(bm.verts.new((centre[0] + cos * outer, centre[1] + sin * outer, height)))
    bm.verts.ensure_lookup_table()
    span = steps if closed else steps
    for index in range(span):
        nxt = (index + 1) % len(inner_ring)
        bm.faces.new((inner_ring[index], outer_ring[index], outer_ring[nxt], inner_ring[nxt]))
    return inner_ring, outer_ring


def rounded_rect_points(width, depth, corner, corner_segments=5):
    half_w = width / 2.0 - corner
    half_d = depth / 2.0 - corner
    points = []
    for cx, cy, start in (
        (half_w, half_d, 0.0),
        (-half_w, half_d, math.pi / 2.0),
        (-half_w, -half_d, math.pi),
        (half_w, -half_d, math.pi * 1.5),
    ):
        for index in range(corner_segments + 1):
            angle = start + (math.pi / 2.0) * index / corner_segments
            points.append((cx + math.cos(angle) * corner, cy + math.sin(angle) * corner))
    return points


def band_from_points(bm, points, thickness, height, close=True):
    """A thin printed line following a closed path, drawn as a flat strip."""
    count = len(points)
    inner, outer = [], []
    for index in range(count):
        px, py = points[index]
        nx, ny = points[(index + 1) % count]
        vx, vy = points[index - 1]
        # Average the two adjacent edge normals so corners stay mitred.
        normal_x, normal_y = 0.0, 0.0
        for ax, ay, bx, by in ((vx, vy, px, py), (px, py, nx, ny)):
            dx, dy = bx - ax, by - ay
            length = math.hypot(dx, dy) or 1.0
            normal_x += dy / length
            normal_y += -dx / length
        length = math.hypot(normal_x, normal_y) or 1.0
        normal_x, normal_y = normal_x / length, normal_y / length
        half = thickness / 2.0
        inner.append(bm.verts.new((px - normal_x * half, py - normal_y * half, height)))
        outer.append(bm.verts.new((px + normal_x * half, py + normal_y * half, height)))
    bm.verts.ensure_lookup_table()
    span = count if close else count - 1
    for index in range(span):
        nxt = (index + 1) % count
        bm.faces.new((inner[index], outer[index], outer[nxt], inner[nxt]))


# --- Table zones -------------------------------------------------------------


def build_felt():
    """
    The recessed playing surface: a capsule cap at z=0 with a shallow skirt so
    the felt reads as an inset panel rather than a decal on the ledge.
    """
    obj, bm = new_mesh("table/felt")
    fill_outline(bm, TABLE_WIDTH, TABLE_DEPTH, 0.0)
    sweep_profile(
        bm,
        TABLE_WIDTH,
        TABLE_DEPTH,
        [(0.0, 0.0), (0.004, -0.012), (0.004, -0.075)],
    )
    return finish(obj, bm)


def build_ledge():
    """
    The hard ring between felt and rail: a chamfer up out of the felt well, a
    flat shelf wide enough to hold a seat medallion, then the rail's footing.
    """
    obj, bm = new_mesh("table/ledge")
    sweep_profile(
        bm,
        TABLE_WIDTH,
        TABLE_DEPTH,
        [
            (0.004, -0.012),
            (0.014, LEDGE_RISE),
            (LEDGE_WIDTH, LEDGE_RISE),
        ],
    )
    return finish(obj, bm)


def build_rail():
    """
    The padded rail: a half-round crown swept around the outline and closed by
    a skirt, so the table has a real edge from every seated angle.
    """
    obj, bm = new_mesh("table/rail")
    crest = RAIL_CREST
    profile = [(LEDGE_WIDTH, LEDGE_RISE)]
    # A quarter-turn of padding, sampled so the highlight rolls rather than
    # breaking into visible facets at the seated distance.
    for index in range(1, 7):
        t = index / 6.0
        offset = LEDGE_WIDTH + RAIL_WIDTH * (1.0 - math.cos(t * math.pi)) / 2.0
        height = LEDGE_RISE + (crest - LEDGE_RISE) * math.sin(t * math.pi)
        profile.append((offset, height))
    profile.append((TABLE_RAIL_WIDTH, -0.020))
    profile.append((TABLE_RAIL_WIDTH - 0.004, -0.105))
    sweep_profile(bm, TABLE_WIDTH, TABLE_DEPTH, profile)
    return finish(obj, bm, smooth=True)


def build_trim():
    """The metal bead where the padded rail meets the hard ledge."""
    obj, bm = new_mesh("table/trim")
    sweep_profile(
        bm,
        TABLE_WIDTH,
        TABLE_DEPTH,
        [
            (LEDGE_WIDTH - 0.006, LEDGE_RISE + 0.0004),
            (LEDGE_WIDTH - 0.002, LEDGE_RISE + 0.0055),
            (LEDGE_WIDTH + 0.004, LEDGE_RISE + 0.0055),
            (LEDGE_WIDTH + 0.008, LEDGE_RISE + 0.0004),
        ],
    )
    return finish(obj, bm, smooth=True)


def build_print():
    """
    Everything printed on the felt: the centre medallion, its outline, and the
    racetrack betting line that follows the table silhouette.
    """
    obj, bm = new_mesh("table/print")
    # Rings and a small hub, not a filled disc. A filled 0.34 m disc in a tone
    # even slightly off the felt read as a stain in the middle of the table
    # under the pendant key, because it was the one large flat area catching a
    # different amount of light than the felt around it.
    annulus(bm, MEDALLION_RADIUS - 0.006, MEDALLION_RADIUS, PRINT_LIFT)
    annulus(bm, MEDALLION_RADIUS - 0.030, MEDALLION_RADIUS - 0.026, PRINT_LIFT)
    disc(bm, 0.046, PRINT_LIFT)
    annulus(bm, 0.056, 0.060, PRINT_LIFT)
    band_from_points(
        bm,
        capsule_outline(
            TABLE_WIDTH - 2.0 * RACETRACK_INSET,
            TABLE_DEPTH - 2.0 * RACETRACK_INSET,
        ),
        0.007,
        PRINT_LIFT,
    )
    return finish(obj, bm)


def build_play_zone():
    """
    One seat's printed play zone, authored facing -Y so the runtime can rotate
    a clone by the station's own facing and have it land the right way up.
    """
    obj, bm = new_mesh("table/play-zone")
    band_from_points(
        bm,
        rounded_rect_points(PLAY_ZONE_WIDTH, PLAY_ZONE_DEPTH, PLAY_ZONE_CORNER),
        0.006,
        PRINT_LIFT,
    )
    annulus(
        bm,
        BET_CIRCLE_RADIUS,
        BET_CIRCLE_RADIUS + 0.005,
        PRINT_LIFT,
        segments=32,
        centre=(0.0, BET_CIRCLE_FORWARD),
    )
    return finish(obj, bm)


def build_seat_inlay():
    """
    The inlaid medallion set into the hard ledge in front of each seat.

    Small, and a ring rather than a filled disc. At a 33 mm radius with a solid
    centre it was 66 mm of metal on the ledge -- wider than a chip -- and the
    hero's own, a third of a metre from the eye, read as a gold puddle on the
    rail. A real ledge inlay is a discreet bezel, and that is all it needs to be:
    the seat is already identified by the play zone printed in front of it.
    """
    obj, bm = new_mesh("table/seat-inlay")
    height = LEDGE_RISE + 0.0006
    annulus(bm, 0.014, 0.019, height, segments=20)
    return finish(obj, bm)


def build_pedestal():
    """
    A tapered column and foot in the rail's own timber. Authored downward from
    the felt plane so the runtime places the whole assembly by one anchor.
    """
    obj, bm = new_mesh("table/pedestal")
    steps = [
        (0.30, -0.105),
        (0.20, -0.20),
        (0.17, -0.52),
        (0.24, -0.68),
        (0.30, -0.71),
        (0.50, -0.735),
        (0.52, -0.76),
    ]
    rings = []
    for radius, height in steps:
        rings.append(
            [
                bm.verts.new(
                    (
                        math.cos(2.0 * math.pi * i / 24) * radius,
                        math.sin(2.0 * math.pi * i / 24) * radius,
                        height,
                    )
                )
                for i in range(24)
            ]
        )
    bm.verts.ensure_lookup_table()
    for index in range(len(rings) - 1):
        upper, lower = rings[index], rings[index + 1]
        for step in range(24):
            nxt = (step + 1) % 24
            bm.faces.new((upper[step], upper[nxt], lower[nxt], lower[step]))
    hub = bm.verts.new((0.0, 0.0, -TABLE_HEIGHT))
    for step in range(24):
        bm.faces.new((hub, rings[-1][(step + 1) % 24], rings[-1][step]))
    return finish(obj, bm)


# --- Table objects -----------------------------------------------------------


def build_card():
    """
    A playing card with rounded corners, lying in the X/Y plane with its face
    up. UVs are a planar projection from above, so the runtime's generated face
    texture maps to the top face exactly and the thin sides sample its border.
    """
    obj, bm = new_mesh("card")
    points = rounded_rect_points(CARD_WIDTH, CARD_LENGTH, CARD_CORNER, corner_segments=4)
    top = [bm.verts.new((x, y, CARD_THICKNESS / 2.0)) for x, y in points]
    bottom = [bm.verts.new((x, y, -CARD_THICKNESS / 2.0)) for x, y in points]
    bm.verts.ensure_lookup_table()
    count = len(points)
    top_hub = bm.verts.new((0.0, 0.0, CARD_THICKNESS / 2.0))
    bottom_hub = bm.verts.new((0.0, 0.0, -CARD_THICKNESS / 2.0))
    bm.verts.ensure_lookup_table()
    for index in range(count):
        nxt = (index + 1) % count
        bm.faces.new((top_hub, top[index], top[nxt]))
        bm.faces.new((bottom_hub, bottom[nxt], bottom[index]))
        bm.faces.new((top[nxt], bottom[nxt], bottom[index], top[index]))
    finish(obj, bm)

    # u runs from +x to -x, not the other way about. The exporter maps Blender
    # +Y to glTF -Z, which mirrors the card's plane on its way into the scene;
    # the natural-looking projection therefore rendered every index in mirror
    # writing, with 3 as a reversed 3 and 9 as a reversed 9.
    mesh = obj.data
    layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        x, y, _ = mesh.vertices[loop.vertex_index].co
        layer.data[loop.index].uv = (
            min(1.0, max(0.0, 0.5 - x / CARD_WIDTH)),
            min(1.0, max(0.0, y / CARD_LENGTH + 0.5)),
        )
    return obj


def build_chip_body():
    """
    A casino chip with a barrelled rim and a recessed face.

    A chip is 3.5 mm tall and sits about a metre from the seated eye, so one
    chip is roughly three pixels: a plain cylinder stacks into a smooth rod and
    the count becomes unreadable. Barrelling the rim -- widest at the middle,
    drawn in at both faces -- gives every chip its own highlight and shadow
    under a single Lambert key, so the stack shows as banded rings and the
    count reads at a glance. This is also what a real chip's edge does.
    """
    obj, bm = new_mesh("chip/body")
    half = CHIP_HEIGHT / 2.0
    inner = CHIP_RADIUS - 0.005
    waist = CHIP_RADIUS
    lip = CHIP_RADIUS - 0.0022
    for sign in (1.0, -1.0):
        disc(bm, inner, sign * (half - 0.0005), segments=CHIP_SEGMENTS)
        annulus(bm, inner, lip, sign * (half - 0.0005), segments=CHIP_SEGMENTS)
        annulus(bm, lip, lip, sign * half, segments=CHIP_SEGMENTS)
    rings = []
    for radius, height in (
        (lip, half),
        (waist - 0.0006, half * 0.55),
        (waist, 0.0),
        (waist - 0.0006, -half * 0.55),
        (lip, -half),
    ):
        rings.append(
            [
                bm.verts.new(
                    (
                        math.cos(2.0 * math.pi * i / CHIP_SEGMENTS) * radius,
                        math.sin(2.0 * math.pi * i / CHIP_SEGMENTS) * radius,
                        height,
                    )
                )
                for i in range(CHIP_SEGMENTS)
            ]
        )
    bm.verts.ensure_lookup_table()
    for level in range(len(rings) - 1):
        upper, lower = rings[level], rings[level + 1]
        for index in range(CHIP_SEGMENTS):
            nxt = (index + 1) % CHIP_SEGMENTS
            bm.faces.new((upper[index], upper[nxt], lower[nxt], lower[index]))
    return finish(obj, bm)


def build_chip_edge():
    """
    The contrasting edge spots, as a separate mesh so the runtime can tint them
    against the chip body.

    Eight wide blocks standing 1.2 mm proud of the barrelled rim and covering
    most of its height. The first pass used six thin arcs 0.4 mm proud, which at
    this scale was under a pixel and invisible: a chip's edge inlay has to be a
    real block of the contrasting colour to survive the seated distance.
    """
    obj, bm = new_mesh("chip/edge")
    radius = CHIP_RADIUS + 0.0012
    band = CHIP_HEIGHT * 0.30
    arc = (2.0 * math.pi / CHIP_EDGE_SPOTS) * 0.55
    seated = CHIP_RADIUS - 0.0004
    for spot in range(CHIP_EDGE_SPOTS):
        start = 2.0 * math.pi * spot / CHIP_EDGE_SPOTS - arc / 2.0
        steps = 3
        outer_top, outer_bottom, inner_top, inner_bottom = [], [], [], []
        for index in range(steps + 1):
            angle = start + arc * index / steps
            cos, sin = math.cos(angle), math.sin(angle)
            outer_top.append(bm.verts.new((cos * radius, sin * radius, band)))
            outer_bottom.append(bm.verts.new((cos * radius, sin * radius, -band)))
            inner_top.append(bm.verts.new((cos * seated, sin * seated, band)))
            inner_bottom.append(bm.verts.new((cos * seated, sin * seated, -band)))
        bm.verts.ensure_lookup_table()
        for index in range(steps):
            # Outer face, plus the top and bottom shelves that give the inlay a
            # lit edge. Without them a spot read as a flat decal and disappeared
            # entirely whenever the stack was seen from directly beside it.
            bm.faces.new((outer_top[index], outer_top[index + 1], outer_bottom[index + 1], outer_bottom[index]))
            bm.faces.new((inner_top[index], outer_top[index], outer_top[index + 1], inner_top[index + 1]))
            bm.faces.new((inner_bottom[index + 1], outer_bottom[index + 1], outer_bottom[index], inner_bottom[index]))
        for end, sign in ((0, 1), (steps, -1)):
            face = (inner_top[end], outer_top[end], outer_bottom[end], inner_bottom[end])
            bm.faces.new(face if sign > 0 else tuple(reversed(face)))
    return finish(obj, bm)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)

    clear_scene()

    built = [
        build_felt(),
        build_ledge(),
        build_rail(),
        build_trim(),
        build_print(),
        build_play_zone(),
        build_seat_inlay(),
        build_pedestal(),
        build_card(),
        build_chip_body(),
        build_chip_edge(),
    ]

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    addon_utils.enable("io_scene_gltf2")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_apply=True,
        export_materials="NONE",
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )

    triangles = 0
    for obj in built:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
        print("TABLE_MESH", obj.name, len(obj.data.loop_triangles))
    print("TABLE_LIBRARY_OBJECTS", len(built))
    print("TABLE_LIBRARY_TRIANGLES", triangles)
    print("TABLE_LIBRARY_BYTES", os.path.getsize(out))


if __name__ == "__main__":
    main()
