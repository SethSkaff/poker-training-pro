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


# --- Primitive helpers -------------------------------------------------------


def add_sphere(bm, centre, radius, scale=(1.0, 1.0, 1.0), segments=12, rings=8):
    # Blender 2.9x names these operator arguments `diameter` and `diameter1/2`,
    # but they are radii -- a long-standing misnomer in the bmesh operator API.
    # Passing radius * 2 here silently produced everything at double size.
    result = bmesh.ops.create_uvsphere(
        bm, u_segments=segments, v_segments=rings, diameter=radius
    )
    verts = result["verts"]
    if scale != (1.0, 1.0, 1.0):
        bmesh.ops.scale(bm, vec=scale, verts=verts)
    bmesh.ops.translate(bm, vec=centre, verts=verts)
    return verts


def add_cylinder(bm, centre, radius_top, radius_bottom, height, segments=12):
    result = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        diameter1=radius_bottom,
        diameter2=radius_top,
        depth=height,
    )
    verts = result["verts"]
    bmesh.ops.translate(bm, vec=centre, verts=verts)
    return verts


def _translation(x, y, z):
    from mathutils import Matrix

    return Matrix.Translation((x, y, z))


def _rotation_x(angle):
    from mathutils import Matrix

    return Matrix.Rotation(angle, 4, "X")


def _rotation_z(angle):
    from mathutils import Matrix

    return Matrix.Rotation(angle, 4, "Z")


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


CARD_PEEK_LIFT = 0.028
# Fraction of the card diagonal over which the corner curls.
#
# 0.55 lifted two thirds of the card and, because the falloff bottoms out at a
# fixed radius, put a straight crease across it: the "bent corner" rendered as a
# folded paper dart. A squeeze only ever lifts the corner itself.
CARD_PEEK_SPAN = 0.30


def _peek_lift(x, y):
    """
    How far a point on the card rises when its near corner is squeezed up.

    A player lifts the corner nearest them -- here +X/-Y, which the exporter
    maps to the hero's near right -- and the card bends over a diagonal crease
    rather than hinging on a line. Distance from that corner, normalised across
    the card's diagonal, with a smoothstep so the crease is a curve and not a
    fold: cardboard bends, it does not crack.
    """
    # The corner nearest the player, on the side their thumb comes from.
    #
    # The exporter maps Blender +Y to glTF -Z, so the obvious-looking -Y here
    # produced a lift on the card's *far* edge -- the one pointing at the middle
    # of the table, which is both the wrong corner to squeeze and the one the
    # player cannot see. And +X maps to the seat's own left, away from where a
    # right hand rests. Both are flipped.
    corner_x = -CARD_WIDTH / 2.0
    corner_y = CARD_LENGTH / 2.0
    diagonal = math.hypot(CARD_WIDTH, CARD_LENGTH)
    distance = math.hypot(x - corner_x, y - corner_y) / diagonal
    t = 1.0 - min(1.0, distance / CARD_PEEK_SPAN)
    # Quartic, not smoothstep: it leaves the flat part of the card genuinely
    # flat and puts all the curvature in the last third, which is how a card
    # bends when a thumb presses one corner against the felt.
    return CARD_PEEK_LIFT * t * t * t * t


def build_card(name="card", peeked=False):
    """
    A playing card with rounded corners, lying in the X/Y plane with its face
    up. UVs are a planar projection from above, so the runtime's generated face
    texture maps to the top face exactly and the thin sides sample its border.

    With `peeked`, the near corner is bent up the way a player squeezes a hand
    to read it without showing it to the table. It is a separate mesh rather
    than a runtime deformation so the bend is authored once, shares the card's
    UVs exactly, and costs the renderer a geometry swap instead of per-frame
    vertex work.
    """
    obj, bm = new_mesh(name)
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
    if peeked:
        for vert in bm.verts:
            vert.co.z += _peek_lift(vert.co.x, vert.co.y)
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


def rounded_slab(bm, width, length, thickness, corner, centre):
    """
    A pillow: a rounded rectangle lofted through four levels.

    Used for the palm. The first version was a flattened cylinder, which from
    every angle read as a paddle -- a hand is a slab with rounded edges and a
    thickness you can see, not a disc.
    """
    levels = (
        (-thickness / 2.0, 0.72),
        (-thickness * 0.22, 0.97),
        (thickness * 0.22, 1.0),
        (thickness / 2.0, 0.74),
    )
    rings = []
    for height, inset in levels:
        points = rounded_rect_points(
            width * inset, length * inset, corner * inset, corner_segments=3
        )
        rings.append([
            bm.verts.new((centre[0] + x, centre[1] + y, centre[2] + height))
            for x, y in points
        ])
    bm.verts.ensure_lookup_table()
    count = len(rings[0])
    for level in range(len(rings) - 1):
        lower, upper = rings[level], rings[level + 1]
        for index in range(count):
            nxt = (index + 1) % count
            bm.faces.new((lower[index], lower[nxt], upper[nxt], upper[index]))
    for ring, sign in ((rings[0], -1), (rings[-1], 1)):
        hub = bm.verts.new((centre[0], centre[1], centre[2] + sign * thickness / 2.0))
        bm.verts.ensure_lookup_table()
        for index in range(count):
            nxt = (index + 1) % count
            face = (hub, ring[index], ring[nxt])
            bm.faces.new(face if sign > 0 else tuple(reversed(face)))


def _bone(bm, start, direction, length, radius_start, radius_end, segments=8):
    """One tapered segment from `start` along `direction`; returns its far end."""
    import mathutils

    unit = mathutils.Vector(direction).normalized()
    begin = mathutils.Vector(start)
    finish_point = begin + unit * length
    verts = add_cylinder(bm, (0.0, 0.0, 0.0), radius_end, radius_start, length, segments=segments)
    quaternion = mathutils.Vector((0.0, 0.0, 1.0)).rotation_difference(unit)
    bmesh.ops.rotate(
        bm, verts=verts, cent=(0.0, 0.0, 0.0), matrix=quaternion.to_matrix().to_4x4()
    )
    bmesh.ops.translate(bm, vec=(begin + finish_point) / 2.0, verts=verts)
    return finish_point


def _digit(bm, base, splay, segments):
    """
    A finger as a chain of phalanges, each bending further than the last.

    `segments` is a list of (length, radius, curl), and the curl accumulates,
    which is what makes a finger curl rather than kink. The first pass gave
    every finger two segments at two fixed angles and they rendered as toes.
    """
    import mathutils

    direction = mathutils.Vector((math.sin(splay), -math.cos(splay), 0.0))
    axis = mathutils.Vector((math.cos(splay), math.sin(splay), 0.0))
    point = mathutils.Vector(base)
    radius = segments[0][1]
    for length, radius, curl in segments:
        direction.rotate(mathutils.Quaternion(axis, curl))
        add_sphere(bm, point, radius * 1.06, segments=8, rings=6)
        point = _bone(bm, point, direction, length, radius, radius * 0.88)
    add_sphere(bm, point, radius * 0.90, segments=8, rings=6)
    return point


def build_hand():
    """
    The player own right hand, curled over the card it is lifting.

    The hero has no body -- the camera stands where it would be -- so this is
    the only part of themselves a player ever sees, and it appears for exactly
    as long as they hold their cards up. That earns it real structure: a slab
    palm with a thumb mound and visible knuckles, four fingers of correct
    relative length each curling over three phalanges, and a thumb that comes
    off the base of the palm rather than the knuckle line.

    Authored with the wrist at the origin and the fingers reaching along -Y,
    which the exporter maps to the hero +Z -- away from them, across the card.
    """
    obj, bm = new_mesh("hand/peek")

    # Wrist and palm. The palm is thickest across the knuckles and narrows to
    # the wrist, which is the silhouette that reads as a hand end-on.
    _bone(bm, (0.0, 0.028, 0.0), (0.0, -1.0, -0.05), 0.048, 0.026, 0.030, segments=10)
    rounded_slab(bm, 0.086, 0.094, 0.030, 0.016, (0.0, -0.062, 0.0))
    # Thenar mound: the muscle at the base of the thumb, and the single feature
    # that most separates a hand from a mitten at this size.
    add_sphere(bm, (0.028, -0.042, -0.004), 0.021, scale=(1.0, 1.5, 0.62), segments=10, rings=7)

    # Four fingers. Middle longest, little shortest and set back, curl deepening
    # across the three phalanges.
    knuckle_y = -0.104
    fingers = (
        (-0.030, math.radians(-9.0), 0.0115, (0.034, 0.024, 0.018), (0.30, 0.55, 0.62)),
        (-0.010, math.radians(-3.0), 0.0122, (0.038, 0.027, 0.019), (0.26, 0.52, 0.60)),
        (0.010, math.radians(3.0), 0.0116, (0.035, 0.025, 0.018), (0.28, 0.54, 0.60)),
        (0.029, math.radians(10.0), 0.0100, (0.028, 0.020, 0.015), (0.34, 0.58, 0.64)),
    )
    for offset_x, splay, radius, lengths, curls in fingers:
        base = (offset_x, knuckle_y + (0.006 if abs(offset_x) > 0.025 else 0.0), 0.002)
        add_sphere(bm, (offset_x, knuckle_y + 0.004, 0.011), radius * 0.95,
                   scale=(1.0, 1.2, 0.7), segments=8, rings=6)
        _digit(bm, base, splay, [
            (lengths[0], radius, curls[0]),
            (lengths[1], radius * 0.88, curls[1]),
            (lengths[2], radius * 0.76, curls[2]),
        ])

    # Thumb: off the base of the palm, swung well out and forward, two segments.
    # Positive splay, like the fingers': at -58 degrees it swung across to the
    # far side of the palm and rendered as a spur under the wrist.
    _digit(bm, (0.038, -0.032, -0.004), math.radians(42.0), [
        (0.036, 0.0150, 0.20),
        (0.026, 0.0130, 0.46),
    ])

    return finish(obj, bm, smooth=True)


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
    The contrasting edge inlays, as a separate mesh so the runtime can tint them
    against the chip body.

    They follow the rim barrel rather than cutting across it. The first version
    extruded a straight block at a fixed radius 1.2 mm proud of a 24 mm chip, so
    each spot poked out past the curve at top and bottom and a stack rendered as
    a column with torn tape stuck round it. Sitting them a hair above the body
    surface and letting them curve with it makes them read as inlays -- which is
    what they are -- and the colour does the rest of the work.
    """
    obj, bm = new_mesh("chip/edge")
    half = CHIP_HEIGHT / 2.0
    waist = CHIP_RADIUS
    lip = CHIP_RADIUS - 0.0022
    proud = 0.00025
    # The body rim profile, sampled over the band the inlay covers.
    profile = (
        (lip + proud, half * 0.86),
        (waist - 0.0006 + proud, half * 0.55),
        (waist + proud, 0.0),
        (waist - 0.0006 + proud, -half * 0.55),
        (lip + proud, -half * 0.86),
    )
    arc = (2.0 * math.pi / CHIP_EDGE_SPOTS) * 0.52
    steps = 4
    for spot in range(CHIP_EDGE_SPOTS):
        start_angle = 2.0 * math.pi * spot / CHIP_EDGE_SPOTS - arc / 2.0
        rings = []
        for radius, height in profile:
            ring = []
            for index in range(steps + 1):
                angle = start_angle + arc * index / steps
                ring.append(bm.verts.new(
                    (math.cos(angle) * radius, math.sin(angle) * radius, height)
                ))
            rings.append(ring)
        bm.verts.ensure_lookup_table()
        for level in range(len(rings) - 1):
            upper, lower = rings[level], rings[level + 1]
            for index in range(steps):
                bm.faces.new((upper[index], upper[index + 1], lower[index + 1], lower[index]))
    return finish(obj, bm, smooth=True)


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
        build_card("card/peeked", peeked=True),
        build_hand(),
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


def preview_subjects():
    """
    Named builders for `render_preview.py`.

    Each entry returns the objects to put on an empty scene, so a subject can be
    a single mesh or a small assembly. Grouping the card with the hand that lifts
    it, and the chip with a stack of its neighbours, is the point: both of those
    only read correctly in relation to something else, and both were wrong in
    exactly that relationship the first time.
    """
    def one(builder, *builder_args, **builder_kwargs):
        return lambda: [builder(*builder_args, **builder_kwargs)]

    def squeeze():
        # Both cards, at the runtime's own spacing. Rendering the squeezed card
        # alone made the hand look detached, because in the game it sits
        # outboard of a *pair* -- the gap it appears to leave is filled by the
        # card that was missing from the preview.
        flat = build_card("card/flat")
        flat.location = (-0.055, 0.0, 0.0)
        squeezed = build_card("card/peeked", peeked=True)
        squeezed.location = (0.055, 0.0, 0.0)
        hand = build_hand()
        hand.location = (0.112, 0.042, 0.004)
        hand.rotation_euler = (0.0, 0.0, 0.42)
        return [flat, squeezed, hand]

    def stack():
        objects = []
        for index in range(6):
            body = build_chip_body()
            body.name = "chip/body.%d" % index
            body.location = (0.0, 0.0, index * 0.0037)
            body.rotation_euler = (0.0, 0.0, math.radians((index * 37) % 360))
            edge = build_chip_edge()
            edge.name = "chip/edge.%d" % index
            edge.location = body.location
            edge.rotation_euler = body.rotation_euler
            objects.extend((body, edge))
        return objects

    def top():
        return [build_felt(), build_ledge(), build_rail(), build_trim(), build_print()]

    return {
        "card": one(build_card),
        "squeeze": squeeze,
        "hand": one(build_hand),
        "chip-stack": stack,
        "table-top": top,
        "play-zone": one(build_play_zone),
    }


if __name__ == "__main__":
    main()
