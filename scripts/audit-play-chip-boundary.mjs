import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".mjs",
  ".ts",
  ".tsx",
]);
const sourceRoots = ["src", "electron"].map((entry) =>
  path.join(projectRoot, entry),
);
const productionConfigFiles = ["index.html", "vite.config.ts"].map((entry) =>
  path.join(projectRoot, entry),
);
const buildRoot = path.join(projectRoot, "dist");
const packagedAsar = path.join(
  projectRoot,
  "outputs",
  "desktop",
  "win-unpacked",
  "resources",
  "app.asar",
);

const prohibitedDependencyName =
  /(?:^|[-_./@])(?:stripe|paypal|braintree|adyen|checkout|revenuecat|purchasely|storekit|in[-_]?app[-_]?purchase|react[-_]?native[-_]?iap|electron[-_]?in[-_]?app[-_]?purchase|payment|billing)(?:$|[-_./])/i;
const prohibitedEndpoint =
  /(?:api\.stripe\.com|paypal\.com|braintreegateway\.com|checkout\.com|adyen\.com|revenuecat\.com)/i;
const prohibitedCapability = [
  {
    name: "money movement or cash-out capability",
    expression:
      /\b(?:cash[-_ ]?out|withdraw(?:al|als|ing)?|deposit(?:s|ing)?|redeem(?:able|ing)?|payout account|money transfer)\b/i,
  },
  {
    name: "payment, billing, checkout, or wallet capability",
    expression:
      /\b(?:payment|billing|checkout|merchant account|bank account|credit card|debit card|digital wallet)\b/i,
  },
  {
    name: "real-money or cash-value gameplay",
    expression:
      /\b(?:real[-_ ]?money|cash value|cash prize|prize money|win cash|wager for money|gambling for money)\b/i,
  },
  {
    name: "chip purchase, sale, or conversion",
    expression:
      /\b(?:(?:buy|purchase|sell)\w*\s+(?:(?:\d[\d,.]*|a|some|more|play)\s+){0,3}chips?|chip packs?|convert\w*\s+(?:play\s+)?chips?\s+(?:to|into|for)\s+(?:cash|money|currency))\b/i,
  },
  {
    name: "in-app purchase capability",
    expression:
      /\b(?:in[-_ ]?app purchase|storekit|react[-_ ]?native[-_ ]?iap|productid|purchase token)\b/i,
  },
];

const approvedDisclosureFragments = [
  /\bplay\s+chips\s+only\b/gi,
  /\bno\s+real[-\s]?money\s+wagering\b/gi,
  /\bno\s+cash\s+value\b/gi,
  /\bno\s+deposits?\b/gi,
  /\bno\s+purchases?\b/gi,
  /\bno\s+withdrawals?\b/gi,
  /\bno\s+cash[-\s]?out\s+path\b/gi,
  /\bhas\s+no\s+(?=real[-\s]?money\s+wagering|cash\s+value|deposits?|purchases?|withdrawals?|cash[-\s]?out\s+path)/gi,
];

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(target);
    return statSync(target).isFile() ? [target] : [];
  });
}

function isProductionRuntimeSource(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  return (
    textExtensions.has(path.extname(filePath).toLowerCase()) &&
    !/\.(?:test|spec)\.[^/]+$/i.test(normalized) &&
    !/(?:^|\/)(?:__tests__|fixtures)(?:\/|$)/i.test(normalized)
  );
}

function stripApprovedDisclosure(source) {
  return approvedDisclosureFragments.reduce(
    (current, expression) => current.replace(expression, ""),
    source,
  );
}

function scanText(label, source, findings) {
  const capabilityText = stripApprovedDisclosure(source);
  for (const rule of prohibitedCapability) {
    const match = capabilityText.match(rule.expression);
    if (match) {
      findings.push({
        type: rule.name,
        path: label,
        evidence: match[0],
      });
    }
  }
  const endpoint = source.match(prohibitedEndpoint);
  if (endpoint) {
    findings.push({
      type: "payment-provider endpoint",
      path: label,
      evidence: endpoint[0],
    });
  }
}

function dependencyNames(packageManifest, packageLock) {
  const direct = Object.keys({
    ...(packageManifest.dependencies ?? {}),
    ...(packageManifest.optionalDependencies ?? {}),
  });
  const locked = Object.keys(packageLock.packages ?? {})
    .filter((entry) => entry.startsWith("node_modules/"))
    .map((entry) => entry.slice("node_modules/".length));
  return [...new Set([...direct, ...locked])].sort();
}

function auditInputs({
  sourceFiles,
  buildFiles,
  asarFiles,
  packageManifest,
  packageLock,
}) {
  const findings = [];
  const disclosures = {
    source: false,
    build: buildFiles.length === 0 ? null : false,
    packagedAsar: asarFiles.length === 0 ? null : false,
  };

  for (const item of sourceFiles) {
    scanText(item.label, item.source, findings);
    if (
      (item.label === "src/components/Dashboard.tsx" ||
        item.label.startsWith("fixture")) &&
      /\bPlay chips only\b/i.test(item.source) &&
      /\bNo real-money wagering\b/i.test(item.source)
    ) {
      disclosures.source = true;
    }
  }
  for (const item of buildFiles) {
    scanText(item.label, item.source, findings);
    if (
      /\bPlay chips only\b/i.test(item.source) &&
      /\bNo real-money wagering\b/i.test(item.source)
    ) {
      disclosures.build = true;
    }
  }
  for (const item of asarFiles) {
    scanText(item.label, item.source, findings);
    if (
      /\bPlay chips only\b/i.test(item.source) &&
      /\bNo real-money wagering\b/i.test(item.source)
    ) {
      disclosures.packagedAsar = true;
    }
  }
  scanText(
    "package.json",
    `${JSON.stringify(packageManifest, null, 2)}\n`,
    findings,
  );

  if (!disclosures.source) {
    findings.push({
      type: "missing play-chip disclosure",
      path: "src/components/Dashboard.tsx:HomeView",
      evidence:
        'The active start menu must display "Play chips only" and "No real-money wagering". Text in an unused component does not satisfy this gate.',
    });
  }
  if (disclosures.build === false) {
    findings.push({
      type: "missing play-chip disclosure",
      path: "dist/**",
      evidence: "Production renderer is stale or omits the required disclosure.",
    });
  }
  if (disclosures.packagedAsar === false) {
    findings.push({
      type: "missing play-chip disclosure",
      path: "outputs/desktop/win-unpacked/resources/app.asar",
      evidence: "Packaged renderer is stale or omits the required disclosure.",
    });
  }

  const dependencies = dependencyNames(packageManifest, packageLock);
  for (const dependency of dependencies) {
    if (prohibitedDependencyName.test(dependency)) {
      findings.push({
        type: "payment or in-app-purchase dependency",
        path: "package-lock.json",
        evidence: dependency,
      });
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    disclosures,
    dependenciesScanned: dependencies.length,
    runtimeSourceFilesScanned: sourceFiles.length,
    rendererBuildFilesScanned: buildFiles.length,
    packagedRuntimeFilesScanned: asarFiles.length,
    packageConfigFilesScanned: 1,
  };
}

function fileInput(filePath, prefix = "") {
  return {
    label: `${prefix}${path
      .relative(projectRoot, filePath)
      .replaceAll("\\", "/")}`,
    source: readFileSync(filePath, "utf8"),
  };
}

function currentInputs() {
  const sourceFiles = sourceRoots
    .flatMap(walk)
    .concat(productionConfigFiles.filter(existsSync))
    .filter(isProductionRuntimeSource)
    .sort()
    .map((filePath) => fileInput(filePath));
  const buildFiles = walk(buildRoot)
    .filter((filePath) => textExtensions.has(path.extname(filePath).toLowerCase()))
    .sort()
    .map((filePath) => fileInput(filePath));
  const asarFiles = [];

  if (existsSync(packagedAsar)) {
    const entries = listPackage(packagedAsar, { isPack: false })
      .map((archivePath) => ({
        archivePath,
        normalized: archivePath.replaceAll("\\", "/"),
      }))
      .filter(
        ({ normalized }) =>
          normalized === "/package.json" ||
          normalized.startsWith("/dist/") ||
          normalized.startsWith("/electron/"),
      )
      .filter(({ normalized }) =>
        textExtensions.has(path.extname(normalized).toLowerCase()),
      )
      .sort((left, right) => left.normalized.localeCompare(right.normalized));
    for (const entry of entries) {
      asarFiles.push({
        label: `app.asar:${entry.normalized}`,
        source: extractFile(packagedAsar, entry.archivePath.slice(1)).toString(
          "utf8",
        ),
      });
    }
  }

  return {
    sourceFiles,
    buildFiles,
    asarFiles,
    packageManifest: JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ),
    packageLock: JSON.parse(
      readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"),
    ),
  };
}

function fixture(text, layer = "source") {
  return {
    sourceFiles:
      layer === "source"
        ? [
            {
              label: "fixture.tsx",
              source:
                'const disclosure = "Play chips only · No real-money wagering";\n' +
                text,
            },
          ]
        : [
            {
              label: "fixture.tsx",
              source:
                'const disclosure = "Play chips only · No real-money wagering";',
            },
          ],
    buildFiles:
      layer === "build"
        ? [
            {
              label: "dist/fixture.js",
              source:
                '"Play chips only · No real-money wagering";\n' + text,
            },
          ]
        : [],
    asarFiles: [],
    packageManifest: { dependencies: {} },
    packageLock: { packages: {} },
  };
}

function runSelfTests() {
  const cases = [
    {
      name: "ordinary simulated poker terms pass",
      input: fixture(
        'applyBettingAction(state, player, { type: "raise", to: 600 }); // chips',
      ),
      expected: true,
    },
    {
      name: "approved no-value disclosure passes",
      input: fixture('const copy = "Play chips only · No real-money wagering";'),
      expected: true,
    },
    {
      name: "wrapped approved no-value disclosure passes",
      input: fixture(
        ['const copy = "Chips have no', ' cash value.";'].join("\n"),
      ),
      expected: true,
    },
    {
      name: "chip purchase offer fails",
      input: fixture('const offer = "Buy 500 chips for $4.99";'),
      expected: false,
    },
    {
      name: "cash-out path fails",
      input: fixture('const route = "/cash-out";'),
      expected: false,
    },
    {
      name: "payment IPC fails",
      input: fixture('ipcMain.handle("billing:purchase", handler);'),
      expected: false,
    },
    {
      name: "payment endpoint fails",
      input: fixture('const url = "https://api.stripe.com/v1/payment_intents";'),
      expected: false,
    },
    {
      name: "payment dependency fails",
      input: {
        ...fixture(""),
        packageManifest: { dependencies: { "@stripe/stripe-js": "1.0.0" } },
      },
      expected: false,
    },
    {
      name: "missing disclosure fails",
      input: {
        ...fixture(""),
        sourceFiles: [{ label: "fixture.ts", source: "const chips = 500;" }],
      },
      expected: false,
    },
  ];
  const results = cases.map((testCase) => {
    const actual = auditInputs(testCase.input).ok;
    return {
      name: testCase.name,
      expected: testCase.expected,
      actual,
      pass: actual === testCase.expected,
    };
  });
  const ok = results.every((result) => result.pass);
  process.stdout.write(
    `${JSON.stringify({ ok, tests: results.length, results }, null, 2)}\n`,
  );
  if (!ok) process.exit(1);
}

if (process.argv.includes("--self-test")) {
  runSelfTests();
} else {
  const report = auditInputs(currentInputs());
  process.stdout.write(
    `${JSON.stringify(
      {
        ...report,
        artifactPolicy:
          "Source is mandatory; dist and app.asar are audited when present.",
        limitations:
          "Static evidence does not replace interactive review or store-metadata review.",
      },
      null,
      2,
    )}\n`,
  );
  if (!report.ok) process.exit(1);
}
