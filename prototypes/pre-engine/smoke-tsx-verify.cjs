"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const readline = require("readline");
const { spawn } = require("child_process");
const path = require("path");

const helperPath = path.join(__dirname, "ts-deep-layer.cjs");
const fixtureRoot = path.join(__dirname, "fixtures", "smoke-tsx");

function requestFor(root, files, useTsconfig = true) {
  return {
    root: root.replace(/\\/g, "/"),
    files,
    tsconfig: useTsconfig ? path.join(root, "tsconfig.json").replace(/\\/g, "/") : null,
  };
}

function runQuery(name, files, useTsconfig = true, extraEnv = {}) {
  const root = path.join(fixtureRoot, name);
  const request = requestFor(root, files, useTsconfig);

  return new Promise((resolve, reject) => {
    const helper = spawn(process.execPath, [helperPath], {
      cwd: __dirname,
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      helper.kill();
      reject(new Error(`${name}: helper timed out`));
    }, 10000);
    helper.stdout.on("data", chunk => { stdout += chunk.toString(); });
    helper.stderr.on("data", chunk => { stderr += chunk.toString(); });
    helper.on("error", reject);
    helper.on("close", code => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`${name}: helper exited ${code}: ${stderr}`));
        return;
      }
      const line = stdout.trim().split(/\r?\n/).filter(Boolean)[0];
      if (!line) {
        reject(new Error(`${name}: helper returned no response`));
        return;
      }
      resolve(JSON.parse(line));
    });
    helper.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function openSession(extraEnv = {}) {
  const helper = spawn(process.execPath, [helperPath], {
    cwd: __dirname,
    env: { ...process.env, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: helper.stdout })[Symbol.asyncIterator]();
  let stderr = "";
  helper.stderr.on("data", chunk => { stderr += chunk.toString(); });
  const closed = new Promise((resolve, reject) => {
    helper.on("error", reject);
    helper.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`helper exited ${code}: ${stderr}`));
    });
  });
  return {
    async query(request) {
      helper.stdin.write(`${JSON.stringify(request)}\n`);
      let timeout;
      const response = await Promise.race([
        lines.next(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("helper timed out")), 10000);
        }),
      ]).finally(() => clearTimeout(timeout));
      if (response.done) throw new Error(`helper closed before responding: ${stderr}`);
      return JSON.parse(response.value);
    },
    async close() {
      helper.stdin.end();
      await closed;
    },
  };
}

async function main() {
  const valid = await runQuery("valid", ["component.tsx"]);
  assert.equal(valid.status, "verified");
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.verification.tsconfig, "tsconfig.json");
  assert.equal(valid.verification.jsx_mode, "preserve");
  assert.deepEqual(valid.verification.coverage, ["syntax", "types", "module_resolution"]);

  const typeError = await runQuery("type-error", ["component.tsx"]);
  assert.equal(typeError.status, "verified");
  const typeDiagnostic = typeError.issues.find(issue => issue.code === "TS2322");
  assert(typeDiagnostic, "expected TS2322 type diagnostic");
  assert.equal(typeDiagnostic.kind, "type_error");
  assert.equal(typeDiagnostic.file, "component.tsx");
  assert.equal(typeDiagnostic.line, 7);
  assert(typeDiagnostic.column > 0, "expected a one-based diagnostic column");
  assert.equal(typeDiagnostic.severity, "error");
  assert.equal(typeDiagnostic.source, "typescript-deep-layer");
  assert(typeDiagnostic.message.includes("string"));

  const noConfig = await runQuery("no-config", ["component.tsx"], false);
  assert.equal(noConfig.status, "fallback_used");
  assert(noConfig.verification.missing.includes("tsconfig"));
  assert.equal(noConfig.verification.jsx_mode, "preserve");
  assert(noConfig.reason.includes("missing=tsconfig"));

  const invalidConfig = await runQuery("invalid-config", ["component.tsx"]);
  assert.equal(invalidConfig.status, "fallback_used");
  const configDiagnostic = invalidConfig.issues.find(issue => issue.kind === "config_error");
  assert(configDiagnostic, "expected a tsconfig diagnostic");
  assert.equal(configDiagnostic.file, "tsconfig.json");
  assert(configDiagnostic.line > 0);
  assert(configDiagnostic.column > 0);
  assert.equal(configDiagnostic.severity, "error");
  assert(configDiagnostic.code.startsWith("TS"));
  assert(invalidConfig.verification.missing.includes("valid_tsconfig"));

  const missingRuntime = await runQuery("missing-runtime", ["component.tsx"]);
  assert.equal(missingRuntime.status, "partially_verified");
  const runtimeDiagnostic = missingRuntime.issues.find(issue => issue.kind === "module_resolution_error");
  assert(runtimeDiagnostic, "expected a JSX runtime module resolution diagnostic");
  assert.equal(runtimeDiagnostic.file, "component.tsx");
  assert(runtimeDiagnostic.line > 0);
  assert(runtimeDiagnostic.column > 0);
  assert.equal(runtimeDiagnostic.severity, "error");
  assert(["TS2874", "TS2875"].includes(runtimeDiagnostic.code));
  assert(missingRuntime.verification.missing.includes("jsx_runtime_types"));

  const toolMissing = await runQuery(
    "valid",
    ["component.tsx"],
    true,
    { LINGHUN_PRE_ENGINE_DISABLE_TYPESCRIPT: "1" },
  );
  assert.equal(toolMissing.status, "tool_missing");
  assert(toolMissing.verification.missing.includes("typescript"));

  const structureRoot = path.join(fixtureRoot, "mixed");
  const structureRequest = {
    ...requestFor(structureRoot, ["types.ts", "component.tsx"]),
    op: "analyze",
    symbols: ["Greeting"],
    preferred_files: ["component.tsx"],
  };
  const structureSession = openSession();
  try {
    const structure = await structureSession.query(structureRequest);
    assert.equal(structure.status, "verified");
    assert.deepEqual(structure.relations.Greeting.targets, [
      { file: "types.ts", name: "Greeting" },
    ]);
    assert.equal(structure.program_rebuilt, true);

    const verification = await structureSession.query(
      requestFor(structureRoot, ["types.ts", "component.tsx"]),
    );
    assert.equal(verification.status, "partially_verified");
    assert.equal(verification.program_rebuilt, false);
    assert.equal(verification.program_build_count, structure.program_build_count);
    assert.equal(verification.snapshot_id, structure.snapshot_id);
  } finally {
    await structureSession.close();
  }

  const freshnessRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-tsx-program-freshness-"));
  fs.cpSync(structureRoot, freshnessRoot, { recursive: true });
  const freshnessSession = openSession();
  try {
    const request = {
      ...requestFor(freshnessRoot, ["component.tsx"]),
      op: "analyze",
      symbols: ["Greeting"],
      preferred_files: ["component.tsx"],
    };
    const initial = await freshnessSession.query(request);
    assert.equal(initial.program_build_count, 1);
    assert(!initial.relations.Greeting.related_files.includes("late-reference.tsx"));

    fs.writeFileSync(
      path.join(freshnessRoot, "late-reference.tsx"),
      'import type { Greeting } from "./types";\nexport const late: Greeting = { message: "late" };\n',
    );
    const refreshed = await freshnessSession.query(request);
    assert.equal(refreshed.program_rebuilt, true);
    assert.equal(refreshed.program_build_count, 2);
    assert(refreshed.relations.Greeting.related_files.includes("late-reference.tsx"));
  } finally {
    await freshnessSession.close();
    fs.rmSync(freshnessRoot, { recursive: true, force: true });
  }

  const missingStructureSession = openSession({ LINGHUN_PRE_ENGINE_DISABLE_TYPESCRIPT: "1" });
  try {
    const missingStructure = await missingStructureSession.query(structureRequest);
    assert.equal(missingStructure.status, "tool_missing");
    assert.deepEqual(missingStructure.relations.Greeting.targets, []);
  } finally {
    await missingStructureSession.close();
  }

  const cacheSession = openSession();
  const validRequest = requestFor(path.join(fixtureRoot, "valid"), ["component.tsx"]);
  const typeErrorRequest = requestFor(path.join(fixtureRoot, "type-error"), ["component.tsx"]);
  assert.equal((await cacheSession.query(validRequest)).status, "verified");
  assert((await cacheSession.query(typeErrorRequest)).issues.some(issue => issue.code === "TS2322"));
  assert.deepEqual((await cacheSession.query(validRequest)).issues, []);
  await cacheSession.close();

  const mixedSession = openSession();
  try {
    const mixedRequest = requestFor(path.join(fixtureRoot, "mixed"), ["types.ts", "component.tsx"]);
    const mixed = await mixedSession.query(mixedRequest);
    assert.equal(mixed.program_rebuilt, true);
    assert.equal(mixed.program_build_count, 1);
    assert.equal(mixed.language_results.TypeScript.status, "verified");
    assert.equal(mixed.language_results.TSX.status, "fallback_used");
    assert(mixed.language_results.TSX.verification.missing.includes("jsx_compiler_option"));
    assert(!mixed.language_results.TypeScript.verification.missing.includes("jsx_compiler_option"));

    for (let index = 0; index < 50; index += 1) {
      const hot = await mixedSession.query(mixedRequest);
      assert.equal(hot.program_rebuilt, false, `mixed hot query ${index + 1} rebuilt Program`);
      assert.equal(hot.program_build_count, 1, `mixed hot query ${index + 1} changed build count`);
      assert.equal(hot.language_results.TypeScript.status, "verified");
      assert.equal(hot.language_results.TSX.status, "fallback_used");
    }
  } finally {
    await mixedSession.close();
  }

  const invalidMixedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-ts-mixed-invalid-"));
  fs.cpSync(path.join(fixtureRoot, "mixed"), invalidMixedRoot, { recursive: true });
  const invalidMixedConfig = path.join(invalidMixedRoot, "tsconfig.json");
  fs.writeFileSync(
    invalidMixedConfig,
    fs.readFileSync(invalidMixedConfig, "utf8").replace('"strict": true', '"strict": "invalid"'),
  );
  const invalidMixedSession = openSession();
  try {
    const invalidMixed = await invalidMixedSession.query(
      requestFor(invalidMixedRoot, ["types.ts", "component.tsx"]),
    );
    assert.equal(invalidMixed.language_results.TypeScript.status, "fallback_used");
    assert.equal(invalidMixed.language_results.TSX.status, "fallback_used");
    assert(invalidMixed.language_results.TypeScript.verification.missing.includes("valid_tsconfig"));
    assert(invalidMixed.language_results.TSX.verification.missing.includes("valid_tsconfig"));
  } finally {
    await invalidMixedSession.close();
    fs.rmSync(invalidMixedRoot, { recursive: true, force: true });
  }

  const mixedRuntimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-ts-mixed-runtime-"));
  fs.cpSync(path.join(fixtureRoot, "missing-runtime"), mixedRuntimeRoot, { recursive: true });
  fs.writeFileSync(path.join(mixedRuntimeRoot, "types.ts"), "export const valid: string = 'ok';\n");
  const mixedRuntimeSession = openSession();
  try {
    const mixedRuntime = await mixedRuntimeSession.query(
      requestFor(mixedRuntimeRoot, ["types.ts", "component.tsx"]),
    );
    assert.equal(mixedRuntime.language_results.TypeScript.status, "verified");
    assert.equal(mixedRuntime.language_results.TSX.status, "partially_verified");
    assert(!mixedRuntime.language_results.TypeScript.verification.missing.includes("jsx_runtime_types"));
    assert(mixedRuntime.language_results.TSX.verification.missing.includes("jsx_runtime_types"));
  } finally {
    await mixedRuntimeSession.close();
    fs.rmSync(mixedRuntimeRoot, { recursive: true, force: true });
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "linghun-tsx-config-cache-"));
  const sourceRoot = path.join(fixtureRoot, "valid");
  fs.cpSync(sourceRoot, tempRoot, { recursive: true });
  const tempConfig = path.join(tempRoot, "tsconfig.json");
  const validConfig = fs.readFileSync(tempConfig, "utf8");
  const configSession = openSession();
  try {
    const request = requestFor(tempRoot, ["component.tsx"]);
    assert.equal((await configSession.query(request)).status, "verified");
    fs.writeFileSync(tempConfig, validConfig.replace('"preserve"', '"not-a-jsx-mode"'));
    const changedConfig = await configSession.query(request);
    assert.equal(changedConfig.status, "fallback_used");
    assert(changedConfig.issues.some(issue => issue.kind === "config_error"));
    fs.writeFileSync(tempConfig, validConfig);
    assert.equal((await configSession.query(request)).status, "verified");
  } finally {
    await configSession.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log("TSX VERIFY SMOKE: PASS");
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
