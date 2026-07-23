#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const CSS_EXTENSIONS = new Set([".css", ".scss", ".sass", ".less"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const VISUAL_PROPERTIES = new Set([
  "background",
  "background-color",
  "box-shadow",
  "color",
  "filter",
  "opacity",
  "text-shadow",
  "visibility",
]);
const HAZARDOUS_NAME = /(?:^|[-_])(blink|flash|flicker|strobe)(?:$|[-_])/i;
const TIMING_WORDS = new Set([
  "ease",
  "ease-in",
  "ease-in-out",
  "ease-out",
  "linear",
  "step-end",
  "step-start",
  "infinite",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "none",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
]);

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function milliseconds(token) {
  const match = String(token).match(/^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/i);
  if (!match) return null;
  return Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
}

function findBalancedBlock(text, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseKeyframes(css, file) {
  const keyframes = new Map();
  const matcher = /@(?:-\w+-)?keyframes\s+([-\w]+)\s*\{/gi;
  for (const match of css.matchAll(matcher)) {
    const openIndex = match.index + match[0].lastIndexOf("{");
    const closeIndex = findBalancedBlock(css, openIndex);
    if (closeIndex < 0) continue;
    const body = css.slice(openIndex + 1, closeIndex);
    const visualSequences = new Map();
    for (const frame of body.matchAll(/(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*\s*\{([^{}]*)\}/gi)) {
      for (const declaration of frame[1].matchAll(/([-\w]+)\s*:\s*([^;]+);?/g)) {
        const property = declaration[1].toLowerCase();
        if (!VISUAL_PROPERTIES.has(property)) continue;
        const values = visualSequences.get(property) ?? [];
        values.push(declaration[2].trim());
        visualSequences.set(property, values);
      }
    }
    keyframes.set(match[1], {
      file,
      line: lineNumberAt(css, match.index),
      name: match[1],
      visualSequences: Object.fromEntries(visualSequences),
    });
  }
  return keyframes;
}

function parseAnimationShorthand(value) {
  const tokens = value.trim().split(/\s+/);
  if (tokens.some((token) => token.toLowerCase().replace(/,$/, "") === "none")) {
    return {
      name: "none",
      durationMs: null,
      iterations: 1,
      alternate: false,
      timing: "continuous",
    };
  }
  const durationToken = tokens.find((token) => milliseconds(token) !== null);
  const iterationToken = tokens.find(
    (token) => token.toLowerCase() === "infinite" || /^\d+(?:\.\d+)?$/.test(token),
  );
  const name = tokens.find((token) => {
    const normalized = token.toLowerCase().replace(/,$/, "");
    return (
      !TIMING_WORDS.has(normalized) &&
      normalized !== "!important" &&
      milliseconds(normalized) === null &&
      !/^\d+(?:\.\d+)?$/.test(normalized) &&
      !/^(?:cubic-bezier|steps)\(/i.test(normalized)
    );
  });
  return {
    name: name?.replace(/,$/, "") ?? null,
    durationMs: durationToken ? milliseconds(durationToken.replace(/,$/, "")) : null,
    iterations:
      iterationToken?.toLowerCase() === "infinite"
        ? "infinite"
        : iterationToken
          ? Number(iterationToken)
          : 1,
    alternate: /\balternate(?:-reverse)?\b/i.test(value),
    timing: /\bsteps\s*\(/i.test(value) ? "steps" : "continuous",
  };
}

function opposingPairsPerCycle(values, alternate) {
  const compact = values.filter((value, index) => index === 0 || value !== values[index - 1]);
  if (compact.length < 2) return 0;
  const transitions = compact.length - 1 + (alternate ? compact.length - 1 : compact[0] === compact.at(-1) ? 0 : 1);
  return Math.floor(transitions / 2);
}

export function analyzeCss(css, file = "fixture.css") {
  const keyframes = parseKeyframes(css, file);
  const animations = [];
  const transitions = [];
  const failures = [];
  const warnings = [];
  const declarationPattern = /\b(animation|transition)(?:-([a-z-]+))?\s*:\s*([^;{}]+);/gi;

  for (const match of css.matchAll(declarationPattern)) {
    const family = match[1].toLowerCase();
    const suffix = match[2]?.toLowerCase() ?? null;
    const value = match[3].replace(/\s+/g, " ").trim();
    const item = {
      file,
      line: lineNumberAt(css, match.index),
      property: suffix ? `${family}-${suffix}` : family,
      value,
    };
    if (family === "transition") {
      transitions.push(item);
      continue;
    }
    if (suffix) {
      animations.push({ ...item, name: null, durationMs: null, iterations: null });
      continue;
    }

    const parsed = parseAnimationShorthand(value);
    const animation = { ...item, ...parsed };
    animations.push(animation);
    if (!parsed.name || parsed.name === "none") continue;
    const frames = keyframes.get(parsed.name);
    if (!frames) {
      failures.push({
        code: "animation-keyframes-missing",
        file,
        line: item.line,
        message: `Animation "${parsed.name}" has no matching keyframes in ${file}.`,
      });
      continue;
    }
    const repeated = parsed.iterations === "infinite" || Number(parsed.iterations) > 1;
    if (repeated && HAZARDOUS_NAME.test(parsed.name)) {
      failures.push({
        code: "hazardous-animation-signature",
        file,
        line: item.line,
        message: `Repeated animation "${parsed.name}" uses a prohibited blink/flash/flicker/strobe signature.`,
      });
    }
    if (repeated && parsed.durationMs !== null && parsed.durationMs > 0) {
      const rates = Object.entries(frames.visualSequences).map(([property, values]) => ({
        property,
        flashesPerSecond:
          (opposingPairsPerCycle(values, parsed.alternate) * 1000) /
          (parsed.durationMs * (parsed.alternate ? 2 : 1)),
      }));
      for (const rate of rates) {
        if (rate.flashesPerSecond > 3) {
          failures.push({
            code: "mechanical-flash-rate",
            file,
            line: item.line,
            message: `Animation "${parsed.name}" can reverse ${rate.property} about ${rate.flashesPerSecond.toFixed(2)} times/second.`,
          });
        }
      }
      if (parsed.timing === "steps" && parsed.durationMs < 1000 && rates.length > 0) {
        failures.push({
          code: "rapid-stepped-visual-animation",
          file,
          line: item.line,
          message: `Repeated stepped visual animation "${parsed.name}" is shorter than 1 second.`,
        });
      }
    }
    if (parsed.durationMs === null) {
      warnings.push({
        code: "animation-duration-unresolved",
        file,
        line: item.line,
        message: `Animation "${parsed.name}" needs manual duration review.`,
      });
    }
  }

  const hasSystemReduction =
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(css) &&
    /animation-(?:duration|iteration-count)\s*:[^;]+!important/i.test(css);
  const hasInAppReduction =
    /\.reduced-motion\s+\*(?:::before|::after)?[\s,\{]/i.test(css) &&
    /animation-(?:duration|iteration-count)\s*:[^;]+!important/i.test(css);
  const hasRepeatedAnimation = animations.some(
    (animation) =>
      animation.iterations === "infinite" || Number(animation.iterations) > 1,
  );
  if (hasRepeatedAnimation && !hasSystemReduction) {
    failures.push({
      code: "system-reduced-motion-missing",
      file,
      line: 1,
      message: "Repeated animation exists without a prefers-reduced-motion reduction rule.",
    });
  }
  if (hasRepeatedAnimation && !hasInAppReduction) {
    failures.push({
      code: "in-app-reduced-motion-missing",
      file,
      line: 1,
      message: "Repeated animation exists without the app reduced-motion class override.",
    });
  }

  return {
    animations,
    transitions,
    keyframes: [...keyframes.values()],
    reducedMotion: { hasSystemReduction, hasInAppReduction },
    failures,
    warnings,
  };
}

function extractCall(text, startIndex) {
  const openIndex = text.indexOf("(", startIndex);
  if (openIndex < 0) return "";
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }
  return text.slice(startIndex, Math.min(text.length, startIndex + 400));
}

export function analyzeScript(source, file = "fixture.tsx") {
  const timers = [];
  const failures = [];
  const timerPattern = /(?:window\.)?(setTimeout|setInterval|requestAnimationFrame)\s*\(/g;
  for (const match of source.matchAll(timerPattern)) {
    const call = extractCall(source, match.index).replace(/\s+/g, " ").trim();
    const nearby = source.slice(Math.max(0, match.index - 500), match.index + call.length + 300);
    const numericDelay =
      match[1] === "requestAnimationFrame"
        ? null
        : [...call.matchAll(/(?:,\s*|\?\s*)(\d[\d_]*)\s*(?=[,)])/g)]
            .map((candidate) => Number(candidate[1].replaceAll("_", "")))
            .at(-1) ?? null;
    const mutatesVisualState =
      /(?:classList|style\.|setPhase|setArrivalVisible|opacity|visibility)/i.test(call);
    const reducedMotionAware = /reducedMotion|prefers-reduced-motion/i.test(nearby);
    const category =
      /RoomFlythrough|setPhase/.test(`${file} ${call}`)
        ? "presentation-sequence"
        : /presentationDelay|pendingTournamentAction|deliverAction/.test(nearby)
          ? "decision-presentation"
          : /setElapsedMs/.test(call)
            ? "elapsed-time-status"
            : "unclassified";
    const timer = {
      file,
      line: lineNumberAt(source, match.index),
      kind: match[1],
      delayMs: numericDelay,
      category,
      mutatesVisualState,
      reducedMotionAware,
      call: call.slice(0, 240),
    };
    timers.push(timer);
    if (
      match[1] === "setInterval" &&
      numericDelay !== null &&
      numericDelay < 334 &&
      mutatesVisualState
    ) {
      failures.push({
        code: "rapid-scripted-visual-toggle",
        file,
        line: timer.line,
        message: `Scripted visual interval repeats every ${numericDelay}ms.`,
      });
    }
    if (
      category === "presentation-sequence" &&
      mutatesVisualState &&
      !reducedMotionAware
    ) {
      failures.push({
        code: "scripted-presentation-reduction-missing",
        file,
        line: timer.line,
        message: "Scripted presentation timer has no nearby reduced-motion branch.",
      });
    }
  }
  return { timers, failures };
}

async function listFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(candidate)));
    else files.push(candidate);
  }
  return files;
}

export async function auditProject(rootDirectory) {
  const sourceDirectory = path.join(rootDirectory, "src");
  const files = await listFiles(sourceDirectory);
  const cssFiles = files.filter((file) => CSS_EXTENSIONS.has(path.extname(file)));
  const scriptFiles = files.filter((file) => SCRIPT_EXTENSIONS.has(path.extname(file)));
  const cssText = new Map();
  for (const file of cssFiles) cssText.set(file, await fs.readFile(file, "utf8"));
  const combinedCss = [...cssText.values()].join("\n");
  const globalSystemReduction =
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(combinedCss);
  const globalInAppReduction = /\.reduced-motion\s+\*/i.test(combinedCss);
  const animations = [];
  const transitions = [];
  const keyframes = [];
  const failures = [];
  const warnings = [];

  for (const [file, css] of cssText) {
    const relative = path.relative(rootDirectory, file).replaceAll("\\", "/");
    const result = analyzeCss(css, relative);
    animations.push(...result.animations);
    transitions.push(...result.transitions);
    keyframes.push(...result.keyframes);
    warnings.push(...result.warnings);
    failures.push(
      ...result.failures.filter(
        (failure) =>
          !(
            failure.code === "system-reduced-motion-missing" &&
            globalSystemReduction
          ) &&
          !(
            failure.code === "in-app-reduced-motion-missing" &&
            globalInAppReduction
          ),
      ),
    );
  }

  const timers = [];
  for (const file of scriptFiles) {
    if (/\.test\.[^.]+$/i.test(file)) continue;
    const relative = path.relative(rootDirectory, file).replaceAll("\\", "/");
    const result = analyzeScript(await fs.readFile(file, "utf8"), relative);
    timers.push(...result.timers);
    failures.push(...result.failures);
  }

  const media = [];
  for (const file of scriptFiles) {
    if (!/\.(?:tsx|jsx)$/i.test(file)) continue;
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(/<(video|img)\b[^>]*>/gi)) {
      const tag = match[0].replace(/\s+/g, " ").trim();
      if (
        match[1].toLowerCase() === "video" ||
        /\.(?:apng|gif|mp4|webm)\b/i.test(tag)
      ) {
        media.push({
          file: path.relative(rootDirectory, file).replaceAll("\\", "/"),
          line: lineNumberAt(source, match.index),
          type: match[1].toLowerCase(),
          autoPlay: /\bautoPlay\b/i.test(tag),
          loop: /\bloop\b/i.test(tag),
          tag: tag.slice(0, 240),
        });
      }
    }
  }

  return {
    schemaVersion: 1,
    policy: {
      maximumMechanicallyAcceptedFlashesPerSecond: 3,
      rapidIntervalThresholdMs: 334,
      repeatedAnimationsRequireSystemAndInAppReduction: true,
    },
    scope: {
      root: ".",
      cssFiles: cssFiles.map((file) =>
        path.relative(rootDirectory, file).replaceAll("\\", "/"),
      ),
      scriptFiles: scriptFiles
        .filter((file) => !/\.test\.[^.]+$/i.test(file))
        .map((file) => path.relative(rootDirectory, file).replaceAll("\\", "/")),
    },
    inventory: { animations, transitions, keyframes, timers, media },
    reducedMotion: {
      systemPreferenceRuleFound: globalSystemReduction,
      inAppClassRuleFound: globalInAppReduction,
    },
    failures,
    warnings,
    manualChecks: [
      "Record every reachable screen and state at the shipping frame rate; analyze luminance and saturated-red transitions with a recognized flash-analysis tool.",
      "Visually inspect the full-screen flythrough, progress arrival, title prompt, shimmer, thinking ring, card/chip motion, hover/focus transitions, and any future start-menu video.",
      "Verify the in-app Reduce Motion toggle and the operating-system preference suppress motion before each scripted presentation begins.",
      "Confirm all auto-playing motion lasting more than five seconds can be paused, stopped, or hidden, or document why it is essential to the activity.",
      "Repeat checks at supported resolutions, display scaling settings, high-contrast mode, and maximum game-speed settings.",
    ],
    result: failures.length === 0 ? "pass-static-gate" : "fail-static-gate",
  };
}

function printSummary(report) {
  const counts = {
    animations: report.inventory.animations.length,
    transitions: report.inventory.transitions.length,
    keyframes: report.inventory.keyframes.length,
    timers: report.inventory.timers.length,
    media: report.inventory.media.length,
    failures: report.failures.length,
    warnings: report.warnings.length,
  };
  console.log(`Motion/flash static audit: ${report.result}`);
  console.log(JSON.stringify(counts));
  for (const failure of report.failures) {
    console.error(`FAIL ${failure.code} ${failure.file}:${failure.line} ${failure.message}`);
  }
  for (const warning of report.warnings) {
    console.warn(`WARN ${warning.code} ${warning.file}:${warning.line} ${warning.message}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const outputIndex = args.indexOf("--output");
  const rootDirectory = path.resolve(
    rootIndex >= 0 ? args[rootIndex + 1] : process.cwd(),
  );
  const outputPath =
    outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : null;
  const report = await auditProject(rootDirectory);
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printSummary(report);
  process.exitCode = report.failures.length === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
