// The harness's own policy: a machine without an engine skips, a machine with a refused one fails.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineOrThrow, findEngine, pathWithToolchain } from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const probe = (overrides) => ({ label: "packaged engine", displayPath: "this package", found: false, ...overrides });

/** Put `DSH_BASH_NATIVE_ENGINE` back the way the caller had it, including "not set at all". */
function restore(previous) {
  if (previous === undefined) delete process.env.DSH_BASH_NATIVE_ENGINE;
  else process.env.DSH_BASH_NATIVE_ENGINE = previous;
}

// 1. No candidate at all is a skip, because a machine that never installed one is supported.
{
  const resolution = {
    engine: null,
    probed: [probe({ found: false }), probe({ label: "brush on PATH", displayPath: "brush", found: false })],
    failure: "dsh-bash-native: no usable brush engine was found. Probed:\n  - …",
  };
  assert.equal(engineOrThrow(resolution), null);
  pass("a resolution with no candidates is a skip");
}

// 2. A refused candidate is a failure: the build is not this one, or the verifier is broken.
{
  const resolution = {
    engine: null,
    probed: [probe({ found: true, refused: "it is brush but not the build this contract describes: tmp=0 did not hold" })],
    failure: "dsh-bash-native: no usable brush engine was found. Probed:\n  - packaged engine: this package -> refused: …",
  };
  assert.throws(() => engineOrThrow(resolution), /no usable brush engine was found/);
  pass("a refused candidate fails instead of reporting no engine");
}

// 3. A refusal decided before probing (a corrupt artifact) counts as a refusal too.
{
  const resolution = {
    engine: null,
    probed: [probe({ displayPath: "this package", refused: "does not match engine.lock.json" }), probe({ label: "brush on PATH", displayPath: "brush", found: false })],
    failure: "dsh-bash-native: no usable brush engine was found. Probed:\n  - packaged engine: this package -> refused: …",
  };
  assert.throws(() => engineOrThrow(resolution), /no usable brush engine/);
  pass("a candidate refused before probing also fails");
}

// 4. A resolved engine is returned, and its absence from the probe list does not matter.
{
  const resolution = {
    engine: { path: "C:\\cache\\brush.exe", label: "packaged engine", version: "brush 0.4.0", args: ["-c"], interactiveArgs: [] },
    probed: [probe({ found: true })],
    failure: null,
  };
  assert.equal(engineOrThrow(resolution), "C:\\cache\\brush.exe");
  pass("a resolved engine is returned as its path");
}

// 5. The message carries the resolver's own failure text, so the reason reaches the reporter.
{
  const resolution = { engine: null, probed: [probe({ found: true, refused: "the file is not executable" })], failure: null };
  assert.throws(() => engineOrThrow(resolution), /every engine candidate was refused/);
  pass("a missing failure text still produces a usable message");
}

// 6. A configured engine path that does not exist is still a skip, so a stale variable is harmless.
{
  const previous = process.env.DSH_BASH_NATIVE_ENGINE;
  process.env.DSH_BASH_NATIVE_ENGINE = join(tmpdir(), "dsh-bash-native-absent", String(process.pid), "brush.exe");
  try {
    assert.equal(findEngine(), null);
    pass("a configured engine path that does not exist skips");
  } finally {
    restore(previous);
  }
}

// 7. A configured engine path that exists is verified, so a suite never scores a build the plugin refuses.
{
  const directory = mkdtempSync(join(tmpdir(), "dsh-bash-native-fake-engine-"));
  const fake = join(directory, "brush.exe");
  writeFileSync(fake, "this is not an executable\n");
  const previous = process.env.DSH_BASH_NATIVE_ENGINE;
  process.env.DSH_BASH_NATIVE_ENGINE = fake;
  try {
    assert.throws(() => findEngine(), /which this contract cannot use/);
    pass("a configured engine path that exists is verified instead of trusted");
  } finally {
    restore(previous);
    rmSync(directory, { recursive: true, force: true });
  }
}

// 8. The PATH a run sees excludes every directory this plugin materializes for itself, so "engine alone"
// cannot silently become "engine with the packaged toolchain" on a machine whose session already resolved
// the plugin (measured: the farm on the inherited PATH turned a skipped case into a new known-gap). The shim
// directory belongs to that set too and for a second reason: it is named after *one* engine build, so
// inheriting another session's would answer a bundled name — `rm`, say — with a different engine.
{
  const farm = "C:\\Users\\u\\AppData\\Local\\dsh-bash-native\\toolchain\\a19a5d8c\\bin";
  const legacy = "C:\\Users\\u\\AppData\\Local\\dsh-bash-native\\tools\\bin";
  const shim = "C:\\Users\\u\\AppData\\Local\\dsh-bash-native\\shim\\8f08f77f";
  const host = ["C:\\Windows\\system32", "C:\\Program Files\\nodejs"].join(";");
  const basePath = [farm, shim, legacy, ...host.split(";")].join(";");

  const engineOnly = pathWithToolchain({ withTools: false, toolsDir: legacy, basePath });
  assert.equal(engineOnly.includes(farm), false, "the farm is dropped");
  assert.equal(engineOnly.includes(legacy), false, "the legacy per-user directory is dropped, whatever toolsDir says");
  assert.equal(engineOnly.includes(shim), false, "another build's shim directory is dropped");
  assert.equal(
    engineOnly.split(";").filter((segment) => segment.includes("dsh-bash-native")).length,
    0,
    "no plugin-managed directory survives, and the harness composes the ones that belong on the PATH",
  );
  assert.equal(engineOnly, host, "what is left is the host PATH, untouched");

  const withTools = pathWithToolchain({ withTools: true, toolsDir: "D:\\built\\bin", basePath });
  assert.equal(withTools.startsWith(`D:\\built\\bin${";"}`), true, "the requested toolchain leads");
  assert.equal(withTools.includes(farm), false, "and the farm still cannot leak in behind it");
  pass("engine-only PATH drops every directory the plugin materializes, the shim included");
}

console.log(`\n${passed} 项通过`);
