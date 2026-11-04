import assert from "node:assert/strict";
import { assertServiceableBashConfig } from "@deepseek-ai/dsh-bash-local";
import { Config } from "../lib/config.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

// 1. Every field defaults, inherited budgets included (they resolve to live volatile handles).
{
  const config = Config({});
  assert.equal(config.bashPath, "");
  assert.equal(config.bundledEngineDir, "");
  assert.equal(config.confine, true);
  assert.equal(config.requireEngineOnLoad, false);
  assert.equal(config.promptSection, true);
  assert.equal(config.promptDetail, "full", "the retained shape key still defaults to full");
  assert.deepEqual(config.shellEnvOverrides, {});
  assert.equal(config.verifyArtifacts, "stamped", "verification is stamped unless a deployment says otherwise");
  assert.equal(config.cwd.get(), undefined, "the inherited cwd stays optional and resolves at resolve() time");
  for (const field of ["timeoutMs", "maxTimeoutMs", "maxOutputBytes", "maxSpillBytes", "graceMs"]) {
    assert.equal(typeof config[field].get(), "number", `${field} resolves to a volatile handle`);
  }
  assert.ok(config.timeoutMs.get() > 0, "the inherited timeout default survives the reuse");
  assert.ok(config.maxTimeoutMs.get() >= config.timeoutMs.get());
  assert.ok(config.maxSpillBytes.get() >= config.maxOutputBytes.get());
  pass("the schema defaults every field, inherited budgets included");
}

// 2. Volatile markers survive, so a settings write reaches a live instance.
{
  assert.equal(Config.dict.timeoutMs.meta.volatile, true);
  assert.equal(Config.dict.bashPath.meta.volatile, undefined);
  pass("the inherited budgets stay volatile while the new switches stay plain");
}

// 3. An explicit configuration passes through unchanged where it is valid.
{
  const config = Config({
    bashPath: "D:\\eng\\brush.exe",
    bundledEngineDir: "D:\\bundle",
    confine: false,
    shellEnvOverrides: { FOO: "bar" },
    timeoutMs: 5000,
    maxTimeoutMs: 6000,
  });
  assert.equal(config.bashPath, "D:\\eng\\brush.exe");
  assert.equal(config.bundledEngineDir, "D:\\bundle");
  assert.equal(config.confine, false);
  assert.deepEqual(config.shellEnvOverrides, { FOO: "bar" });
  assert.equal(config.timeoutMs.get(), 5000);
  assert.equal(config.maxTimeoutMs.get(), 6000);
  pass("a valid configuration is preserved");
}

// 4. Configuration errors fail at resolution instead of silently picking a path.
{
  assert.throws(() => Config({ bashPath: 5 }), /bashPath/);
  assert.throws(() => Config({ confine: "yes" }));
  // A third contract shape would be a silent fallback to `full`, so the union rejects it.
  assert.throws(() => Config({ promptDetail: "short" }), /promptDetail/);
  // A third verification mode would be a silent fallback to the weaker one, so the union rejects it too.
  assert.throws(() => Config({ verifyArtifacts: "sometimes" }), /verifyArtifacts/);
  pass("schema violations are rejected loudly");
}

// 5. The inherited serviceability check still guards the reused budgets.
{
  const config = Config({});
  assert.doesNotThrow(() => assertServiceableBashConfig(config));
  assert.throws(() => assertServiceableBashConfig({ ...config, timeoutMs: { get: () => 0 } }), /timeoutMs/);
  assert.throws(
    () => assertServiceableBashConfig({ ...config, graceMs: { get: () => Number.MAX_SAFE_INTEGER } }),
    /graceMs/,
  );
  pass("the inherited budget guard applies to the reused schemas");
}

console.log(`\n${passed} 项通过`);
