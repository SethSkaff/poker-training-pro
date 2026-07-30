"""
Generate the seated-opponent character library as a single glTF binary.

Run headlessly:

    blender --background --factory-startup \
        --python tools/blender/build_characters.py -- --out src/assets/characters.glb

Why a generator rather than hand-modelled files: the library has to cover 5 male
and 3 female body families, 5 hair styles per presented gender, 6 face presets,
and a per-identity height scale. Authoring 8 x 5 x 6 combinations by hand is both
enormous and impossible to keep consistent. Building them from parameterised
primitives keeps every silhouette in the same proportional system, makes the
whole set reproducible from source, and means the output is original work with
nothing to license.

The runtime composes a character from three named meshes -- body, hair, face --
and tints them per identity (skin, hair gradient, outfit). Nothing here bakes a
colour that the renderer needs to vary, and there are no textures at all, so the
library costs no texture memory.

Only the seated upper body exists. Everything below the felt is never visible
from the -27 degree seated camera, so modelling it would be pure cost.
"""
import argparse
import math
import os
import sys

import bpy
import bmesh
import addon_utils


# --- Proportional system -----------------------------------------------------
#
# All measurements are metres in the seat's local space, with y=0 at the chair
# seat pan. The head centre lands near y=1.13 for an average build, matching the
# head height the composition solver reserves camera room for.

BODY_FAMILIES = {
    # name:        (shoulder half-width, chest depth, waist half-width, torso h, neck r)
    "male/lean": (0.185, 0.115, 0.140, 0.520, 0.052),
    "male/average": (0.205, 0.130, 0.160, 0.520, 0.056),
    "male/stocky": (0.215, 0.150, 0.190, 0.505, 0.060),
    "male/broad": (0.238, 0.152, 0.192, 0.530, 0.062),
    "male/heavy": (0.240, 0.180, 0.232, 0.500, 0.064),
    "female/slight": (0.165, 0.108, 0.128, 0.500, 0.046),
    "female/average": (0.178, 0.120, 0.142, 0.505, 0.049),
    "female/curvy": (0.192, 0.138, 0.170, 0.500, 0.051),
}

HEAD_RADIUS = 0.098
TORSO_BASE_Y = 0.50


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_mesh(name):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj, bmesh.new()


def finish(obj, bm, smooth=True):
    bm.to_mesh(obj.data)
    bm.free()
    if smooth:
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def add_sphere(bm, centre, radius, scale=(1.0, 1.0, 1.0), segments=12, rings=8):
    result = bmesh.ops.create_uvsphere(
        bm, u_segments=segments, v_segments=rings, diameter=radius * 2.0
    )
    verts = result["verts"]
    bmesh.ops.scale(
        bm, vec=(scale[0], scale[1], scale[2]), verts=verts
    )
    bmesh.ops.translate(bm, vec=centre, verts=verts)
    return verts


def add_cylinder(bm, centre, radius_top, radius_bottom, height, segments=12):
    result = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        diameter1=radius_bottom * 2.0,
        diameter2=radius_top * 2.0,
        depth=height,
    )
    verts = result["verts"]
    bmesh.ops.translate(bm, vec=centre, verts=verts)
    return verts


def build_body(name, params):
    """A seated upper body: hips, tapered torso, shoulders, neck, and two arms."""
    shoulder, depth, waist, torso_h, neck_r = params
    obj, bm = new_mesh(name)

    # Torso as a lofted box-ish solid: a cone from waist to shoulder, then
    # flattened front-to-back so it reads as a chest rather than a barrel.
    torso = add_cylinder(
        bm,
        (0.0, 0.0, TORSO_BASE_Y + torso_h / 2.0),
        shoulder,
        waist,
        torso_h,
        segments=14,
    )
    bmesh.ops.scale(
        bm,
        vec=(1.0, depth / shoulder, 1.0),
        verts=torso,
        space=_translation(0.0, 0.0, -(TORSO_BASE_Y + torso_h / 2.0)),
    )

    top = TORSO_BASE_Y + torso_h
    # Shoulder caps soften the hard cone rim, which otherwise reads as armour.
    for side in (-1, 1):
        add_sphere(
            bm,
            (side * shoulder * 0.88, 0.0, top - 0.028),
            shoulder * 0.30,
            scale=(1.0, depth / shoulder * 1.05, 0.72),
            segments=10,
            rings=6,
        )

    add_cylinder(bm, (0.0, 0.0, top + 0.045), neck_r * 0.92, neck_r, 0.11, segments=10)

    # Upper arms angled down and slightly forward, forearms resting toward the
    # felt: the pose a seated player actually holds.
    for side in (-1, 1):
        upper = add_cylinder(
            bm,
            (side * (shoulder * 0.92), 0.02, top - 0.16),
            neck_r * 0.86,
            neck_r * 0.94,
            0.28,
            segments=9,
        )
        bmesh.ops.rotate(
            bm,
            verts=upper,
            cent=(side * shoulder * 0.92, 0.0, top - 0.02),
            matrix=_rotation_y(side * math.radians(9.0)),
        )
        fore = add_cylinder(
            bm,
            (side * (shoulder * 0.86), 0.20, top - 0.30),
            neck_r * 0.70,
            neck_r * 0.84,
            0.30,
            segments=9,
        )
        bmesh.ops.rotate(
            bm,
            verts=fore,
            cent=(side * shoulder * 0.86, 0.05, top - 0.30),
            matrix=_rotation_x(math.radians(74.0)),
        )
        # Hands: simple blocks at the felt, which is where cards and chips are.
        add_sphere(
            bm,
            (side * (shoulder * 0.80), 0.34, top - 0.30),
            neck_r * 0.80,
            scale=(1.0, 1.25, 0.65),
            segments=8,
            rings=6,
        )

    return finish(obj, bm)


def build_head(name, face):
    """Head plus the face relief that distinguishes one preset from another."""
    obj, bm = new_mesh(name)
    jaw, cheek, brow, nose, chin = FACE_PRESETS[face]

    add_sphere(
        bm,
        (0.0, 0.0, 0.0),
        HEAD_RADIUS,
        scale=(1.0 * jaw, 1.06, 1.16),
        segments=16,
        rings=12,
    )
    # Cheekbones.
    for side in (-1, 1):
        add_sphere(
            bm,
            (side * HEAD_RADIUS * 0.62, -HEAD_RADIUS * 0.52, HEAD_RADIUS * 0.10),
            HEAD_RADIUS * 0.30 * cheek,
            scale=(1.0, 0.8, 0.7),
            segments=8,
            rings=6,
        )
    # Brow ridge.
    add_sphere(
        bm,
        (0.0, -HEAD_RADIUS * 0.72, HEAD_RADIUS * 0.36),
        HEAD_RADIUS * 0.34 * brow,
        scale=(1.9, 0.5, 0.42),
        segments=10,
        rings=6,
    )
    # Nose.
    add_sphere(
        bm,
        (0.0, -HEAD_RADIUS * 0.94, -HEAD_RADIUS * 0.02),
        HEAD_RADIUS * 0.20 * nose,
        scale=(0.75, 1.35, 0.95),
        segments=8,
        rings=6,
    )
    # Chin / jaw taper.
    add_sphere(
        bm,
        (0.0, -HEAD_RADIUS * 0.60, -HEAD_RADIUS * 0.88),
        HEAD_RADIUS * 0.34 * chin,
        scale=(1.15, 0.95, 0.7),
        segments=8,
        rings=6,
    )
    # Ears.
    for side in (-1, 1):
        add_sphere(
            bm,
            (side * HEAD_RADIUS * 0.99, -HEAD_RADIUS * 0.04, -HEAD_RADIUS * 0.05),
            HEAD_RADIUS * 0.20,
            scale=(0.35, 0.85, 1.25),
            segments=7,
            rings=5,
        )
    return finish(obj, bm)


# jaw width, cheek prominence, brow, nose, chin
FACE_PRESETS = {
    "broad-jaw": (1.10, 1.15, 1.12, 1.05, 1.20),
    "narrow": (0.90, 0.92, 0.95, 1.05, 0.88),
    "soft-round": (1.05, 0.85, 0.82, 0.90, 0.92),
    "angular": (0.97, 1.25, 1.10, 1.12, 1.05),
    "high-cheek": (0.95, 1.32, 0.92, 0.95, 0.90),
    "heavy-brow": (1.04, 1.00, 1.35, 1.10, 1.02),
}


def build_hair(name, style):
    """
    Hair is a separate mesh so the runtime can tint it along the gradient without
    touching skin or clothing. A bald 'style' still exports an (empty-ish) stub so
    the runtime never has to special-case a missing mesh.
    """
    obj, bm = new_mesh(name)
    cap_r = HEAD_RADIUS * 1.06

    if style == "male/bald":
        # A faint scalp shell only, so a bald head still takes hair tinting for
        # stubble rather than showing bare skin with a hard edge.
        verts = add_sphere(bm, (0.0, 0.0, 0.012), cap_r * 0.99, (1.0, 1.04, 1.10), 14, 10)
        _cut_below(bm, verts, HEAD_RADIUS * 0.34)
        return finish(obj, bm)

    if style in ("male/buzz", "male/textured-crop"):
        thickness = 1.03 if style == "male/buzz" else 1.10
        verts = add_sphere(bm, (0.0, 0.0, 0.014), cap_r * thickness, (1.0, 1.05, 1.10), 14, 10)
        _cut_below(bm, verts, HEAD_RADIUS * 0.24)
        if style == "male/textured-crop":
            for offset in (-0.045, 0.0, 0.045):
                add_sphere(
                    bm,
                    (offset, -HEAD_RADIUS * 0.30, HEAD_RADIUS * 0.92),
                    HEAD_RADIUS * 0.26,
                    (1.0, 1.0, 0.7),
                    8,
                    5,
                )
        return finish(obj, bm)

    if style == "male/short-side-part":
        verts = add_sphere(bm, (0.012, 0.0, 0.016), cap_r * 1.09, (1.02, 1.05, 1.08), 14, 10)
        _cut_below(bm, verts, HEAD_RADIUS * 0.20)
        add_sphere(
            bm,
            (-HEAD_RADIUS * 0.34, -HEAD_RADIUS * 0.52, HEAD_RADIUS * 0.80),
            HEAD_RADIUS * 0.30,
            (1.5, 0.9, 0.55),
            9,
            6,
        )
        return finish(obj, bm)

    if style == "male/slick-back":
        verts = add_sphere(bm, (0.0, 0.055, 0.030), cap_r * 1.08, (1.0, 1.14, 1.05), 14, 10)
        _cut_below(bm, verts, HEAD_RADIUS * 0.22)
        return finish(obj, bm)

    if style == "female/ponytail":
        verts = add_sphere(bm, (0.0, 0.0, 0.016), cap_r * 1.08, (1.02, 1.06, 1.10), 14, 10)
        _cut_below(bm, verts, HEAD_RADIUS * 0.10)
        tail = add_cylinder(
            bm, (0.0, HEAD_RADIUS * 0.95, -HEAD_RADIUS * 0.55), 0.030, 0.052, 0.26, 9
        )
        bmesh.ops.rotate(
            bm, verts=tail, cent=(0.0, HEAD_RADIUS * 0.95, -HEAD_RADIUS * 0.30),
            matrix=_rotation_x(math.radians(-16.0)),
        )
        return finish(obj, bm)

    if style == "female/bob":
        verts = add_sphere(bm, (0.0, 0.0, 0.010), cap_r * 1.13, (1.06, 1.10, 1.08), 16, 11)
        _cut_below(bm, verts, -HEAD_RADIUS * 0.52)
        return finish(obj, bm)

    if style == "female/long-straight":
        verts = add_sphere(bm, (0.0, 0.0, 0.010), cap_r * 1.11, (1.05, 1.08, 1.08), 16, 11)
        _cut_below(bm, verts, -HEAD_RADIUS * 0.30)
        # Two curtains down the back and past the shoulders.
        for side in (-1, 1):
            add_cylinder(
                bm,
                (side * HEAD_RADIUS * 0.72, HEAD_RADIUS * 0.30, -HEAD_RADIUS * 1.85),
                0.055,
                0.070,
                0.34,
                8,
            )
        return finish(obj, bm)

    if style == "female/curly-shoulder":
        verts = add_sphere(bm, (0.0, 0.0, 0.014), cap_r * 1.14, (1.08, 1.10, 1.06), 16, 11)
        _cut_below(bm, verts, -HEAD_RADIUS * 0.20)
        for index in range(10):
            angle = (index / 10.0) * math.tau
            add_sphere(
                bm,
                (
                    math.sin(angle) * HEAD_RADIUS * 0.95,
                    math.cos(angle) * HEAD_RADIUS * 0.80,
                    -HEAD_RADIUS * (1.05 + 0.35 * (index % 3) / 3.0),
                ),
                HEAD_RADIUS * 0.30,
                (1.0, 1.0, 1.0),
                7,
                5,
            )
        return finish(obj, bm)

    if style == "female/top-knot":
        verts = add_sphere(bm, (0.0, 0.0, 0.014), cap_r * 1.06, (1.02, 1.05, 1.08), 14, 10)
        _cut_below(bm, verts, HEAD_RADIUS * 0.06)
        add_sphere(
            bm, (0.0, HEAD_RADIUS * 0.18, HEAD_RADIUS * 1.10), HEAD_RADIUS * 0.42,
            (1.0, 1.0, 0.85), 12, 8,
        )
        return finish(obj, bm)

    raise SystemExit("unknown hair style {0}".format(style))


def _cut_below(bm, verts, z_limit):
    """Flatten hair geometry below z_limit so a cap does not enclose the face."""
    for vert in verts:
        if vert.co.z < z_limit:
            vert.co.z = z_limit


def _translation(x, y, z):
    from mathutils import Matrix

    return Matrix.Translation((x, y, z))


def _rotation_x(angle):
    from mathutils import Matrix

    return Matrix.Rotation(angle, 4, "X")


def _rotation_y(angle):
    from mathutils import Matrix

    return Matrix.Rotation(angle, 4, "Y")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(argv)

    clear_scene()

    built = []
    for name, params in BODY_FAMILIES.items():
        built.append(build_body("body/" + name, params))
    for face in FACE_PRESETS:
        built.append(build_head("head/" + face, face))
    for style in (
        "male/buzz",
        "male/short-side-part",
        "male/textured-crop",
        "male/slick-back",
        "male/bald",
        "female/ponytail",
        "female/bob",
        "female/long-straight",
        "female/curly-shoulder",
        "female/top-knot",
    ):
        built.append(build_hair("hair/" + style, style))

    # Blender is Z-up, glTF is Y-up; the exporter handles that conversion, so the
    # runtime receives y-up meshes matching the scene's own axis convention.
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
    print("CHARACTER_LIBRARY_OBJECTS", len(built))
    print("CHARACTER_LIBRARY_TRIANGLES", triangles)
    print("CHARACTER_LIBRARY_BYTES", os.path.getsize(out))


if __name__ == "__main__":
    main()
