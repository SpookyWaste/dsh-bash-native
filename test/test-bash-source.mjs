// `BASH_SOURCE` is the array a sourced file reads to learn where it came from. At the top level of a
// script it must keep every script frame — the sourced file at [0] and the script that sourced it at [1] —
// not just the innermost one.
//
// The corpus runner drives the engine with `-c`, where bash has no outer script frame to report, so this
// test spawns the engine with a script path instead. Skipped unless an engine is available.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectRunner, findEngine } from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const engine = findEngine();
if (engine === null) {
  console.log(
    "SKIP  test-bash-source.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE to a bash-compatible engine path, or put brush on PATH)",
  );
  process.exit(0);
}
console.log(`engine: ${engine}`);

const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-source-"));
const run = createDirectRunner(FIXTURE);

try {
  writeFileSync(join(FIXTURE, "outer.sh"), "source ./inner.sh\n");
  writeFileSync(
    join(FIXTURE, "inner.sh"),
    'printf \'%s|%s\\n\' "${BASH_SOURCE[0]}" "${BASH_SOURCE[1]}"\n',
  );

  const result = run(engine, ["outer.sh"], { cwd: FIXTURE });
  assert.equal(result.status, 0, `outer.sh failed: ${result.stderr.trim()}`);
  assert.deepEqual(
    result.stdout.trim().split(/\r?\n/),
    ["./inner.sh|outer.sh"],
    "BASH_SOURCE keeps the sourced file and the outer script",
  );
  pass("BASH_SOURCE keeps the outer script frame");
} finally {
  rmSync(FIXTURE, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过`);