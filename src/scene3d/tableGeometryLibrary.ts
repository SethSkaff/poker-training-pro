/**
 * The Blender-authored table, card, and chip geometry, as three.js buffers.
 *
 * `tools/blender/build_table.py` exports the assembly to glTF; that .glb is the
 * authored artifact recorded in the asset-rights ledger. `tools/glb-to-geometry.mjs`
 * compiles it into `generated/tableGeometry.ts` so the renderer can build the
 * scene synchronously on the first frame -- no fetch, no loader, and no
 * exception to the app's `default-src 'self'` policy.
 *
 * Every mesh arrives in scene space with the felt plane at y=0, so the caller
 * places the whole assembly with a single `TABLE_HEIGHT` offset.
 */
import { BufferAttribute, BufferGeometry } from "three";
import { tableGeometry, type PackedGeometry } from "./generated/tableGeometry";

export type TableMeshName = keyof typeof tableGeometry;

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Rebuild one packed mesh. Each call returns a fresh geometry: three.js
 * disposes geometries individually, and the scene ledger tracks each one, so
 * sharing a cached instance across two disposable owners would be a
 * use-after-free waiting to happen.
 */
export function decodePackedGeometry(packed: PackedGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = typeof packed.position === "string"
    ? new Float32Array(decodeBase64(packed.position).buffer)
    : Float32Array.from(packed.position, value => value / (packed.positionScale ?? 1));
  if (packed.deltaEncoded) {
    for (let i = 3; i < positions.length; i++) positions[i] += positions[i-3];
  }
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  if (packed.normal) {
    geometry.setAttribute("normal", new BufferAttribute(new Float32Array(decodeBase64(packed.normal).buffer), 3));
  }
  if (packed.uv) {
    geometry.setAttribute("uv", new BufferAttribute(typeof packed.uv === "string" ? new Float32Array(decodeBase64(packed.uv).buffer) : Float32Array.from(packed.uv, value => value / (packed.uvScale ?? 1)), 2));
  }
  const indexBytes = typeof packed.index === "string" ? decodeBase64(packed.index) : null;
  geometry.setIndex(
    new BufferAttribute(
      indexBytes ? (packed.indexBits === 16 ? new Uint16Array(indexBytes.buffer) : new Uint32Array(indexBytes.buffer))
        : (packed.indexBits === 16 ? Uint16Array.from(packed.index as readonly number[]) : Uint32Array.from(packed.index as readonly number[])),
      1,
    ),
  );
  if (packed.deltaEncoded) {
    const indices = geometry.getIndex()!;
    let value = 0;
    for (let i = 0; i < indices.count; i++) {
      value += (packed.index as readonly number[])[i];
      indices.setX(i, value);
    }
  }
  if (!packed.normal) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function tableMeshGeometry(name: TableMeshName): BufferGeometry {
  const packed = tableGeometry[name];
  if (!packed) throw new Error(`unknown authored mesh: ${name}`);
  return decodePackedGeometry(packed);
}

/** Triangle count of an authored mesh, for budget assertions. */
export function tableMeshTriangles(name: TableMeshName): number {
  const packed = tableGeometry[name];
  if (!packed) throw new Error(`unknown authored mesh: ${name}`);
  return typeof packed.index === "string" ? (decodeBase64(packed.index).byteLength / (packed.indexBits / 8)) / 3 : packed.index.length / 3;
}

export const TABLE_MESH_NAMES = Object.keys(tableGeometry) as TableMeshName[];
