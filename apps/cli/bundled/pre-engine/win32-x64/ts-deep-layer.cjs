"use strict";
const readline = require("readline");
const path = require("path");
const fs = require("fs");

const DISABLE_TYPESCRIPT_ENV = "LINGHUN_PRE_ENGINE_DISABLE_TYPESCRIPT";
const MODULE_RESOLUTION_CODES = new Set([2307, 2792, 7016, 2874, 2875]);
const JSX_RUNTIME_CODES = new Set([2874, 2875]);

let ts = null;
let cachedHost = null;
let cachedOpts = null;
let cachedFileNames = null;
let cachedRoot = null;
let cachedSetupKey = null;
let cachedSetup = null;
let currentProgram = null;
let currentProgramDependencies = null;
let fileStatCache = new Map();
let projectWatcher = null;
let programDirty = false;
let configuredDirectoryStats = new Map();
let knownProjectFiles = new Set();
let programBuildCount = 0;

function snapshotId() {
  return String(programBuildCount);
}

function updateStatCache(absPath) {
  try {
    const st = fs.statSync(absPath);
    const cached = fileStatCache.get(absPath);
    const changed = !cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size;
    fileStatCache.set(absPath, { mtimeMs: st.mtimeMs, size: st.size });
    return changed;
  } catch {
    fileStatCache.delete(absPath);
    return true;
  }
}

function closeFileWatchers() {
  if (projectWatcher) projectWatcher.close();
  projectWatcher = null;
  programDirty = false;
}

function tryResolveTs(root) {
  if (process.env[DISABLE_TYPESCRIPT_ENV] === "1") return null;
  for (const candidate of [path.join(root, "node_modules", "typescript"), "typescript"]) {
    try {
      return require(candidate);
    } catch {}
  }
  return null;
}

function relativePath(root, fileName) {
  if (!fileName) return null;
  return path.relative(root, fileName).replace(/\\/g, "/");
}

function jsxModeName(value) {
  if (value === undefined) return "not_configured";
  const modes = new Map([
    [ts.JsxEmit.None, "none"],
    [ts.JsxEmit.Preserve, "preserve"],
    [ts.JsxEmit.React, "react"],
    [ts.JsxEmit.ReactNative, "react-native"],
    [ts.JsxEmit.ReactJSX, "react-jsx"],
    [ts.JsxEmit.ReactJSXDev, "react-jsxdev"],
  ]);
  return modes.get(value) || `unknown(${value})`;
}

function diagnosticIssue(root, diagnostic, diagnosticClass, fallbackFile) {
  const fileName = diagnostic.file ? diagnostic.file.fileName : fallbackFile;
  let line = 1;
  let column = 1;
  if (diagnostic.file && diagnostic.start != null) {
    const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    line = location.line + 1;
    column = location.character + 1;
  }
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const severity = (ts.DiagnosticCategory[diagnostic.category] || "error").toLowerCase();
  return {
    file: relativePath(root, fileName),
    line,
    column,
    severity,
    kind: diagnosticClass,
    code: `TS${diagnostic.code}`,
    detail: message,
    message,
    source: "typescript-deep-layer",
  };
}

function configIssue(root, tsconfigPath, code, message) {
  return {
    file: relativePath(root, tsconfigPath),
    line: 1,
    column: 1,
    severity: "error",
    kind: "config_error",
    code,
    detail: message,
    message,
    source: "typescript-deep-layer",
  };
}

function setupReason(setup) {
  const config = setup.verification.tsconfig || "none";
  const missing = setup.verification.missing.length > 0
    ? setup.verification.missing.join(",")
    : "none";
  return `tsconfig=${config}; jsx=${setup.verification.jsx_mode}; TypeScript=${setup.verification.typescript_version}; coverage=${setup.verification.coverage.join(",")}; missing=${missing}`;
}

function ensureSetup(root, tsconfigPath) {
  if (cachedRoot !== null && cachedRoot !== root) ts = null;
  if (!ts) {
    ts = tryResolveTs(root);
    if (!ts) {
      const verification = {
        tsconfig: tsconfigPath ? relativePath(root, tsconfigPath) : null,
        jsx_mode: "not_checked",
        typescript_version: null,
        coverage: [],
        missing: ["typescript"],
      };
      return {
        issues: [],
        status: "tool_missing",
        reason: "TypeScript package not available; coverage=none; missing=typescript",
        verification,
      };
    }
  }

  let tsconfigFingerprint = "";
  if (tsconfigPath) {
    try {
      tsconfigFingerprint = fs.readFileSync(tsconfigPath, "utf8");
    } catch (error) {
      tsconfigFingerprint = `unreadable:${error.code || String(error)}`;
    }
  }
  const setupKey = `${root}\n${tsconfigPath || ""}\n${tsconfigFingerprint}`;
  if (cachedRoot === root && cachedSetupKey === setupKey) return cachedSetup;

  let opts = { noEmit: true, strict: false, skipLibCheck: true };
  let fileNames = [];
  const issues = [];
  const missing = [];
  let status = "verified";

  if (!tsconfigPath) {
    status = "fallback_used";
    missing.push("tsconfig");
  } else {
    const cfgFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (cfgFile.error) {
      issues.push(diagnosticIssue(root, cfgFile.error, "config_error", tsconfigPath));
      status = "fallback_used";
      missing.push("valid_tsconfig");
    } else {
      const parsed = ts.parseJsonConfigFileContent(cfgFile.config, ts.sys, path.dirname(tsconfigPath));
      opts = { ...parsed.options, noEmit: true };
      fileNames = parsed.fileNames;
      for (const diagnostic of parsed.errors) {
        issues.push(diagnosticIssue(root, diagnostic, "config_error", tsconfigPath));
      }
      if (parsed.errors.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) {
        status = "fallback_used";
        missing.push("valid_tsconfig");
      }
    }
  }

  const jsxOptionMissing = opts.jsx === undefined;
  if (jsxOptionMissing) {
    opts.jsx = ts.JsxEmit.Preserve;
  }

  const verification = {
    tsconfig: tsconfigPath ? relativePath(root, tsconfigPath) : null,
    jsx_mode: jsxModeName(opts.jsx),
    typescript_version: ts.version,
    coverage: ["syntax", "types", "module_resolution"],
    missing,
  };
  cachedOpts = opts;
  cachedFileNames = fileNames;
  cachedHost = ts.createCompilerHost(opts);
  cachedRoot = root;
  cachedSetupKey = setupKey;
  cachedSetup = { issues, status, verification, jsxOptionMissing };
  currentProgram = null;
  currentProgramDependencies = null;
  fileStatCache.clear();
  closeFileWatchers();
  configuredDirectoryStats.clear();
  knownProjectFiles.clear();
  cachedSetup.reason = setupReason(cachedSetup);
  return cachedSetup;
}

function diagnosticClass(diagnostic, group) {
  if (group === "syntax") return "syntax_error";
  if (MODULE_RESOLUTION_CODES.has(diagnostic.code)) return "module_resolution_error";
  return "type_error";
}

function languageForFile(file) {
  return file.toLowerCase().endsWith(".tsx") ? "TSX" : "TypeScript";
}

function resultForLanguage(setup, additionalMissing) {
  const verification = {
    ...setup.verification,
    missing: [...new Set([...setup.verification.missing, ...additionalMissing])],
  };
  let status = setup.status;
  if (status === "verified" && verification.missing.includes("jsx_compiler_option")) {
    status = "fallback_used";
  } else if (status === "verified" && verification.missing.length > 0) {
    status = "partially_verified";
  }
  const result = { status, verification };
  result.reason = setupReason(result);
  return result;
}

function aggregateStatus(languageResults, fallbackStatus) {
  const statuses = Object.values(languageResults).map(result => result.status);
  if (statuses.length === 0) return fallbackStatus;
  if (statuses.every(status => status === statuses[0])) return statuses[0];
  return "partially_verified";
}

function projectSourceFiles(root) {
  if (!currentProgram) return [];
  const normalizedRoot = path.normalize(root) + path.sep;
  return currentProgram.getSourceFiles()
    .filter(sourceFile => path.normalize(sourceFile.fileName).startsWith(normalizedRoot))
    .map(sourceFile => sourceFile.fileName);
}

function syncProjectFileWatchers(root) {
  if (projectWatcher) return;
  try {
    projectWatcher = fs.watch(root, { persistent: false, recursive: true }, () => {
      programDirty = true;
    });
    projectWatcher.on("error", () => {
      closeFileWatchers();
      programDirty = true;
    });
  } catch {
    programDirty = true;
  }
}

function refreshConfiguredFiles(tsconfigPath) {
  if (!tsconfigPath) return false;
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) return false;
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(tsconfigPath));
  const nextFiles = parsed.fileNames.map(path.normalize).sort();
  const currentFiles = cachedFileNames.map(path.normalize).sort();
  if (nextFiles.length === currentFiles.length
    && nextFiles.every((file, index) => file === currentFiles[index])) {
    return false;
  }
  cachedFileNames = parsed.fileNames;
  return true;
}

function configuredFileSetMayHaveChanged(root) {
  const normalizedRoot = path.normalize(root);
  const directories = new Set([normalizedRoot]);
  for (const file of cachedFileNames) {
    let directory = path.dirname(path.normalize(file));
    while (directory.startsWith(normalizedRoot)) {
      directories.add(directory);
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }
  let changed = configuredDirectoryStats.size !== directories.size;
  const nextStats = new Map();
  for (const directory of directories) {
    let mtimeMs = null;
    try {
      mtimeMs = fs.statSync(directory).mtimeMs;
    } catch {}
    nextStats.set(directory, mtimeMs);
    if (configuredDirectoryStats.get(directory) !== mtimeMs) changed = true;
  }
  configuredDirectoryStats = nextStats;
  return changed;
}

function prepareProgram(root, files, tsconfigPath) {
  const absFiles = files.map(file => path.isAbsolute(file) ? file : path.join(root, file));
  const setup = ensureSetup(root, tsconfigPath);
  if (setup.status === "tool_missing") {
    return { setup, absFiles, programRebuilt: false };
  }

  for (const file of absFiles) knownProjectFiles.add(file);
  const configuredFilesChanged = currentProgram !== null
    && configuredFileSetMayHaveChanged(root)
    && refreshConfiguredFiles(tsconfigPath);
  const allFiles = [...new Set([...cachedFileNames, ...knownProjectFiles])];
  const watcherReportedChange = programDirty;
  const trackedFiles = new Set(absFiles);
  let anyStatChanged = false;
  for (const file of trackedFiles) {
    const hadStat = fileStatCache.has(file);
    const changed = updateStatCache(file);
    const alreadyLoaded = currentProgram?.getSourceFile(path.normalize(file));
    if (changed && (hadStat || !alreadyLoaded)) anyStatChanged = true;
  }

  let needRebuild = !currentProgram
    || configuredFilesChanged
    || watcherReportedChange
    || anyStatChanged;
  if (!needRebuild) {
    for (const file of absFiles) {
      if (!currentProgram.getSourceFile(path.normalize(file))) {
        needRebuild = true;
        break;
      }
    }
  }

  if (needRebuild) {
    currentProgram = ts.createProgram(allFiles, cachedOpts, cachedHost, currentProgram);
    currentProgramDependencies = null;
    programBuildCount += 1;
    configuredFileSetMayHaveChanged(root);
    syncProjectFileWatchers(root);
    programDirty = false;
  }
  return { setup, absFiles, programRebuilt: needRebuild };
}

function runCheck(root, files, tsconfigPath) {
  const prepared = prepareProgram(root, files, tsconfigPath);
  const { setup, absFiles } = prepared;
  const hasTsx = absFiles.some(file => file.toLowerCase().endsWith(".tsx"));
  const requestedLanguages = [...new Set(absFiles.map(languageForFile))];
  if (setup.status === "tool_missing") {
    const languageResults = Object.fromEntries(requestedLanguages.map(language => [
      language,
      resultForLanguage(setup, []),
    ]));
    return {
      ...setup,
      language_results: languageResults,
      program_build_count: programBuildCount,
      program_rebuilt: false,
      snapshot_id: snapshotId(),
    };
  }

  const additionalMissing = { TypeScript: [], TSX: [] };
  const queryIssues = [];
  if (hasTsx && setup.jsxOptionMissing && tsconfigPath && !setup.verification.missing.includes("valid_tsconfig")) {
    queryIssues.push(configIssue(
      root,
      tsconfigPath,
      "LINGHUN_TSX_JSX_OPTION_MISSING",
      "TSX verification requires compilerOptions.jsx; using jsx=preserve fallback",
    ));
    additionalMissing.TSX.push("jsx_compiler_option");
  }

  const issues = [...setup.issues, ...queryIssues];
  for (const file of absFiles) {
    const language = languageForFile(file);
    const sourceFile = currentProgram.getSourceFile(path.normalize(file));
    if (!sourceFile) {
      additionalMissing[language].push("source_file");
      issues.push(configIssue(root, file, "LINGHUN_TS_SOURCE_NOT_LOADED", "Changed file was not loaded by TypeScript"));
      continue;
    }
    const diagnostics = [
      ...currentProgram.getSyntacticDiagnostics(sourceFile).map(diagnostic => [diagnostic, "syntax"]),
      ...currentProgram.getSemanticDiagnostics(sourceFile).map(diagnostic => [diagnostic, "semantic"]),
    ];
    for (const [diagnostic, group] of diagnostics) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
      const issue = diagnosticIssue(root, diagnostic, diagnosticClass(diagnostic, group), file);
      issues.push(issue);
      if (JSX_RUNTIME_CODES.has(diagnostic.code)) {
        additionalMissing[language].push("jsx_runtime_types");
      }
    }
  }

  const languageResults = Object.fromEntries(requestedLanguages.map(language => [
    language,
    resultForLanguage(setup, additionalMissing[language]),
  ]));
  const verification = {
    ...setup.verification,
    missing: [...new Set([
      ...setup.verification.missing,
      ...Object.values(additionalMissing).flat(),
    ])],
  };
  const result = {
    issues,
    status: aggregateStatus(languageResults, setup.status),
    verification,
    language_results: languageResults,
    program_build_count: programBuildCount,
    program_rebuilt: prepared.programRebuilt,
    snapshot_id: snapshotId(),
  };
  result.reason = setupReason(result);
  return result;
}

function canonicalSymbol(checker, symbol) {
  const seen = new Set();
  let current = symbol;
  while (current && (current.flags & ts.SymbolFlags.Alias) && !seen.has(current)) {
    seen.add(current);
    try {
      current = checker.getAliasedSymbol(current);
    } catch {
      break;
    }
  }
  return current;
}

function symbolKey(checker, symbol) {
  const canonical = canonicalSymbol(checker, symbol);
  if (!canonical) return null;
  const declarations = canonical.getDeclarations() || [];
  const locations = declarations.map(declaration =>
    `${path.normalize(declaration.getSourceFile().fileName)}:${declaration.pos}:${declaration.end}`,
  ).sort();
  return locations.length > 0 ? locations.join("|") : null;
}

function declarationName(declaration, fallback) {
  return declaration.name && ts.isIdentifier(declaration.name)
    ? declaration.name.text
    : fallback;
}

function visitIdentifiers(node, visit) {
  if (ts.isIdentifier(node)) visit(node);
  ts.forEachChild(node, child => visitIdentifiers(child, visit));
}

function visitModuleAliasIdentifiers(sourceFile, visit) {
  function walk(node) {
    if (ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) {
      if (node.propertyName) visit(node.propertyName);
      visit(node.name);
    } else if (ts.isImportClause(node) && node.name) {
      visit(node.name);
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return specifiers;
}

function hasDynamicImport(sourceFile) {
  let found = false;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function resolvedSourceModule(root, sourceFile, specifier) {
  const text = specifier.text;
  const resolved = currentProgram
    .getResolvedModuleFromModuleSpecifier(specifier, sourceFile)
    ?.resolvedModule;
  const normalizedRoot = path.normalize(root) + path.sep;
  if (resolved) {
    const file = path.normalize(resolved.resolvedFileName);
    if (file.startsWith(normalizedRoot)) {
      return { kind: "project", file: relativePath(root, file) };
    }
    return { kind: "external" };
  }
  if (text.startsWith(".")) {
    const candidate = path.resolve(path.dirname(sourceFile.fileName), text);
    if (!path.normalize(candidate).startsWith(normalizedRoot)) return { kind: "blocked" };
    return { kind: "missing_relative" };
  }
  return { kind: "external" };
}

function programDependencies(root, sourceFiles) {
  const result = new Map();
  const normalizedRoot = path.normalize(root) + path.sep;
  for (const sourceFile of sourceFiles) {
    const file = relativePath(root, sourceFile.fileName);
    const dependencies = new Set();
    currentProgram.forEachResolvedModule(({ resolvedModule }) => {
      if (!resolvedModule) return;
      const resolvedFile = path.normalize(resolvedModule.resolvedFileName);
      if (resolvedFile.startsWith(normalizedRoot)) {
        dependencies.add(relativePath(root, resolvedFile));
      }
    }, sourceFile);
    result.set(file, dependencies);
  }
  return result;
}

function graphHasCycle(dependencies, files) {
  const relevant = new Set(files);
  const visiting = new Set();
  const visited = new Set();
  function visit(file) {
    if (visiting.has(file)) return true;
    if (visited.has(file)) return false;
    visiting.add(file);
    for (const dependency of dependencies.get(file) || []) {
      if (relevant.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(file);
    visited.add(file);
    return false;
  }
  return [...relevant].some(visit);
}

function emptyRelations() {
  return {
    targets: [],
    names_by_file: {},
    related_files: [],
    unresolved_module_specifiers: [],
    unresolved_relative_specifiers: [],
    external_module_specifiers: [],
    blocked_module_specifiers: [],
    dynamic_import_files: [],
    graph_cycle: false,
    graph_truncated: false,
  };
}

function runAnalyze(root, files, symbols, preferredFiles, tsconfigPath) {
  const prepared = prepareProgram(root, files, tsconfigPath);
  const { setup } = prepared;
  if (!currentProgram || setup.status === "tool_missing") {
    return {
      status: setup.status,
      reason: setup.reason,
      verification: setup.verification,
      relations: Object.fromEntries(symbols.map(symbol => [symbol, emptyRelations()])),
      module_dependencies: {},
      program_build_count: programBuildCount,
      program_rebuilt: false,
      snapshot_id: snapshotId(),
    };
  }

  const checker = currentProgram.getTypeChecker();
  const sourceFiles = currentProgram.getSourceFiles().filter(sourceFile => {
    const relative = relativePath(root, sourceFile.fileName);
    return relative && !relative.startsWith("../") && !path.isAbsolute(relative);
  });
  const sourcesByFile = new Map(sourceFiles.map(sourceFile => [relativePath(root, sourceFile.fileName), sourceFile]));
  const preferred = new Set(preferredFiles.map(file => relativePath(root, path.isAbsolute(file) ? file : path.join(root, file))));
  const seedSources = preferred.size > 0
    ? [...preferred].map(file => sourcesByFile.get(file)).filter(Boolean)
    : sourceFiles;
  if (!currentProgramDependencies) {
    currentProgramDependencies = programDependencies(root, sourceFiles);
  }
  const dependencies = currentProgramDependencies;
  const relations = {};

  for (const requestedSymbol of symbols) {
    const targetKeys = new Set();
    const targetsByKey = new Map();
    const seedFiles = new Set();
    for (const sourceFile of seedSources) {
      visitIdentifiers(sourceFile, identifier => {
        if (identifier.text !== requestedSymbol) return;
        seedFiles.add(relativePath(root, sourceFile.fileName));
        const symbol = checker.getSymbolAtLocation(identifier);
        const canonical = canonicalSymbol(checker, symbol);
        const key = symbolKey(checker, canonical);
        if (!canonical || !key) return;
        const declaration = (canonical.getDeclarations() || []).find(candidate => {
          const file = relativePath(root, candidate.getSourceFile().fileName);
          return file && !file.startsWith("../") && !path.isAbsolute(file);
        });
        if (!declaration) return;
        targetKeys.add(key);
        targetsByKey.set(key, {
          file: relativePath(root, declaration.getSourceFile().fileName),
          name: declarationName(declaration, canonical.getName()),
        });
      });
    }

    const candidateNames = new Set([
      requestedSymbol,
      ...[...targetsByKey.values()].map(target => target.name),
    ]);
    for (const sourceFile of sourceFiles) {
      visitModuleAliasIdentifiers(sourceFile, identifier => {
        const key = symbolKey(checker, checker.getSymbolAtLocation(identifier));
        if (key && targetKeys.has(key)) candidateNames.add(identifier.text);
      });
    }

    const namesByFile = new Map();
    const relatedFiles = new Set(seedFiles);
    for (const sourceFile of sourceFiles) {
      visitIdentifiers(sourceFile, identifier => {
        if (!candidateNames.has(identifier.text)) return;
        const key = symbolKey(checker, checker.getSymbolAtLocation(identifier));
        if (!key || !targetKeys.has(key)) return;
        const file = relativePath(root, sourceFile.fileName);
        relatedFiles.add(file);
        if (!namesByFile.has(file)) namesByFile.set(file, new Set());
        if (identifier.text !== "default") namesByFile.get(file).add(identifier.text);
      });
    }
    if (targetKeys.size === 0) {
      const pending = [...relatedFiles];
      while (pending.length > 0) {
        const file = pending.pop();
        for (const dependency of dependencies.get(file) || []) {
          if (relatedFiles.has(dependency)) continue;
          relatedFiles.add(dependency);
          pending.push(dependency);
        }
      }
    }

    const unresolved = new Set();
    const unresolvedRelative = new Set();
    const external = new Set();
    const blocked = new Set();
    for (const file of relatedFiles) {
      const sourceFile = sourcesByFile.get(file);
      if (!sourceFile) continue;
      for (const specifier of moduleSpecifiers(sourceFile)) {
        const resolution = resolvedSourceModule(root, sourceFile, specifier);
        if (resolution.kind === "missing_relative") {
          unresolved.add(specifier.text);
          unresolvedRelative.add(specifier.text);
        } else if (resolution.kind === "external") {
          external.add(specifier.text);
        } else if (resolution.kind === "blocked") {
          blocked.add(specifier.text);
        }
      }
    }

    relations[requestedSymbol] = {
      targets: [...targetsByKey.values()].sort((left, right) => left.file.localeCompare(right.file) || left.name.localeCompare(right.name)),
      names_by_file: Object.fromEntries([...namesByFile].sort().map(([file, names]) => [file, [...names].sort()])),
      related_files: [...relatedFiles].sort(),
      unresolved_module_specifiers: [...unresolved].sort(),
      unresolved_relative_specifiers: [...unresolvedRelative].sort(),
      external_module_specifiers: [...external].sort(),
      blocked_module_specifiers: [...blocked].sort(),
      dynamic_import_files: [...relatedFiles].filter(file => hasDynamicImport(sourcesByFile.get(file))).sort(),
      graph_cycle: graphHasCycle(dependencies, relatedFiles),
      graph_truncated: false,
    };
  }

  const requestedDependencyFiles = [...new Set([
    ...files.map(file => relativePath(root, path.isAbsolute(file) ? file : path.join(root, file))),
    ...Object.values(relations).flatMap(relation => relation.related_files),
  ])];
  const moduleDependencies = Object.fromEntries(requestedDependencyFiles.sort().map(file => [
    file,
    [...(dependencies.get(file) || [])].filter(dependency => requestedDependencyFiles.includes(dependency)).sort(),
  ]));
  const result = {
    status: setup.status,
    reason: setup.reason,
    verification: setup.verification,
    relations,
    module_dependencies: moduleDependencies,
    program_build_count: programBuildCount,
    program_rebuilt: prepared.programRebuilt,
    snapshot_id: snapshotId(),
  };
  return result;
}

function runPrepare(root, files, tsconfigPath) {
  const prepared = prepareProgram(root, files, tsconfigPath);
  if (currentProgram && !currentProgramDependencies) {
    currentProgramDependencies = programDependencies(
      root,
      currentProgram.getSourceFiles().filter(sourceFile => {
        const relative = relativePath(root, sourceFile.fileName);
        return relative && !relative.startsWith("../") && !path.isAbsolute(relative);
      }),
    );
  }
  return {
    status: prepared.setup.status,
    reason: prepared.setup.reason,
    verification: prepared.setup.verification,
    program_build_count: programBuildCount,
    program_rebuilt: prepared.programRebuilt,
    snapshot_id: snapshotId(),
  };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", line => {
  line = line.trim();
  if (!line) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const t0 = Date.now();
  let resp;
  try {
    const result = req.op === "analyze"
      ? runAnalyze(
        req.root,
        req.files || [],
        req.symbols || [],
        req.preferred_files || [],
        req.tsconfig || null,
      )
      : req.op === "prepare"
        ? runPrepare(req.root, req.files || [], req.tsconfig || null)
      : runCheck(req.root, req.files || [], req.tsconfig || null);
    resp = { ...result, elapsed_ms: Date.now() - t0 };
  } catch (error) {
    resp = { error: String(error), elapsed_ms: Date.now() - t0 };
  }
  process.stdout.write(JSON.stringify(resp) + "\n");
});
