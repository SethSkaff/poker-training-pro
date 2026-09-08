"""Pass-one original foreground kit. Execute stages through Blender MCP.

All functions use runtime metres (+Y up, +Z forward); mesh() converts to
Blender Z-up. Parts have local origins suitable for the existing joint graph.
No third-party models, images, or animation clips are used.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PI = math.pi
sin, cos = math.sin, math.cos

def mesh(name, verts, faces, smooth=True):
    old = bpy.data.meshes.get(name)
    if old and old.users == 0: bpy.data.meshes.remove(old)
    data = bpy.data.meshes.new(name)
    data.from_pydata([(x,-z,y) for x,y,z in verts], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    for p in data.polygons: p.use_smooth = smooth
    uv = data.uv_layers.new(name='UVMap')
    for loop in data.loops:
        x,z,y = data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv = (x+0.5, y+0.5)
    return obj

def loft(name, levels, n=32):
    # height, halfwidth, depth, forward offset; closed continuous shell.
    v=[]; f=[]
    for y,w,d,z in levels:
        for i in range(n):
            a=2*PI*i/n
            v.append((sin(a)*w,y,cos(a)*d+z))
    for j in range(len(levels)-1):
        for i in range(n):
            a=j*n+i; b=j*n+(i+1)%n
            f.append((a,b,b+n,a+n))
    f.extend([tuple(reversed(range(n))),tuple((len(levels)-1)*n+i for i in range(n))])
    return mesh(name,v,f)

def ellipsoid(name, center, scale, n=24, rings=12):
    levels=[]
    for j in range(rings+1):
        t=PI*j/rings
        levels.append((center[1]-cos(t)*scale[1], max(.00005,sin(t)*scale[0]),max(.00005,sin(t)*scale[2]),center[2]))
    o=loft(name,levels,n)
    for v in o.data.vertices: v.co.x+=center[0]
    return o

def join(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    o=objects[0]; o.name=name; o.data.name=name
    return o

def tube(name, points, radii, n=10):
    v=[]; f=[]
    for j,p in enumerate(points):
        p=Vector(p)
        tangent=(Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])).normalized()
        side=tangent.cross(Vector((0,0,1)))
        if side.length<.01: side=tangent.cross(Vector((1,0,0)))
        side.normalize(); up=tangent.cross(side).normalized()
        for i in range(n):
            a=2*PI*i/n; q=p+radii[j]*(cos(a)*side+sin(a)*up)
            v.append(tuple(q))
    for j in range(len(points)-1):
        for i in range(n):
            a=j*n+i; b=j*n+(i+1)%n
            f.append((a,b,b+n,a+n))
    f.extend([tuple(reversed(range(n))),tuple((len(points)-1)*n+i for i in range(n))])
    return mesh(name,v,f)

def bevel_box(name, center, scale, radius=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(center[0],-center[2],center[1]))
    o=bpy.context.object; o.name=name; o.dimensions=(scale[0],scale[2],scale[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=o.modifiers.new('soft manufactured edge','BEVEL'); mod.width=radius; mod.segments=3
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    for p in o.data.polygons:p.use_smooth=True
    mod=o.modifiers.new('weighted normals','WEIGHTED_NORMAL'); mod.keep_sharp=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return o

FACE_NAMES=['broad-jaw','narrow','soft-round','angular','high-cheek','heavy-brow']

def head(variant):
    # A shared upper cranium keeps every hair cap compatible. Lower facial
    # sections vary jaw, chin and cheek volumes rather than scaling an egg.
    jaw=[1.10,.87,1.03,.97,.91,1.05][variant]
    cheek=[1.02,.94,1.06,1.0,1.07,1.02][variant]
    levels=[(-.106,.022,.035,.017),(-.098,.044*jaw,.050,.014),(-.084,.061*jaw,.061,.010),
      (-.063,.072*jaw,.071,.004),(-.042,.078*cheek,.079,0),(-.022,.084*cheek,.080,0),
      (0,.087,.079,0),(.022,.085,.077,0),(.045,.084,.079,-.002),(.068,.079,.078,-.004),
      (.087,.066,.068,-.006),(.102,.047,.049,-.006),(.111,.022,.025,-.006),(.114,.001,.001,-.006)]
    # Interpolate section rings; sculpt nose bridge, tip, muzzle and eye sockets
    # directly into the surface, avoiding detached nose/cheek primitives.
    dense=[]
    for a,b in zip(levels,levels[1:]):
        for k in range(1): dense.append(tuple(a[i] for i in range(4)))
    dense.append(levels[-1]); n=32; v=[];f=[]
    for y,w,d,z in dense:
        for i in range(n):
            a=2*PI*i/n; x=sin(a)*w; front=max(0,cos(a))
            zz=cos(a)*d+z
            if front>0:
                nose=.028*math.exp(-(x/.017)**2-((y+.015)/.025)**2)
                bridge=.012*math.exp(-(x/.011)**2-((y-.016)/.038)**2)
                sockets=.008*math.exp(-((abs(x)-.035)/.020)**2-((y-.018)/.014)**2)
                muzzle=.007*math.exp(-(x/.036)**2-((y+.054)/.021)**2)
                zz+=(nose+bridge-sockets+muzzle)*front**3
            v.append((x,y,zz))
    for j in range(len(dense)-1):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;f.append((a,b,b+n,a+n))
    o=mesh('face/'+FACE_NAMES[variant],v,f)
    ears=[ellipsoid('ear', (s*.085,-.008,-.003),(.013,.026,.013),16,10) for s in [-1,1]]
    return join(o.name,[o]+ears)

def eyes():
    whites=[]; irises=[]; dark=[]; lips=[]
    for s in [-1,1]:
        # Small inset almond surfaces, framed by soft lids. They sit against
        # the sculpted sockets, never on rectangular planes.
        whites.append(ellipsoid('white',(s*.034,.018,.072),(.015,.0048,.0025),20,8))
        irises.append(ellipsoid('iris',(s*.034,.018,.0745),(.0043,.0045,.001),20,8))
        dark.append(ellipsoid('pupil',(s*.034,.018,.0752),(.002,.0028,.0006),16,8))
        dark.append(tube('brow',[(s*.017,.037,.078),(s*.031,.041,.076),(s*.048,.038,.070)], [.0018,.0026,.0012],8))
        lips.append(tube('lid',[(s*.017,.018,.074),(s*.027,.025,.075),(s*.040,.025,.073),(s*.051,.018,.069)], [.001,.0016,.0014,.0006],8))
    dark.append(tube('mouth seam',[(-.021,-.056,.081),(0,-.057,.086),(.021,-.056,.081)],[.0006,.001,.0006],8))
    lips.append(tube('lower lip',[(-.019,-.058,.081),(0,-.060,.086),(.019,-.058,.081)],[.0008,.002,.0008],10))
    return [join('eyes/white',whites),join('eyes/iris',irises),join('face/features',dark),join('face/lips',lips)]

HAIRS=['buzz','short-side-part','textured-crop','slick-back','ponytail','bob','long-straight','curly-shoulder','top-knot']
def hair(style):
    v=[];f=[];n=32;rings=10
    extra={'buzz':.002,'short-side-part':.009,'textured-crop':.008,'slick-back':.006}.get(style,.006)
    for j in range(rings+1):
        for i in range(n):
            a=2*PI*i/n; front=max(0,cos(a))
            hairline={'buzz':.88,'short-side-part':1.08+.16*sin(a),'textured-crop':1.13+.035*sin(9*a),'slick-back':.93,'bob':1.06+.10*abs(sin(a)),'top-knot':.98,'ponytail':1.0}.get(style,1.06)
            end=1.76-(1.76-hairline)*front**2
            t=.015+(end-.015)*j/rings
            wave=(.0015*sin(a*12+t*9) if style in ['textured-crop','curly-shoulder'] else .0007*sin(a*15))
            lift=extra*(1+.65*sin(a))
            if style=='short-side-part':lift+=.009*max(0,-sin(a))*sin(t)
            if style=='textured-crop':lift+=.0025*sin(8*a+t*6)**2
            y=cos(t)*.114
            scalp=[(-.025,.086,.081), (0,.087,.079),(.022,.085,.077),(.045,.084,.079),(.068,.079,.078),(.087,.066,.068),(.102,.047,.049),(.111,.022,.025),(.114,.001,.001)]
            lo,hi=scalp[0],scalp[-1]
            for q,r in zip(scalp,scalp[1:]):
                if q[0]<=y<=r[0]:lo,hi=q,r;break
            blend=max(0,min(1,(y-lo[0])/(hi[0]-lo[0])))
            w=lo[1]+(hi[1]-lo[1])*blend
            d=lo[2]+(hi[2]-lo[2])*blend
            v.append((sin(a)*(w+.003+lift+wave),y+lift*.6,cos(a)*(d+.004+lift+wave)-.002))
    for j in range(rings):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;f.append((a,a+n,b+n,b))
    f.append(tuple(range(n)))
    o=mesh('hair/'+style,v,f);parts=[o]
    if style in ['bob','long-straight','curly-shoulder']:
        length={'bob':.11,'long-straight':.23,'curly-shoulder':.19}[style]
        for s in [-1,1]:
            for k in range(6):
                x=s*(.076-k*.006);z=-.015-k*.014
                pts=[(x,.044,z),(s*.092,-.025,z-.008),(s*(.081+.007*sin(k)),-length,z+.006)]
                parts.append(tube('hair lock',pts,[.015,.019,.010],10))
    if style in ['ponytail','top-knot']:
        parts.append(ellipsoid('gather',(0,.076,-.085),(.040,.035,.031)))
        if style=='ponytail': parts.append(tube('tail',[(0,.07,-.10),(0,-.01,-.125),(.012,-.16,-.13)],[.026,.029,.016],16))
        else:parts.append(ellipsoid('knot',(0,.132,-.034),(.036,.025,.033)))
    return join('hair/'+style,parts)

def garments():
    out=[]
    names=['hoodie','track-jacket','polo','blazer','flannel','tee','puffer','cardigan','waistcoat','turtleneck']
    for name in names:
        bulk=1.05 if name in ['puffer','hoodie'] else 1
        levels=[(0,.153,.103,0),(.025,.158,.11,0),(.11,.161,.113,0),(.23,.180,.124,0),(.35,.194,.130,0),(.43,.203,.125,0),(.48,.205,.109,0),(.515,.172,.088,0),(.54,.055,.052,0)]
        o=loft('top/'+name,[(y,w*bulk,d*bulk,z) for y,w,d,z in levels])
        out.append(o);parts=[]
        if name in ['blazer','cardigan','waistcoat']:
            for s in [-1,1]:
                parts.append(mesh('lapel',[(s*.054,.505,.075),(s*.122,.440,.109),(s*.046,.285,.132),(s*.018,.370,.136)],[(0,1,2,3)],False))
        elif name in ['polo','flannel','track-jacket']:
            for s in [-1,1]:parts.append(mesh('collar',[(s*.015,.493,.076),(s*.068,.515,.066),(s*.089,.450,.105),(s*.035,.46,.107)],[(0,1,2,3)],False))
        elif name=='hoodie':
            parts.append(tube('hood',[(-.09,.47,-.045),(-.085,.55,-.08),(0,.57,-.095),(.085,.55,-.08),(.09,.47,-.045)],[.030]*5,12))
        else:
            parts.append(loft('neck binding',[(.496,.060,.056,0),(.52 if name!='turtleneck' else .56,.054,.050,0)],32))
        if name not in ['tee','turtleneck']:
            parts.append(tube('placket',[(0,.06,.115),(0,.25,.134),(0,.43,.13)],[.0025]*3,8))
        for part in parts:
            if name in ['blazer','cardigan','waistcoat','polo','flannel','track-jacket']:
                bm=bmesh.new();bm.from_mesh(part.data)
                bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=4,use_grid_fill=True)
                bm.to_mesh(part.data);bm.free()
                for polygon in part.data.polygons:polygon.use_smooth=True
                for vertex in part.data.vertices:
                    x,z,y=vertex.co
                    low,high=levels[0],levels[-1]
                    for q,r in zip(levels,levels[1:]):
                        if q[0]<=y<=r[0]:low,high=q,r;break
                    t=max(0,min(1,(y-low[0])/(high[0]-low[0])))
                    w=(low[1]+(high[1]-low[1])*t)*bulk
                    d=(low[2]+(high[2]-low[2])*t)*bulk
                    vertex.co.y=-(d*math.sqrt(max(.01,1-(x/w)**2))+.007)
        out.append(join('detail/'+name,parts))
    out.append(loft('top/hem',[(.015,.158,.111,0),(.022,.159,.112,0)],32))
    out.append(loft('neck',[(0,.055,.05,0),(.04,.050,.046,0),(.075,.048,.045,0)],24))
    # Sleeves follow a normalized +Y axis and are mapped between current joints.
    out.append(loft('limb/sleeve',[(0,.92,.92,0),(.08,1,1,0),(.4,.97,.97,0),(.75,.86,.86,0),(1,.80,.80,0)],16))
    out.append(loft('limb/forearm',[(0,1,1,0),(.12,1.04,1.04,0),(.55,.87,.87,0),(1,.64,.64,0)],16))
    parts=[]
    for s in [-1,1]:
        parts.append(tube('trouser',[(s*.095,.48,0),(s*.13,.43,.26),(s*.14,.12,.29)],[.089,.073,.047],16))
        parts.append(ellipsoid('shoe',(s*.14,.063,.34),(.069,.046,.128),20,10))
    out.append(join('body/legs',parts))
    return out

def furniture():
    out=[]
    seat=bevel_box('pan',(0,.455,.015),(.46,.075,.43),.034)
    back=bevel_box('back',(0,.755,-.195),(.445,.51,.085),.045)
    out.append(join('chair/upholstery',[seat,back]))
    parts=[]
    for s in [-1,1]:
        parts.append(tube('frame',[(s*.19,.04,-.19),(s*.185,.43,-.17),(s*.17,.86,-.24)],[.014]*3,12))
        parts.append(tube('front leg',[(s*.20,.04,.20),(s*.17,.44,.16)],[.014]*2,12))
    out.append(join('chair/frame',parts))
    parts=[]
    for s in [-1,1]:parts.append(tube('piping',[(s*.195,.53,-.147),(s*.196,.92,-.147),(s*.165,.98,-.147)],[.0025]*3,8))
    out.append(join('chair/piping',parts))
    # Buttons: stepped opaque ceramic bodies and a recessed face with planar UV.
    out.append(loft('marker/body',[(-.0045,.026,.026,0),(-.003,.028,.028,0),(.003,.028,.028,0),(.0045,.026,.026,0)],48))
    o=loft('marker/face',[(.0047,.0248,.0248,0),(.0048,.0248,.0248,0)],48)
    uv=o.data.uv_layers.active
    for loop in o.data.loops:
        x,z,y=o.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv=(x/.05+.5,-z/.05+.5)
    out.append(o)
    out.append(loft('marker/band',[(-.001,.0282,.0282,0),(.001,.0282,.0282,0)],48))
    return out

def export_kit():
    path=ROOT/'src/assets/foreground.glb'
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_materials='NONE',export_yup=True,export_apply=True)
    print('FOREGROUND',len(bpy.data.objects),'objects',path.stat().st_size,'bytes')

def build_kit():
    for obj in list(bpy.data.objects): bpy.data.objects.remove(obj,do_unlink=True)
    for data in list(bpy.data.meshes):
        if data.users == 0:bpy.data.meshes.remove(data)
    for i in range(6):head(i)
    eyes()
    for style in HAIRS:hair(style)
    garments();furniture()
    export_kit()

if __name__=='__main__':build_kit()
