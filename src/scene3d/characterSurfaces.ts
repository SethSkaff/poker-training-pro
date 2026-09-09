/** Character-only surface treatment and fitted, bounded facial shape keys. */
import { BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace } from "three";
import { DEFAULT_FACIAL_STRUCTURE, type OpponentCharacter } from "../lib/opponentAppearance";
import type { SceneResourceLedger } from "./sceneResources";

/** Same lower-face deformation is applied to skin and its authored beard patch. */
export function fitFacialGeometry(geometry: BufferGeometry, character: OpponentCharacter, sculptNose = false): BufferGeometry {
  const features = character.facialStructure ?? DEFAULT_FACIAL_STRUCTURE;
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    let x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const jawWeight = Math.min(1, Math.max(0, (-y - .043) / .055));
    const jaw = features.jaw === "square" ? .075 : features.jaw === "tapered" ? -.075 : 0;
    x *= 1 + jaw * jawWeight;
    if (z > 0) z += jaw * .035 * jawWeight;
    if (sculptNose && z > .068 && Math.abs(x) < .028 && y > -.040 && y < .058) {
      const lateral = Math.exp(-Math.pow(x / .019, 2));
      const tip = Math.exp(-Math.pow((y + .017) / .020, 2));
      const bridge = Math.exp(-Math.pow((y - .012) / .027, 2));
      if (features.nose === "button") z -= lateral * (.010 * tip + .006 * bridge);
      if (features.nose === "aquiline") z += lateral * (.009 * bridge + .002 * tip);
      if (features.nose === "broad") { x *= 1 + .22 * tip; z -= .004 * lateral * bridge; }
    }
    positions.setXYZ(i, x, y, z);
  }
  positions.needsUpdate = true;
  if (sculptNose) {
    // Restrained baked tonal structure helps the small faces read in the room's
    // broad fill light. White vertex colors leave the skin palette authoritative.
    const colors:number[]=[];
    const g=(x:number,c:number,w:number)=>Math.exp(-Math.pow((x-c)/w,2));
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i), y=positions.getY(i), z=positions.getZ(i);
      const front=z>.025 ? 1 : 0;
      const socket=.12*g(Math.abs(x),.033,.022)*g(y,.019,.014);
      const cheek=.055*g(Math.abs(x),.058,.023)*g(y,-.044,.018);
      const underNose=.11*g(x,0,.020)*g(y,-.034,.008);
      const value=1-front*(socket+cheek+underNose);
      colors.push(value, value*.996, value*.99);
    }
    geometry.setAttribute("color",new Float32BufferAttribute(colors,3));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Small directional grain, shared UV convention, no external texture downloads. */
export function hairMaterial(character: OpponentCharacter, ledger: SceneResourceLedger, facial = false): MeshStandardMaterial {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  const stubble = character.facialHair === "stubble";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const strand = (x * 17 + Math.floor(y / 7) * 3) % 23;
    const value = 202 + strand * 2;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = value;
    const seed = ((x * 197 + y * 391 + x * y * 37) % 101) / 100;
    pixels[i + 3] = facial && seed < (stubble ? .56 : .13) ? 0 : 255;
  }
  const texture = ledger.track(new DataTexture(pixels, size, size));
  texture.colorSpace = SRGBColorSpace; texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter=LinearFilter;texture.minFilter=LinearMipmapLinearFilter;texture.generateMipmaps=true;
  texture.repeat.set(facial ? 30 : 9, facial ? 25 : 5); texture.needsUpdate = true;
  const color = facial ? new Color(0xffffff) : new Color(character.hairColor);
  return ledger.track(new MeshStandardMaterial({color, map: texture, bumpMap: texture,
    vertexColors: facial,
    bumpScale: facial ? .00015 : .0005, roughness: facial ? .96 : .79, metalness: 0,
    alphaTest: facial ? .5 : 0, side: DoubleSide}));
}

/** Feather the beard into skin along its cheek boundary instead of a solid strap. */
export function tintBeardGeometry(geometry: BufferGeometry, character: OpponentCharacter): BufferGeometry {
  const positions=geometry.getAttribute("position"), colors:number[]=[];
  const skin=new Color(character.skinTone), hair=new Color(character.hairColor);
  for(let i=0;i<positions.count;i++) {
    const x=positions.getX(i), y=positions.getY(i);
    const moustache=y>-.055;
    const edge=-.040-.30*(.076-Math.abs(x));
    const coverage=moustache ? .78 : Math.min(1,Math.max(.10,(edge-y)/.025));
    const density=character.facialHair==="stubble" ? .40 : character.facialHair==="short-beard" ? .88 : .80;
    const color=skin.clone().lerp(hair,coverage*density);
    colors.push(color.r,color.g,color.b);
  }
  geometry.setAttribute("color",new Float32BufferAttribute(colors,3));return geometry;
}

/** Fit sideburns and the lower hair envelope to cheek width; keep crown fixed. */
export function fitHairGeometry(geometry: BufferGeometry, character: OpponentCharacter): BufferGeometry {
  const width={"broad-jaw":1.02,narrow:.94,"soft-round":1.08,angular:.99,"high-cheek":1.06,"heavy-brow":1}[character.face];
  const p=geometry.getAttribute("position");
  for(let i=0;i<p.count;i++) {
    const blend=Math.min(1,Math.max(0,(.04-p.getY(i))/.06));
    p.setX(i,p.getX(i)*(1+(width-1)*blend));
  }
  p.needsUpdate=true;geometry.computeVertexNormals();return geometry;
}
