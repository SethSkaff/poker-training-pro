"""Character-only revision of the existing foreground kit; run through Blender MCP.

Keeps furniture, markers, limbs and seated lower bodies byte-equivalent at the
geometry level. Metres, +Y up / +Z forward in recipe coordinates. The shared
temple and eye socket envelope is deliberate: modules fit without random offsets.
"""
import bpy, bmesh, math, sys, importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('foreground_base',Path(__file__).with_name('build_foreground.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
mesh,loft,tube,join,ellipsoid=base.mesh,base.loft,base.tube,base.join,base.ellipsoid
sin,cos,pi=math.sin,math.cos,math.pi
FACE_NAMES=base.FACE_NAMES
HAIRS=['buzz','short-side-part','textured-crop','slick-back','wavy','curly','receding','ponytail','bob','long-straight','curly-shoulder','top-knot']

def gauss(x,c,w):return math.exp(-((x-c)/w)**2)

def face_levels(i):
    # Each silhouette has its own chin, mandibular angle, cheek shelf and brow.
    jaw=[1.13,.80,1.05,.97,.87,1.09][i]
    cheek=[1.02,.92,1.08,.96,1.06,1.0][i]
    chin=[.034,.022,.030,.026,.024,.034][i]
    return [(-.108,chin,.036,.019),(-.099,.045*jaw,.052,.012),
      (-.084,.065*jaw,.061,.007),(-.065,.074*jaw,.067,.005),
      (-.049,.076*cheek,.075,.003),(-.034,.080*cheek,.079,0),
      (-.024,.084*cheek,.080,0),(-.014,.087*cheek,.079,0),
      (0,.087,.078,0),(.012,.086,.077,0),(.020,.085,.077,0),
      (.028,.085,.078,0),(.039,.084,.080,0),(.052,.083,.079,-.002),
      (.068,.079,.078,-.004),(.087,.066,.068,-.006),
      (.102,.047,.049,-.006),(.111,.022,.025,-.006),(.114,.001,.001,-.006)]

def face_point(i,y,w,d,z,a):
    x=sin(a)*w;front=max(0,cos(a));zz=cos(a)*d+z
    if front>0:
        # Deliberate nasal bridge, alar wings and tip, not a single Gaussian bump.
        bridge=.017*gauss(x,0,.013)*gauss(y,.010,.031)
        tip=.024*gauss(x,0,.017)*gauss(y,-.018,.014)
        wings=.006*gauss(abs(x),.016,.009)*gauss(y,-.025,.009)
        brow=[.006,.003,.003,.008,.005,.012][i]*gauss(abs(x),.035,.020)*gauss(y,.039,.010)
        socket=.010*gauss(abs(x),.034,.018)*gauss(y,.020,.012)
        cheek=[.007,.002,.009,.011,.014,.006][i]*gauss(abs(x),.055,.023)*gauss(y,-.012,.022)
        hollow=[.003,.005,0,.009,.007,.004][i]*gauss(abs(x),.058,.017)*gauss(y,-.046,.018)
        muzzle=.006*gauss(x,0,.031)*gauss(y,-.052,.014)
        chin=.009*gauss(x,0,.029)*gauss(y,-.090,.013)
        zz+=(bridge+tip+wings+brow-socket+cheek-hollow+muzzle+chin)*front**2
    return x,y,zz

def heads():
    for variant,name in enumerate(FACE_NAMES):
        levels=face_levels(variant);n=48;v=[];f=[]
        for y,w,d,z in levels:
            for i in range(n):v.append(face_point(variant,y,w,d,z,2*pi*i/n))
        for j in range(len(levels)-1):
            for i in range(n):
                a=j*n+i;b=j*n+(i+1)%n;f.append((a,b,b+n,a+n))
        f.extend([tuple(reversed(range(n))),tuple((len(levels)-1)*n+i for i in range(n))])
        head=mesh('face/'+name,v,f)
        # Shaped pinna with inset concha, built as a folded rim rather than spheres.
        ears=[]
        for s in [-1,1]:
            outline=[(.084,.010,-.006),(.092,.018,-.009),(.100,.008,-.008),(.102,-.010,-.004),(.096,-.028,.002),(.087,-.030,.002),(.085,-.012,.005)]
            ev=[(s*x,y,z) for x,y,z in outline]+[(s*.092,-.008,.007)]
            ears.append(mesh('pinna',ev,[(j,(j+1)%7,7) for j in range(7)]))
        join('face/'+name,[head]+ears)
        # Low-profile fitted patches with a feathered silhouette. Stubble uses
        # sparse vertex stipple at runtime; beard is a short jaw-following shell.
        for kind in ['stubble','short-beard','goatee','mustache']:
            vv=[];ff=[]
            for j in range(len(levels)-1):
                for k in range(n):
                    ids=[j*n+k,j*n+(k+1)%n,(j+1)*n+(k+1)%n,(j+1)*n+k]
                    cx=sum(v[q][0] for q in ids)/4;cy=sum(v[q][1] for q in ids)/4;cz=sum(v[q][2] for q in ids)/4
                    selected=cz>.023 and -.104<cy<(-.040-.30*(.076-abs(cx))) and not(abs(cx)<.027 and cy>-.071)
                    if kind=='goatee':selected=selected and abs(cx)<.030
                    if kind=='mustache':selected=False
                    if selected:
                        start=len(vv)
                        for q in ids:
                            x,y,z=v[q];vv.append((x*1.003,y,z+.0005+(.0006 if kind=='short-beard' else 0)))
                        ff.append(tuple(start+t for t in range(4)))
            pieces=[]
            if vv:
                patch=mesh('beard patch',vv,ff)
                bm=bmesh.new();bm.from_mesh(patch.data)
                bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
                bm.to_mesh(patch.data);bm.free()
                pieces.append(patch)
            if kind in ['short-beard','goatee','mustache']:
                for s in [-1,1]:
                    pieces.append(mesh('mustache wing',[(s*.002,-.039,.084),(s*.012,-.037,.084),(s*.025,-.047,.079),(s*.023,-.052,.080),(s*.011,-.046,.084),(s*.002,-.045,.086)],[(0,1,4,5),(1,2,3,4)]))
            join('beard/'+name+'/'+kind,pieces)

def feature_modules():
    for style,height,slant in [('almond',.0048,.001),('hooded',.0032,-.0005),('open',.0060,.0005)]:
        whites=[];irises=[];pupils=[];lids=[]
        for s in [-1,1]:
            cx=s*.034;cy=.020
            def pos(x,y,depth=0):return (cx+s*x,cy+y, .0735-.12*x+depth)
            # Six-sided almond with a subtly convex middle; fully rimmed in skin.
            contour=[(-.014,0),(-.007,height),(.004,height+slant),(.014,slant),(.005,-height*.65),(-.006,-height*.65)]
            verts=[pos(x,y) for x,y in contour]+[pos(0,0,.0015)]
            whites.append(mesh('sclera',verts,[(j,(j+1)%6,6) for j in range(6)]))
            irises.append(ellipsoid('iris',pos(0,0,.0018),(.0032,height*.82,.0007),12,4))
            pupils.append(ellipsoid('pupil',pos(0,0,.00235),(.0015,height*.61,.00035),10,4))
            inner=[pos(x,y,.0002) for x,y in contour]
            outer=[pos(x*1.14,y*1.55,-.0012) for x,y in contour]
            lids.append(mesh('eyelid',inner+outer,[(j,(j+1)%6,(j+1)%6+6,j+6) for j in range(6)]))
            lids.append(tube('socket crease',[pos(-.013,height+.003,-.001),pos(0,height+.004,.0002),pos(.014,height+.001,-.001)],[.0005,.0008,.0004],5))
        for prefix,parts in [('eyes/white-',whites),('eyes/iris-',irises),('eyes/pupil-',pupils),('eyes/lids-',lids)]:join(prefix+style,parts)
    for style,thick,arch in [('straight',.0021,.001),('arched',.0016,.004),('heavy',.0035,.002)]:
        pieces=[]
        for s in [-1,1]:
            xs=[.017,.025,.036,.048,.054];ys=[.039,.041+arch,.041+arch,.039,.036]
            v=[(s*x,y+sign*thick*(1-.55*j/4),.083-.30*(x-.017)) for sign in [-1,1] for j,(x,y) in enumerate(zip(xs,ys))]
            pieces.append(mesh('brow',v,[(j,j+1,j+6,j+5) for j in range(4)]))
        join('brows/'+style,pieces)
    for style,width,full in [('neutral',.023,.0020),('full',.026,.0035),('thin',.022,.0012)]:
        xs=[-width,-width*.5,0,width*.5,width];seam=[];v=[]
        for x in xs:
            z=.080+.006*(1-(x/width)**2);y=-.056-.0005*cos(x/width*pi)
            seam.append((x,y,z+.0003))
            cupid=1-abs(x/width);upper=full*(.65+.45*sin(abs(x/width)*pi))*cupid
            v.extend([(x,y+upper,z-.0003),(x,y,z+.0002),(x,y-full*1.1*cupid,z-.0003)])
        lip=mesh('mouth/lips-'+style,v,[(j*3+k,(j+1)*3+k,(j+1)*3+k+1,j*3+k+1) for j in range(4) for k in range(2)])
        tube('mouth/seam-'+style,seam,[.00025,.00055,.00055,.00055,.00025],5)
    # Minimal nasolabial/under-eye folds for mature faces; tonal, not black lines.
    pieces=[]
    for s in [-1,1]:
        pieces.append(tube('age fold',[(s*.025,-.029,.081),(s*.031,-.042,.076),(s*.029,-.055,.076)],[.00025,.00065,.0002],5))
        pieces.append(tube('eye fold',[(s*.023,.009,.072),(s*.035,.007,.070),(s*.046,.012,.067)],[.0002,.0005,.0002],5))
    join('face/age-folds',pieces)

def scalp(y):
    levels=face_levels(0)
    for q,r in zip(levels,levels[1:]):
        if q[0]<=y<=r[0]:
            t=(y-q[0])/(r[0]-q[0]);return q[1]+(r[1]-q[1])*t,q[2]+(r[2]-q[2])*t,q[3]+(r[3]-q[3])*t
    return .001,.001,-.006

def hairstyles():
    for style in HAIRS:
        n=48;rings=12;v=[];f=[]
        for j in range(rings+1):
            t=j/rings
            for i in range(n):
                a=2*pi*i/n;front=max(0,cos(a));side=sin(a)
                line=-.035+.093*front**.24
                if style=='textured-crop':line-=.014*front+.002*cos(a*11)*front
                if style=='short-side-part':line+=.008*side*front
                if style=='slick-back':line+=.010*front
                if style=='receding':line+=.035*front+.024*gauss(abs(side),.65,.23)
                if style=='bob':line-=.008*front
                if style in ['bob','long-straight','curly-shoulder'] and front<.53:
                    line={'bob':-.091,'long-straight':-.211,'curly-shoulder':-.175}[style]+.009*sin(a*7)
                y=.114*(1-t)+line*t;w,d,z=scalp(min(.114,y))
                if style in ['bob','long-straight','curly-shoulder'] and y<.038:
                    w=.085+.004*cos(y*17);d=.081;z=-.005
                volume={'buzz':.0016,'receding':.003,'short-side-part':.007,'slick-back':.006,'textured-crop':.006,'wavy':.009,'curly':.010}.get(style,.005)
                ridge=.0018*(.5+.5*cos(14*a+4*t)) if style!='buzz' else .0003*cos(24*a)
                if style=='short-side-part':ridge=.003*(1+cos(13*a+5*t));slope=gauss(a,.48,.065);ridge-=.003*slope
                sweep=(.019*max(0,-side)*sin(t*pi) if style in ['short-side-part','slick-back','wavy'] else 0)
                if style=='slick-back':sweep=.016*max(0,-cos(a))*sin(t*pi)
                if style=='wavy':ridge=.0035*(1+sin(a*8+t*12));sweep+=.009*sin(t*pi)
                if style in ['curly','curly-shoulder']:ridge=.006*(1+sin(a*15+t*13)*sin(t*26));sweep=.012*sin(t*pi)
                if style=='textured-crop':ridge=.0025*(1+sin(a*17+t*8));sweep=.004*sin(t*pi)
                lift=volume+ridge+sweep
                v.append((side*(w+lift),y+lift*(1-t*.6),cos(a)*(d+lift)+z))
        for j in range(rings):
            for i in range(n):
                a=j*n+i;b=j*n+(i+1)%n;f.append((a,a+n,b+n,b))
        f.append(tuple(range(n)));cap=mesh('scalp',v,f)
        for loop in cap.data.loops:
            idx=loop.vertex_index;cap.data.uv_layers.active.data[loop.index].uv=(idx%n/n,idx//n/rings)
        pieces=[cap]
        # Tapered, flattened locks give direction and separate outer silhouettes.
        def lock(points,widths):
            obj=tube('directional lock',points,widths,6)
            # Six-sided locks retain a broad facet and a narrow ridge.
            pieces.append(obj)
        if style in ['ponytail','top-knot']:
            for k in range(7):
                a=k*2*pi/7
                if style=='ponytail':lock([(sin(a)*.014,.080,-.085),(sin(a)*.019,.012,-.125),(sin(a)*.010+.018,-.153,-.128)],[.012,.013,.004])
                else:lock([(sin(a)*.025,.113,-.025),(sin(a+.8)*.028,.140,-.025+cos(a+.8)*.018),(0,.152,-.035)],[.010,.013,.005])
        join('hair/'+style,pieces)

TOPS=['hoodie','track-jacket','polo','blazer','flannel','tee','puffer','cardigan','waistcoat','turtleneck']
def garments():
    # Separate character sleeves, so the shared POV limb source is untouched.
    loft('sleeve/cloth',[(0,.94,.94,0),(.06,1,1,0),(.31,.96,.96,0),(.48,.88,.90,0),(.53,.93,.91,0),(.59,.85,.87,0),(.85,.79,.80,0),(.89,.82,.82,0),(.92,.83,.83,0),(1,.77,.77,0)],16)
    for name in TOPS:
        bulk={'hoodie':1.08,'puffer':1.10,'blazer':1.04,'tee':.98,'waistcoat':.96,'cardigan':1.02}.get(name,1)
        levels=[(0,.151,.103,0),(.018,.157,.108,0),(.065,.160,.113,0),(.14,.166,.116,0),(.25,.179,.124,0),(.36,.192,.129,0),(.43,.202,.125,0),(.48,.205,.109,0),(.515,.166,.082,0),(.54,.053,.049,0)]
        if name=='puffer':
            levels=[(y,w*(1+.022*sin(y*65)),d*(1+.045*sin(y*65)),z) for y,w,d,z in levels]
        levels=[(y,w*bulk,d*bulk,z) for y,w,d,z in levels]
        def surface(x,y,offset=.0015):
            q,r=levels[0],levels[1]
            for a,b in zip(levels,levels[1:]):
                if a[0]<=y<=b[0]:q,r=a,b;break
            t=max(0,min(1,(y-q[0])/(r[0]-q[0])));w=q[1]+(r[1]-q[1])*t;d=q[2]+(r[2]-q[2])*t
            return d*math.sqrt(max(0,1-(x/w)**2))+offset
        torso=loft('top/'+name,levels,32)
        # Local cloth tension at the waist/armhole, not tiled block patterns.
        for vertex in torso.data.vertices:
            x,z,y=vertex.co
            if .04<y<.44:
                vertex.co.y-=.0018*sin(y*80+abs(x)*36)*gauss(abs(x),.12,.045)
        detail=[];inserts=[]
        def panel(label,coords,offset=.002):
            # A shallow folded panel following the chest; triangulated fan with
            # supported intermediate edges avoids thick floating applique blocks.
            pts=[(x,y,surface(x,y,offset)) for x,y in coords]
            o=mesh(label,pts,[tuple(range(len(pts)))],False)
            bm=bmesh.new();bm.from_mesh(o.data)
            bmesh.ops.triangulate(bm,faces=list(bm.faces))
            bmesh.ops.subdivide_edges(bm,edges=list(bm.edges),cuts=3,use_grid_fill=True)
            bm.to_mesh(o.data);bm.free()
            for vertex in o.data.vertices:
                x,z,y=vertex.co;vertex.co.y=-surface(x,y,offset)
            for polygon in o.data.polygons:polygon.use_smooth=True
            sol=o.modifiers.new('Cloth edge thickness','SOLIDIFY');sol.thickness=.0012
            bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=sol.name)
            return o
        def seam(label,coords,r=.00065):
            dense=[]
            for (x,y),(xx,yy) in zip(coords,coords[1:]):
                for j in range(5):dense.append((x+(xx-x)*j/5,y+(yy-y)*j/5))
            dense.append(coords[-1])
            return tube(label,[(x,y,surface(x,y,.0011)) for x,y in dense],[r]*len(dense),5)
        if name in ['blazer','cardigan','waistcoat']:
            # Continuous inset shirt triangle sits above the shell; dark vest
            # edges define the opening rather than two giant contrasting badges.
            inserts.append(panel('undershirt',[(-.052,.535),(.052,.535),(.034,.44),(0,.285),(-.034,.44)],.002))
            for s in [-1,1]:
                if name=='waistcoat':
                    detail.append(seam('vest facing',[(s*.052,.527),(s*.038,.459),(s*.015,.345),(0,.285)],.0013))
                else:
                    detail.append(panel('opening facing',[(s*.052,.535),(s*.067,.491),(s*.052,.465),(s*.068,.449),(s*.010,.29),(s*.035,.441)],.0035))
                detail.append(seam('welt pocket',[(s*.060,.233),(s*.123,.243)],.0012))
            detail.append(seam('button stance',[(0,.27),(0,.10)]))
        if name in ['polo','flannel','waistcoat','blazer']:
            for s in [-1,1]:
                p=panel('folded collar',[(s*.008,.531),(s*.049,.536),(s*.061,.505),(s*.034,.481)],.004)
                (inserts if name in ['waistcoat','blazer'] else detail).append(p)
            detail.append(seam('placket',[(.006,.49),(.006,.39 if name=='polo' else .08)]))
        if name=='hoodie':
            detail.append(tube('folded hood',[(-.067,.514,.020),(-.094,.54,-.058),(-.073,.571,-.087),(0,.576,-.099),(.073,.571,-.087),(.094,.54,-.058),(.067,.514,.020)],[.009,.020,.025,.023,.025,.020,.009],10))
            detail.append(seam('pouch mouth',[(-.095,.17),(-.071,.22),(.071,.22),(.095,.17)]))
            for s in [-1,1]:detail.append(seam('drawcord',[(s*.035,.497),(s*.040,.405)],.0011))
        if name in ['tee','hoodie','cardigan','turtleneck','track-jacket','puffer']:
            detail.append(loft('rib neckline',[(.527,.061,.057,0),(.54 if name not in ['turtleneck','track-jacket','puffer'] else .570,.054,.050,0)],24))
        if name in ['track-jacket','puffer']:
            detail.append(seam('zipper',[(0,.025),(0,.14),(0,.25),(0,.36),(0,.43),(0,.51)],.0011))
        if name=='puffer':
            for y in [.09,.18,.27,.36,.435]:detail.append(seam('quilt stitch',[(x,y) for x in [-.13,-.08,0,.08,.13]],.0007))
        # Every silhouette has an attached hem and shoulder seam, with a material
        # response close to the cloth instead of a shiny contrasting stripe.
        detail.append(seam('hem stitch',[(-.13,.027),(0,.027),(.13,.027)]))
        for s in [-1,1]:detail.append(seam('shoulder seam',[(s*.065,.531),(s*.115,.520),(s*.167,.497)],.00065))
        join('detail/'+name,detail)
        if inserts:join('insert/'+name,inserts)
    # Thin folded tie follows the same shirt curvature with a small knot.
    verts=[(-.009,.513,.092),(.009,.513,.092),(.006,.495,.109),(-.006,.495,.109),(-.005,.494,.108),(.005,.494,.108),(.009,.43,.132),(-.009,.43,.132),(-.012,.36,.139),(.012,.36,.139),(0,.339,.140)]
    tie=mesh('dealer/tie',verts,[(0,1,2,3),(4,5,6,7),(7,6,9,8),(8,9,10)],False)
    sol=tie.modifiers.new('Thin cloth','SOLIDIFY');sol.thickness=.0014
    bpy.context.view_layer.objects.active=tie;bpy.ops.object.modifier_apply(modifier=sol.name)

def revise():
    for obj in list(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
    for data in list(bpy.data.meshes):
        if data.users==0:bpy.data.meshes.remove(data)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'src/assets/foreground.glb'))
    for obj in list(bpy.data.objects):
        if obj.name.startswith(('face/','eyes/','hair/','brows/','mouth/','beard/','detail/','insert/','dealer/','sleeve/')) or (obj.name.startswith('top/') and obj.name!='top/hem'):
            bpy.data.objects.remove(obj,do_unlink=True)
    for data in list(bpy.data.meshes):
        if data.users==0:bpy.data.meshes.remove(data)
    heads();feature_modules();hairstyles();garments()
    for obj in bpy.data.objects:
        if obj.type=='MESH':obj.data.name=obj.name
    base.export_kit()

if __name__=='__main__':revise()
