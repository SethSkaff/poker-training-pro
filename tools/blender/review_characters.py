"""Repeatable character-only contact sheet and editable Blender material master."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
for data in list(bpy.data.meshes):
    if data.users==0:bpy.data.meshes.remove(data)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'src/assets/foreground.glb'))
parts={o.name:o for o in bpy.context.scene.objects}
OUT=ROOT/'art/character-revision';OUT.mkdir(parents=True,exist_ok=True)

def mat(name,h,rough=.85,textile=False):
    rgb=[int(h[i:i+2],16)/255 for i in (1,3,5)]
    rgb=[c/12.92 if c<.04045 else ((c+.055)/1.055)**2.4 for c in rgb]
    m=bpy.data.materials.new(name);m.diffuse_color=(*rgb,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*rgb,1);p.inputs['Roughness'].default_value=rough
    if textile:
        noise=m.node_tree.nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=700;noise.inputs['Detail'].default_value=1
        bump=m.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.0006
        m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])
    return m
for name,o in parts.items():
    o.hide_render=True;o.hide_set(True);o.asset_mark();o['units']='metres';o['revision']='character construction / no animation'
    o.data.materials.clear();o.data.materials.append(mat(name,'#84776a'))

def copy(part,x,height,material):
    src=parts[part];o=src.copy();o.data=src.data.copy();bpy.context.collection.objects.link(o)
    o.hide_render=False;o.hide_set(False);o.location.x+=x;o.location.z+=height
    o.data.materials.clear();o.data.materials.append(material);return o

def fit(o,jaw,nose,skin=False):
    for v in o.data.vertices:
        x,zz,y=v.co;z=-zz;weight=min(1,max(0,(-y-.043)/.055));x*=1+jaw*weight
        if z>0:z+=jaw*.035*weight
        if skin and z>.068 and abs(x)<.028 and -.040<y<.058:
            lateral=math.exp(-(x/.019)**2);tip=math.exp(-((y+.017)/.020)**2);bridge=math.exp(-((y-.012)/.027)**2)
            if nose=='button':z-=lateral*(.010*tip+.006*bridge)
            if nose=='aquiline':z+=lateral*(.009*bridge+.002*tip)
            if nose=='broad':x*=1+.22*tip;z-=.004*lateral*bridge
        v.co=(x,-z,y)

def beard_surface(o,skin_mat,hair_mat):
    skin=skin_mat.diffuse_color;hair=hair_mat.diffuse_color
    colors=o.data.color_attributes.new(name='Beard feather',type='FLOAT_COLOR',domain='POINT')
    for i,v in enumerate(o.data.vertices):
        x,zz,y=v.co;edge=-.040-.30*(.076-abs(x))
        coverage=.78 if y>-.055 else min(1,max(.10,(edge-y)/.025))
        weight=coverage*.85
        colors.data[i].color=tuple(skin[k]*(1-weight)+hair[k]*weight for k in range(3))+(1,)
    material=hair_mat.copy();material.name='Feathered facial hair'
    attr=material.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='Beard feather'
    material.node_tree.links.new(attr.outputs['Color'],material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    o.data.materials.clear();o.data.materials.append(material)

faces=['broad-jaw','narrow','soft-round','angular','high-cheek','heavy-brow']
hairs=['buzz','wavy','bob','short-side-part','curly','receding']
tops=['polo','flannel','cardigan','waistcoat','hoodie','blazer']
skins=['#8d5a3a','#e5bd9a','#cf9e78','#cf9e78','#65402a','#e5bd9a']
haircolors=['#181311','#443024','#30241e','#31251f','#191412','#77716d']
clothes=['#245c4c','#743a43','#817149','#26303b','#3f5a74','#37415c']
beards=['short-beard','none','none','none','goatee','mustache']
eyes=['hooded','almond','open','almond','open','hooded']
brows=['heavy','straight','arched','straight','heavy','heavy']
mouths=['full','thin','full','neutral','neutral','thin']
noses=['broad','aquiline','button','aquiline','broad','straight']
jaws=[.075,-.075,0,0,-.075,.075]
for i in range(6):
    x=(i-2.5)*.43
    skin=mat('Skin '+str(i),skins[i]);cloth=mat('Woven cloth '+str(i),clothes[i],.88,True)
    hair=mat('Hair '+str(i),haircolors[i],.76,True);white=mat('Sclera '+str(i),'#b8aca0',.65)
    iris=mat('Iris '+str(i),'#4a4836',.68);dark=mat('Facial seams '+str(i),'#30251f')
    lip=mat('Lip '+str(i),skins[i]);shirt=mat('Cotton shirt '+str(i),'#d8d5c9',.90,True)
    fit(copy('face/'+faces[i],x,1.1728,skin),jaws[i],noses[i],True);copy('neck',x,1.02,skin)
    copy('hair/'+hairs[i],x,1.1728,hair)
    for part,material in [('eyes/white-'+eyes[i],white),('eyes/iris-'+eyes[i],iris),('eyes/pupil-'+eyes[i],dark),('eyes/lids-'+eyes[i],skin),('brows/'+brows[i],hair),('mouth/lips-'+mouths[i],lip),('mouth/seam-'+mouths[i],dark)]:copy(part,x,1.1728,material)
    if beards[i]!='none':
        beard=copy('beard/'+faces[i]+'/'+beards[i],x,1.1728,hair);fit(beard,jaws[i],noses[i]);beard_surface(beard,skin,hair)
    for part,material in [('top/'+tops[i],cloth),('detail/'+tops[i],cloth)]:copy(part,x,.50,material)
    if 'insert/'+tops[i] in parts:copy('insert/'+tops[i],x,.50,shirt)
    if i==3:copy('dealer/tie',x,.50,mat('Burgundy silk','#763943',.80))
    if i==5:copy('face/age-folds',x,1.1728,lip)

world=bpy.context.scene.world or bpy.data.worlds.new('Character studio');bpy.context.scene.world=world
world.use_nodes=True;world.node_tree.nodes.get('Background').inputs[0].default_value=(.12,.15,.18,1);world.node_tree.nodes.get('Background').inputs[1].default_value=.6
for pos,power,size in [((-3,-4,4),550,4),((3,-2,2),260,3),((0,2,3),500,3)]:
    bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.size=size
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.1,-4,1.58));cam=bpy.context.object;cam.data.type='ORTHO';cam.data.ortho_scale=2.64
cam.rotation_euler=(Vector((0,0,1.07))-cam.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene;scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=2000;scene.render.resolution_y=820;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'cast.png');scene.view_settings.view_transform='AgX'
bpy.ops.render.render(write_still=True)
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':area.spaces.active.region_3d.view_perspective='CAMERA'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'characters.blend'),compress=True)
# A closer face contact sheet uses the same assembled models and materials.
cam.location=(.10,-4,1.36);cam.rotation_euler=(Vector((0,0,1.183))-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.resolution_y=340;scene.render.filepath=str(OUT/'faces.png')
bpy.ops.render.render(write_still=True)
