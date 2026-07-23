import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditPackagedLicenseSidecars,
  loadPackagedLicenseSidecarExpectations,
} from "./lib/packaged-license-sidecars.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function parsePackageRoot(args) {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== "--package-root" || !args[1]) {
    throw new Error(
      "Usage: node scripts/audit-packaged-license-sidecars.mjs " +
        "[--package-root <unpacked-package-directory>]",
    );
  }
  return path.resolve(projectRoot, args[1]);
}

try {
  const expectations = loadPackagedLicenseSidecarExpectations(projectRoot);
  const requestedPackageRoot = parsePackageRoot(process.argv.slice(2));
  const result = auditPackagedLicenseSidecars({
    ...expectations,
    packageRoot: requestedPackageRoot ?? expectations.packageRoot,
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}
