/** Blender MCP authored, compiled locally for synchronous offline rendering. */
import { foregroundGeometry } from './generated/foregroundGeometry';
import { decodePackedGeometry } from './tableGeometryLibrary';

export type ForegroundPart = keyof typeof foregroundGeometry;
export function foregroundPart(name: ForegroundPart) {
  return decodePackedGeometry(foregroundGeometry[name]);
}
