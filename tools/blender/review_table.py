"""Editable table material master and Blender MCP foreground review render."""
import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'src/assets/table.glb'))
parts={o.name:o for o in bpy.context.scene.objects}
def mat(name,color,rough=.85,metal=0,grain=False):
    m=bpy.data.materials.new(name);m.use_nodes=True;m.diffuse_color=(*color,1)
    nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    if grain:
        noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=380;noise.inputs['Detail'].default_value=2
        bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.18;bump.inputs['Distance'].default_value=.001
        links.new(noise.outputs['Fac'],bump.inputs['Height']);links.new(bump.outputs['Normal'],p.inputs['Normal'])
        ramp=nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(*(v*.8 for v in color),1);ramp.color_ramp.elements[1].color=(*(v*1.13 for v in color),1)
        links.new(noise.outputs['Fac'],ramp.inputs[0]);links.new(ramp.outputs[0],p.inputs['Base Color'])
    return m
felt=mat('Emerald pressed wool',(.006,.045,.023),.98,grain=True)
rail=mat('Charcoal upholstery',(.021,.026,.028),.88,grain=True)
trim=mat('Champagne brushed alloy',(.40,.30,.15),.36,.65)
wood=mat('Smoked walnut ledge',(.052,.042,.032),.6)
base=mat('Powder coated structural frame',(.023,.028,.033),.7,.15)
ivory=mat('Ivory paper and clay inlays',(.77,.73,.64),.92)
chip=mat('Burgundy clay',(.24,.025,.045),.85)
skin=mat('Hand warm ochre',(.51,.29,.16),.83)
for name,o in parts.items():
    material=felt if name=='table/felt' else rail if name=='table/rail' else trim if name in ['table/trim','table/seat-inlay'] else wood if name=='table/ledge' else base if name=='table/pedestal' else skin if name=='hand/peek' else chip if name=='chip/body' else ivory
    o.data.materials.clear();o.data.materials.append(material);o.asset_mark()
    if name in ['table/play-zone','table/seat-inlay']:o.hide_render=True
    if name=='hand/peek':o.location=(.6,-.27,.025)
    if name=='card':o.location=(.25,-.28,.006)
    if name.startswith('chip/'):
        o.location=(-.30,-.27,.006)
        for i in range(1,8):
            copy=o.copy();copy.data=o.data;bpy.context.collection.objects.link(copy);copy.location.z+=i*.0037
out=ROOT/'art/pass-one';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'table.blend'))
world=bpy.data.worlds.new('Review studio');world.use_nodes=True;bpy.context.scene.world=world
world.node_tree.nodes.get('Background').inputs[0].default_value=(.065,.080,.09,1)
world.node_tree.nodes.get('Background').inputs[1].default_value=.6
for pos,power,size in [((0,-1,3),400,3),((2,1,2),250,2),((-2,1,2),220,2)]:
    bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.size=size;o.rotation_euler=(-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2,-3,1.6));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,-.12))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=48
scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1280;scene.render.resolution_y=850;scene.render.resolution_percentage=100
scene.render.filepath=str(ROOT/'work/pass-one-table.png');scene.view_settings.view_transform='AgX'
bpy.ops.render.render(write_still=True)

for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(out/'table.blend'))
