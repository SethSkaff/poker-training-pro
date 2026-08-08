#!/usr/bin/env node
/**
 * Compile a Blender-authored glTF binary into a checked-in TypeScript module of
 * plain vertex arrays.
 *
 * Why compile rather than load the .glb at runtime: the scene is built
 * synchronously on the first frame, and a fetched asset is not. Introducing an
 * async load would mean two code paths through the renderer -- a placeholder
 * table and the real one -- and the packaged audit measures the first frame, so
 * the placeholder is exactly what it would capture. Baking the authored
 * geometry into the bundle keeps one deterministic path, needs no loader, no
 * MIME type, and no exception to the app's `default-src 'self'` policy.
 *
 * The .glb remains the authored artifact: it is what Blender exports, what the
 * asset-rights ledger records, and what this script's output is derived from.
 *
 *     node tools/glb-to-geometry.mjs work/blender/table.glb \
 *         src/scene3d/generated/tableGeometry.ts tableGeometry
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

const COMPONENT_TYPES = new Map([
  [5120, Int8Array],
  [5121, Uint8Array],
  [5122, Int16Array],
  [5123, Uint16Array],
  [5125, Uint32Array],
  [5126, Float32Array],
]);
const COMPONENT_COUNTS = new Map([
  ["SCALAR", 1],
  ["VEC2", 2],
  ["VEC3", 3],
  ["VEC4", 4],
  ["MAT4", 16],
]);

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset < view.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length)));
    if (type === 0x004e4942) bin = bytes.subarray(start, start + length);
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  if (!json || !bin) throw new Error("glb missing JSON or BIN chunk");
  return { json, bin };
}

function readAccessor(gltf, bin, index) {
  const accessor = gltf.accessors[index];
  const Type = COMPONENT_TYPES.get(accessor.componentType);
  const components = COMPONENT_COUNTS.get(accessor.type);
  if (!Type || !components) throw new Error(`unsupported accessor ${accessor.type}/${accessor.componentType}`);
  const view = gltf.bufferViews[accessor.bufferView];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Type(accessor.count * components);
  const stride = view.byteStride ?? components * Type.BYTES_PER_ELEMENT;
  const source = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const readers = {
    5120: (o) => source.getInt8(o),
    5121: (o) => source.getUint8(o),
    5122: (o) => source.getInt16(o, true),
    5123: (o) => source.getUint16(o, true),
    5125: (o) => source.getUint32(o, true),
    5126: (o) => source.getFloat32(o, true),
  };
  const read = readers[accessor.componentType];
  for (let element = 0; element < accessor.count; element += 1) {
    for (let component = 0; component < components; component += 1) {
      out[element * components + component] = read(
        base + element * stride + component * Type.BYTES_PER_ELEMENT,
      );
    }
  }
  return out;
}

/** Column-major 4x4, matching glTF's own convention. */
function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function transformPoint(matrix, x, y, z) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function transformDirection(matrix, x, y, z) {
  const out = [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z,
  ];
  const length = Math.hypot(out[0], out[1], out[2]) || 1;
  return [out[0] / length, out[1] / length, out[2] / length];
}

/**
 * Walk the scene graph so every node transform -- including the axis conversion
 * the exporter puts on the roots -- is baked into the vertex data. The runtime
 * then receives geometry already in scene space.
 */
function collectMeshes(gltf, bin) {
  const meshes = new Map();
  const visit = (nodeIndex, parent) => {
    const node = gltf.nodes[nodeIndex];
    const matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      for (const primitive of mesh.primitives) {
        const positions = readAccessor(gltf, bin, primitive.attributes.POSITION);
        const normals = primitive.attributes.NORMAL === undefined
          ? null
          : readAccessor(gltf, bin, primitive.attributes.NORMAL);
        const uvs = primitive.attributes.TEXCOORD_0 === undefined
          ? null
          : readAccessor(gltf, bin, primitive.attributes.TEXCOORD_0);
        const indices = primitive.indices === undefined
          ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
          : Uint32Array.from(readAccessor(gltf, bin, primitive.indices));
        const worldPositions = new Float32Array(positions.length);
        const worldNormals = normals ? new Float32Array(normals.length) : null;
        for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
          const [x, y, z] = transformPoint(
            matrix,
            positions[vertex * 3],
            positions[vertex * 3 + 1],
            positions[vertex * 3 + 2],
          );
          worldPositions.set([x, y, z], vertex * 3);
          if (normals && worldNormals) {
            worldNormals.set(
              transformDirection(
                matrix,
                normals[vertex * 3],
                normals[vertex * 3 + 1],
                normals[vertex * 3 + 2],
              ),
              vertex * 3,
            );
          }
        }
        const name = mesh.name ?? node.name ?? `mesh-${node.mesh}`;
        if (meshes.has(name)) throw new Error(`duplicate mesh name ${name}`);
        meshes.set(name, {
          position: worldPositions,
          normal: worldNormals,
          uv: uvs,
          index: indices,
        });
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, identity);
  return meshes;
}

function encode(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");
}

function main() {
  const [source, target, exportName] = process.argv.slice(2);
  if (!source || !target || !exportName) {
    console.error("usage: glb-to-geometry.mjs <in.glb> <out.ts> <exportName>");
    process.exit(2);
  }
  const bytes = new Uint8Array(readFileSync(resolve(source)));
  const { json, bin } = parseGlb(bytes);
  const meshes = collectMeshes(json, bin);

  const entries = [...meshes.entries()].sort(([a], [b]) => a.localeCompare(b));
  let triangles = 0;
  const body = entries.map(([name, mesh]) => {
    triangles += mesh.index.length / 3;
    // 16-bit indices wherever the mesh fits, which every mesh here does.
    const index = mesh.position.length / 3 <= 65_535 ? Uint16Array.from(mesh.index) : mesh.index;
    const fields = [
      `    position: "${encode(mesh.position)}",`,
      mesh.normal ? `    normal: "${encode(mesh.normal)}",` : null,
      mesh.uv ? `    uv: "${encode(mesh.uv)}",` : null,
      `    index: "${encode(index)}",`,
      `    indexBits: ${index.BYTES_PER_ELEMENT * 8},`,
    ].filter(Boolean).join("\n");
    return `  ${JSON.stringify(name)}: {\n${fields}\n  },`;
  }).join("\n");

  const from = relative(process.cwd(), resolve(source)).replace(/\\/g, "/");
  const contents = `/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Vertex data compiled from ${from}, which \`tools/blender/build_table.py\`
 * exports from Blender. Regenerate with \`npm run build:table-geometry\`.
 *
 * ${entries.length} meshes, ${triangles} triangles. Arrays are base64 of the
 * little-endian typed-array bytes; see \`decodePackedGeometry\`.
 */
export interface PackedGeometry {
  readonly position: string;
  readonly normal?: string;
  readonly uv?: string;
  readonly index: string;
  readonly indexBits: number;
}

export const ${exportName}: Readonly<Record<string, PackedGeometry>> = {
${body}
};

export type ${exportName[0].toUpperCase()}${exportName.slice(1)}Name = keyof typeof ${exportName};
`;
  mkdirSync(dirname(resolve(target)), { recursive: true });
  writeFileSync(resolve(target), contents);
  console.log(`wrote ${target}: ${entries.length} meshes, ${triangles} triangles, ${contents.length} bytes`);
  for (const [name, mesh] of entries) {
    console.log(`  ${name}: ${mesh.position.length / 3} verts, ${mesh.index.length / 3} tris${mesh.uv ? ", uv" : ""}`);
  }
}

main();
