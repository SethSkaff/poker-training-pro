#!/usr/bin/env node
import {
  assertSupportedNodeVersion,
  MINIMUM_NODE_VERSION,
} from "./runtime-version.mjs";

try {
  const version = assertSupportedNodeVersion();
  console.log(
    `Node.js ${version} satisfies the required runtime >=${MINIMUM_NODE_VERSION}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
