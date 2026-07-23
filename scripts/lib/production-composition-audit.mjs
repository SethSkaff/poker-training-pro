import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const sourceExtensions = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);
const resolutionExtensions = [
  "",
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
];
const textBuildExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".mjs",
  ".svg",
  ".txt",
  ".xml",
]);
const builtinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export function auditProductionComposition(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const distDirectory = path.resolve(
    options.distDirectory ?? path.join(projectRoot, "dist"),
  );
  const packagePath = path.resolve(
    options.packagePath ?? path.join(projectRoot, "package.json"),
  );
  const policyPath = path.resolve(
    options.policyPath ??
      path.join(projectRoot, "config", "production-composition-policy.json"),
  );
  const baselinePath = path.resolve(
    options.baselinePath ??
      path.join(projectRoot, "config", "production-composition-baseline.json"),
  );

  const manifest = readJson(packagePath);
  const policy = readJson(policyPath);
  const allProductionSourceFiles = [
    ...listProductionSourceFiles(path.join(projectRoot, "src")),
    ...listProductionSourceFiles(path.join(projectRoot, "electron")),
  ];
  const productionEntrypoints = [
    ...(policy.rendererEntrypoints ?? ["src/main.tsx"]),
    ...(policy.electronEntrypoints ?? [
      "electron/main.cjs",
      "electron/preload.cjs",
    ]),
  ].map((entry) => path.resolve(projectRoot, entry));
  const sourceFiles = collectReachableProductionSourceFiles(
    productionEntrypoints,
  );
  const dependencyUsage = inspectDirectDependencyUsage({
    projectRoot,
    sourceFiles,
    dependencies: manifest.dependencies ?? {},
  });
  dependencyUsage.productionEntrypoints = productionEntrypoints.map((file) =>
    relative(projectRoot, file),
  );
  dependencyUsage.unreachableProductionSourceFiles =
    allProductionSourceFiles
      .filter((file) => !sourceFiles.includes(file))
      .map((file) => relative(projectRoot, file))
      .sort(compareText);
  const electronIsolation = inspectElectronIsolation({
    projectRoot,
    policy,
  });
  const build = inspectBuild(distDirectory);
  const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
  const baselineComparison = compareBaseline(build.summary, baseline);
  const warnings = [];
  const failures = [];

  if (dependencyUsage.unused.length > 0) {
    warnings.push({
      code: "unused-direct-production-dependencies",
      dependencies: dependencyUsage.unused,
      message:
        "Direct production dependencies are declared but have no static production import.",
    });
  }
  if (build.unreferencedRuntimeAssets.length > 0) {
    warnings.push({
      code: "unreferenced-built-runtime-assets",
      files: build.unreferencedRuntimeAssets,
      message:
        "Built runtime files have no static reference from another built text asset.",
    });
  }
  if (!baseline) {
    warnings.push({
      code: "missing-composition-baseline",
      message: `${relative(projectRoot, baselinePath)} is missing.`,
    });
  }
  failures.push(...electronIsolation.violations);

  return {
    ok: failures.length === 0,
    schemaVersion: 1,
    project: {
      name: manifest.name,
      version: manifest.version,
    },
    inputs: {
      distDirectory: relative(projectRoot, distDirectory),
      policy: relative(projectRoot, policyPath),
      baseline: relative(projectRoot, baselinePath),
    },
    build,
    dependencyUsage,
    electronIsolation,
    baselineComparison,
    warnings,
    failures,
    staticEvidenceLimits: [
      "Import-graph isolation does not measure Electron startup duration or prove that required work is non-blocking at runtime.",
      "Compressed and on-disk byte counts do not measure parse, compile, module evaluation, image decode, font decode, GPU upload, memory, or first-paint cost.",
      "A missing static asset reference can be a dynamically constructed path; it is a review flag, not automatic deletion authority.",
      "Runtime startup, mode-transition, CPU, memory, and frame-time budgets require instrumented production-build measurements on the supported hardware matrix.",
    ],
  };
}

export function inspectDirectDependencyUsage({
  projectRoot,
  sourceFiles,
  dependencies,
}) {
  const direct = Object.keys(dependencies).sort(compareText);
  const importedByDependency = new Map(
    direct.map((dependency) => [dependency, new Set()]),
  );
  const sourceImports = [];
  const externalImportsOutsideDirectProductionDependencies = [];

  for (const file of sourceFiles) {
    const source = readFileSync(file, "utf8");
    for (const specifier of parseStaticModuleSpecifiers(source, file)) {
      if (isLocalSpecifier(specifier)) continue;
      const packageName = packageNameFromSpecifier(specifier);
      if (!packageName || builtinSpecifiers.has(specifier)) continue;
      const sourceFile = relative(projectRoot, file);
      sourceImports.push({ sourceFile, specifier, packageName });
      if (importedByDependency.has(packageName)) {
        importedByDependency.get(packageName).add(sourceFile);
      } else {
        externalImportsOutsideDirectProductionDependencies.push({
          sourceFile,
          specifier,
          packageName,
        });
      }
    }
  }

  const directDependencies = direct.map((dependency) => {
    const importedBy = [...importedByDependency.get(dependency)].sort(
      compareText,
    );
    return {
      dependency,
      declaredVersion: dependencies[dependency],
      imported: importedBy.length > 0,
      importedBy,
    };
  });

  return {
    scannedProductionSourceFiles: sourceFiles
      .map((file) => relative(projectRoot, file))
      .sort(compareText),
    directDependencies,
    used: directDependencies
      .filter((entry) => entry.imported)
      .map((entry) => entry.dependency),
    unused: directDependencies
      .filter((entry) => !entry.imported)
      .map((entry) => entry.dependency),
    sourceImports: sourceImports.sort(compareImport),
    externalImportsOutsideDirectProductionDependencies:
      externalImportsOutsideDirectProductionDependencies.sort(compareImport),
  };
}

export function inspectElectronIsolation({ projectRoot, policy }) {
  const entrypoints = (
    policy.electronEntrypoints ?? ["electron/main.cjs", "electron/preload.cjs"]
  ).map((entry) => path.resolve(projectRoot, entry));
  const rendererOnlyDependencies = new Set(
    policy.rendererOnlyProductionDependencies ?? [],
  );
  const allowedExternalDependencies = new Set(
    policy.allowedElectronExternalDependencies ?? ["electron"],
  );
  const forbiddenPathPatterns = (
    policy.forbiddenPokerComputationPathPatterns ?? []
  ).map((pattern) => new RegExp(pattern, "i"));
  const visited = new Set();
  const edges = [];
  const violations = [];

  for (const entrypoint of entrypoints) {
    if (!existsSync(entrypoint)) {
      violations.push({
        code: "missing-electron-entrypoint",
        entrypoint: relative(projectRoot, entrypoint),
        message: "Configured Electron entrypoint does not exist.",
      });
      continue;
    }
    visitElectronModule(entrypoint, entrypoint);
  }

  return {
    entrypoints: entrypoints.map((entry) => relative(projectRoot, entry)),
    reachableFiles: [...visited].map((file) => relative(projectRoot, file)).sort(
      compareText,
    ),
    importEdges: edges.sort((left, right) =>
      compareText(
        `${left.from}\0${left.specifier}\0${left.to ?? ""}`,
        `${right.from}\0${right.specifier}\0${right.to ?? ""}`,
      ),
    ),
    policy: {
      allowedExternalDependencies: [...allowedExternalDependencies].sort(
        compareText,
      ),
      rendererOnlyProductionDependencies: [...rendererOnlyDependencies].sort(
        compareText,
      ),
      forbiddenPokerComputationPathPatterns:
        policy.forbiddenPokerComputationPathPatterns ?? [],
    },
    violations: violations.sort((left, right) =>
      compareText(
        `${left.entrypoint ?? ""}\0${left.file ?? ""}\0${left.code}\0${left.specifier ?? ""}`,
        `${right.entrypoint ?? ""}\0${right.file ?? ""}\0${right.code}\0${right.specifier ?? ""}`,
      ),
    ),
  };

  function visitElectronModule(file, entrypoint) {
    const normalized = path.resolve(file);
    if (visited.has(normalized)) return;
    visited.add(normalized);

    const projectRelative = relative(projectRoot, normalized);
    const normalizedRelative = projectRelative.toLowerCase();
    if (
      normalizedRelative === "src" ||
      normalizedRelative.startsWith("src/")
    ) {
      violations.push({
        code: "electron-imports-renderer-source",
        entrypoint: relative(projectRoot, entrypoint),
        file: projectRelative,
        message:
          "Electron main/preload reachability must not cross into renderer source.",
      });
    }
    for (const pattern of forbiddenPathPatterns) {
      if (pattern.test(projectRelative)) {
        violations.push({
          code: "electron-imports-poker-computation",
          entrypoint: relative(projectRoot, entrypoint),
          file: projectRelative,
          pattern: pattern.source,
          message:
            "Electron main/preload reaches a path classified as poker computation.",
        });
      }
    }

    if (!existsSync(normalized)) {
      violations.push({
        code: "unresolved-electron-local-import",
        entrypoint: relative(projectRoot, entrypoint),
        file: projectRelative,
        message: "Electron local import could not be resolved.",
      });
      return;
    }

    const source = readFileSync(normalized, "utf8");
    for (const specifier of parseStaticModuleSpecifiers(source, normalized)) {
      if (isLocalSpecifier(specifier)) {
        const resolved = resolveLocalModule(normalized, specifier);
        edges.push({
          from: projectRelative,
          specifier,
          to: resolved ? relative(projectRoot, resolved) : null,
        });
        if (!resolved) {
          violations.push({
            code: "unresolved-electron-local-import",
            entrypoint: relative(projectRoot, entrypoint),
            file: projectRelative,
            specifier,
            message: "Electron local import could not be resolved.",
          });
          continue;
        }
        visitElectronModule(resolved, entrypoint);
        continue;
      }

      if (builtinSpecifiers.has(specifier)) {
        edges.push({
          from: projectRelative,
          specifier,
          to: "node-builtin",
        });
        continue;
      }

      const packageName = packageNameFromSpecifier(specifier);
      edges.push({
        from: projectRelative,
        specifier,
        to: packageName ? `package:${packageName}` : null,
      });
      if (rendererOnlyDependencies.has(packageName)) {
        violations.push({
          code: "electron-imports-renderer-only-dependency",
          entrypoint: relative(projectRoot, entrypoint),
          file: projectRelative,
          specifier,
          packageName,
          message:
            "Electron main/preload must not import a renderer-only production dependency.",
        });
      } else if (!allowedExternalDependencies.has(packageName)) {
        violations.push({
          code: "electron-imports-unreviewed-external-dependency",
          entrypoint: relative(projectRoot, entrypoint),
          file: projectRelative,
          specifier,
          packageName,
          message:
            "Electron main/preload external dependency is not explicitly allowlisted.",
        });
      }
    }
  }
}

export function inspectBuild(distDirectory) {
  if (!existsSync(distDirectory)) {
    throw new Error(
      `${distDirectory} does not exist; run the production build first.`,
    );
  }
  const absoluteFiles = listFiles(distDirectory);
  const inventory = absoluteFiles.map((file) => {
    const bytes = readFileSync(file);
    const extension = path.extname(file).toLowerCase();
    const category = buildCategory(extension);
    return {
      file: relative(distDirectory, file),
      category,
      bytes: bytes.byteLength,
      gzipBytes:
        category === "javascript" || category === "css"
          ? gzipSync(bytes, { level: 9 }).byteLength
          : null,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      referencedBy: [],
    };
  });
  const textFiles = absoluteFiles
    .filter((file) => textBuildExtensions.has(path.extname(file).toLowerCase()))
    .map((file) => ({
      file,
      relative: relative(distDirectory, file),
      text: readFileSync(file, "utf8"),
    }));

  for (const asset of inventory) {
    for (const candidate of textFiles) {
      if (candidate.relative === asset.file) continue;
      if (referencesBuiltFile(candidate.text, asset.file)) {
        asset.referencedBy.push(candidate.relative);
      }
    }
    asset.referencedBy.sort(compareText);
  }

  const categories = {};
  for (const category of [
    "javascript",
    "css",
    "image",
    "font",
    "html",
    "other",
  ]) {
    const files = inventory.filter((file) => file.category === category);
    categories[category] = {
      files: files.length,
      bytes: sum(files.map((file) => file.bytes)),
      gzipBytes: sum(
        files
          .map((file) => file.gzipBytes)
          .filter((bytes) => bytes !== null),
      ),
    };
  }

  return {
    summary: {
      files: inventory.length,
      bytes: sum(inventory.map((file) => file.bytes)),
      javascriptGzipBytes: categories.javascript.gzipBytes,
      cssGzipBytes: categories.css.gzipBytes,
      categories,
    },
    inventory,
    unreferencedRuntimeAssets: inventory
      .filter(
        (file) =>
          ["javascript", "css", "image", "font"].includes(file.category) &&
          file.referencedBy.length === 0,
      )
      .map((file) => file.file)
      .sort(compareText),
  };
}

export function parseStaticModuleSpecifiers(source, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForFile(fileName),
  );
  const specifiers = new Set();

  walk(sourceFile);
  return [...specifiers].sort(compareText);

  function walk(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === "require") ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, walk);
  }
}

function compareBaseline(summary, baseline) {
  if (!baseline) return null;
  const metrics = [
    ["files", summary.files, baseline.summary.files],
    ["bytes", summary.bytes, baseline.summary.bytes],
    [
      "javascriptGzipBytes",
      summary.javascriptGzipBytes,
      baseline.summary.javascriptGzipBytes,
    ],
    ["cssGzipBytes", summary.cssGzipBytes, baseline.summary.cssGzipBytes],
  ];
  for (const category of Object.keys(summary.categories).sort(compareText)) {
    metrics.push([
      `${category}.files`,
      summary.categories[category].files,
      baseline.summary.categories[category]?.files ?? null,
    ]);
    metrics.push([
      `${category}.bytes`,
      summary.categories[category].bytes,
      baseline.summary.categories[category]?.bytes ?? null,
    ]);
  }
  return {
    schemaVersion: baseline.schemaVersion,
    projectVersion: baseline.projectVersion,
    metrics: metrics.map(([metric, actual, baselineValue]) => ({
      metric,
      actual,
      baseline: baselineValue,
      delta:
        typeof baselineValue === "number" ? actual - baselineValue : null,
    })),
    enforcement:
      "informational-only; config/performance-budgets.json remains the size gate",
  };
}

function listProductionSourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return listFiles(directory).filter((file) => {
    const extension = path.extname(file).toLowerCase();
    const normalized = file.replaceAll("\\", "/");
    return (
      sourceExtensions.has(extension) &&
      !/(\.test|\.spec)\.[cm]?[jt]sx?$/.test(normalized) &&
      !normalized.endsWith(".d.ts")
    );
  });
}

function collectReachableProductionSourceFiles(entrypoints) {
  const visited = new Set();
  for (const entrypoint of entrypoints) visit(entrypoint);
  return [...visited].sort(compareText);

  function visit(file) {
    const normalized = path.resolve(file);
    if (visited.has(normalized) || !existsSync(normalized)) return;
    if (!sourceExtensions.has(path.extname(normalized).toLowerCase())) return;
    visited.add(normalized);
    const source = readFileSync(normalized, "utf8");
    for (const specifier of parseStaticModuleSpecifiers(source, normalized)) {
      if (!isLocalSpecifier(specifier)) continue;
      const resolved = resolveLocalModule(normalized, specifier);
      if (resolved) visit(resolved);
    }
  }
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(target) : [target];
    })
    .filter((file) => statSync(file).isFile());
}

function resolveLocalModule(importer, specifier) {
  const base = specifier.startsWith("/")
    ? path.resolve(specifier)
    : path.resolve(path.dirname(importer), specifier);
  for (const extension of resolutionExtensions) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const extension of resolutionExtensions.slice(1)) {
    const candidate = path.join(base, `index${extension}`);
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isLocalSpecifier(specifier) {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(specifier)
  );
}

function packageNameFromSpecifier(specifier) {
  if (!specifier || isLocalSpecifier(specifier)) return null;
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return name ? `${scope}/${name}` : specifier;
  }
  return specifier.split("/")[0];
}

function buildCategory(extension) {
  if ([".cjs", ".js", ".mjs"].includes(extension)) return "javascript";
  if (extension === ".css") return "css";
  if (
    [
      ".avif",
      ".bmp",
      ".gif",
      ".ico",
      ".jpeg",
      ".jpg",
      ".png",
      ".svg",
      ".webp",
    ].includes(extension)
  ) {
    return "image";
  }
  if ([".eot", ".otf", ".ttf", ".woff", ".woff2"].includes(extension)) {
    return "font";
  }
  if (extension === ".html") return "html";
  return "other";
}

function referencesBuiltFile(text, target) {
  const normalized = target.replaceAll("\\", "/");
  const basename = path.posix.basename(normalized);
  return (
    text.includes(normalized) ||
    text.includes(`/${normalized}`) ||
    text.includes(`./${normalized}`) ||
    text.includes(basename)
  );
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function relative(root, target) {
  return path.relative(root, target).replaceAll("\\", "/");
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function compareImport(left, right) {
  return compareText(
    `${left.packageName}\0${left.sourceFile}\0${left.specifier}`,
    `${right.packageName}\0${right.sourceFile}\0${right.specifier}`,
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function scriptKindForFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".cjs" || extension === ".mjs") {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
