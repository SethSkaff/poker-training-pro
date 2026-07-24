import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDirectory = path.join(projectRoot, "dist");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map"]);
const allowedLiteralUrls = new Set([
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
]);
const allowedLiteralPrefixes = ["https://react.dev/errors/"];

if (!existsSync(distDirectory)) {
  fail("dist/ does not exist; run the production build first");
}

const files = walk(distDirectory);
const textFiles = files.filter((file) =>
  textExtensions.has(path.extname(file).toLowerCase()),
);
const remoteReferences = [];
let csp;

for (const file of textFiles) {
  const contents = readFileSync(file, "utf8");
  if (path.basename(file) === "index.html") {
    csp = contents.match(
      /http-equiv=["']Content-Security-Policy["'][^>]*content="([^"]+)"/i,
    )?.[1] ??
      contents.match(
        /http-equiv=["']Content-Security-Policy["'][^>]*content='([^']+)'/i,
      )?.[1];
  }
  for (const match of contents.matchAll(/\b(?:https?|wss?):\/\/[^\s"'`)<]+/g)) {
    const value = match[0].replace(/[;,]+$/, "");
    if (
      !allowedLiteralUrls.has(value) &&
      !allowedLiteralPrefixes.some((prefix) => value.startsWith(prefix))
    ) {
      remoteReferences.push({
        file: path.relative(projectRoot, file).replaceAll("\\", "/"),
        url: value,
      });
    }
  }
}

if (remoteReferences.length > 0) {
  fail(
    `production bundle contains remote URL references:\n${remoteReferences
      .map((entry) => `- ${entry.file}: ${entry.url}`)
      .join("\n")}`,
  );
}

const requiredCsp = [
  "default-src 'self'",
  "script-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
];
if (!csp) fail("production index.html has no Content Security Policy");
for (const directive of requiredCsp) {
  if (!csp.includes(directive)) {
    fail(`Content Security Policy is missing: ${directive}`);
  }
}

const fontFiles = files.filter((file) => path.extname(file) === ".woff2");
if (fontFiles.length < 8) {
  fail(`expected bundled local fonts, found only ${fontFiles.length} WOFF2 files`);
}

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      files: files.length,
      textFiles: textFiles.length,
      bundledFonts: fontFiles.length,
      totalBytes,
      remoteReferences: 0,
      cspDirectivesVerified: requiredCsp.length,
    },
    null,
    2,
  )}\n`,
);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(target) : [target];
    })
    .sort((left, right) => left.localeCompare(right));
}

function fail(message) {
  process.stderr.write(`Offline build audit failed: ${message}\n`);
  process.exit(1);
}
