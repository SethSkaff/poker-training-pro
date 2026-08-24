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
/*
  URLs that appear in the bundle as *identifiers or prose*, never as fetch
  targets. Each entry is allowed on the basis of what the surrounding code does
  with it, checked at the time it was added -- not because the string looked
  harmless.

  The four W3C namespaces and `http://www.w3.org/1999/xhtml` are XML namespace
  URIs handed to `document.createElementNS`. A namespace URI names a vocabulary;
  the DOM never dereferences it. three.js uses the xhtml one to create its
  canvas element.

  `https://jcgt.org/published/0007/04/01/` is a paper citation inside a GLSL
  comment in three.js's shader chunks (hashed alpha testing). It is inside a
  comment in a string that is compiled as shader source, so it is never even
  parsed as JavaScript, let alone requested.

  Adding to this list is a deliberate act: verify what the code does with the
  string before you add it, and say so here. The gate exists to prove the
  packaged app makes no network requests, and the packaged network audit
  independently confirms zero egress at runtime.
*/
const allowedLiteralUrls = new Set([
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/1999/xhtml",
  "https://jcgt.org/published/0007/04/01/",
]);
const allowedLiteralPrefixes = ["https://react.dev/errors/"];

/*
  Legally required music source/license citations rendered in Credits. They
  are not media endpoints: audio always uses /audio/*.ogg, Electron denies all
  window.open requests and non-app navigation, and the CSP restricts media and
  images to self/blob/data. The source privacy audit independently rejects any
  fetch/XMLHttpRequest/WebSocket/sendBeacon primitive even when it uses one of
  these strings.
*/
const allowedAttributionPrefixes = [
  "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=",
];
const allowedAttributionUrls = new Set([
  "https://creativecommons.org/licenses/by/4.0/",
  // Vite keeps this shared prefix as a literal and appends each audited ISRC.
  "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=",
]);

function isAllowedAttributionUrl(value) {
  if (allowedAttributionUrls.has(value)) return true;
  const prefix = allowedAttributionPrefixes.find((candidate) =>
    value.startsWith(candidate),
  );
  return prefix !== undefined && /^USUAN\d{7}$/.test(value.slice(prefix.length));
}

if (
  !isAllowedAttributionUrl(
    "https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100630",
  ) ||
  isAllowedAttributionUrl("https://incompetech.com/api/telemetry")
) {
  throw new Error("offline audit attribution URL classification regression");
}

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
      !allowedLiteralPrefixes.some((prefix) => value.startsWith(prefix)) &&
      !isAllowedAttributionUrl(value)
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
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
];
if (!csp) fail("production index.html has no Content Security Policy");
for (const directive of requiredCsp) {
  if (!csp.includes(directive)) {
    fail(`Content Security Policy is missing: ${directive}`);
  }
}
const connectDirective = csp
  .split(";")
  .map((directive) => directive.trim())
  .find((directive) => directive.startsWith("connect-src"));
if (connectDirective !== "connect-src 'self'") {
  fail(
    `production Content Security Policy must allow only same-origin connections; found: ${connectDirective ?? "missing connect-src"}`,
  );
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
