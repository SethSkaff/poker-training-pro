"""Blender MCP material master and repeatable portrait/contact-sheet review."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
for obj in list(bpy.data.objects): bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'src/assets/foreground.glb'))
parts={o.name:o for o in bpy.context.scene.objects}

def material(name, color, rough=.83, metallic=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metallic
    return m
skin=material('Skin • warm ochre',(.56,.32,.19))
cloth=material('Wool • midnight blue',(.055,.09,.15))
hair=material('Hair • espresso',(.045,.027,.017))
ivory=material('Warm ivory',(.66,.62,.54))
iris=material('Iris • hazel',(.13,.16,.10))
dark=material('Lashes and brows',(.035,.02,.012))
lips=material('Warm facial detail',(.43,.22,.14))
brass=material('Brushed champagne alloy',(.48,.36,.18),.36,.65)
for name,o in parts.items():
    mat=skin if name.startswith('face/') or name=='neck' else hair if name.startswith('hair/') else cloth
    if name=='eyes/white':mat=ivory
    if name=='eyes/iris':mat=iris
    if name=='face/features':mat=dark
    if name=='face/lips':mat=lips
    if name.startswith('detail/'):mat=cloth
    if name in ['chair/frame','chair/piping','marker/band']:mat=brass
    o.data.materials.clear();o.data.materials.append(mat)
    o.asset_mark();o['units']='metres';o['purpose']='Pass one modular part; no animation clips'
    o.hide_render=True;o.hide_set(True)

# Preserve the complete reusable part library with named materials and origins.
out=ROOT/'art/pass-one';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'foreground.blend'))
skins=[(.67,.43,.28),(.30,.15,.08),(.82,.62,.43),(.44,.24,.14)]
styles=['short-side-part','bob','textured-crop','top-knot']
faces=['angular','high-cheek','broad-jaw','soft-round']
tops=['blazer','polo','hoodie','cardigan']
for i in range(4):
    x=(i-1.5)*.49
    for name in ['face/'+faces[i],'eyes/white','eyes/iris','face/features','face/lips','hair/'+styles[i],'top/'+tops[i],'detail/'+tops[i],'neck']:
        src=parts[name];o=src.copy();o.data=src.data.copy();bpy.context.collection.objects.link(o)
        o.hide_render=False;o.hide_set(False);o.location.x+=x
        if name.startswith(('face/','eyes/','hair/')):o.location.z+=1.17
        elif name=='neck':o.location.z+=1.02
        else:o.location.z+=.50
        if name.startswith('face/') and name not in ['face/features','face/lips']:
            o.data.materials.clear();o.data.materials.append(material('Skin variant '+str(i),skins[i]))

world=bpy.context.scene.world or bpy.data.worlds.new('Studio');bpy.context.scene.world=world
world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.09,.11,.13,1)
world.node_tree.nodes.get('Background').inputs[1].default_value=.5
for pos,power,size in [((-2,-3,4),350,4),((3,-1,2),220,3),((0,2,3),400,3)]:
    bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size
    l.rotation_euler=(Vector((0,0,1))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.25,-3.25,1.50));cam=bpy.context.object
cam.rotation_euler=(Vector((0,0,1.01))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=2.05
scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1400;scene.render.resolution_y=660;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(ROOT/'work/pass-one-portraits.png')
scene.view_settings.view_transform='AgX'
bpy.ops.render.render(write_still=True)

# Open the editable master directly onto the reviewed character lineup.
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(out/'foreground.blend'))
