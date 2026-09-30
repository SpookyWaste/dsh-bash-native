// The confined-tier regression guard for engine verification.
//
// The production verifier runs at resolution time, inside the session it is checking. A process under the
// harness's restricted token cannot open a named pipe, so a verifier that asks `spawnSync` for pipes
// refuses every candidate — including the engine this package ships — and with `requireEngineOnLoad:
// true` that takes the plugin down in exactly the tiers it exists for.
//
// This test needs a real confinement runner, which only the installed harness has, and it must be started
// by an **unconfined** caller: the runner creates a restricted token, and a caller that already runs under
// one cannot nest a second — measured, `CreateRestrictedToken` fails with Win32 error 87 and the runner
// exits 127 before the child is started. Point `DSH_BASH_NATIVE_CONFINE_RUNNER` at
// `dsh-sandbox-windows-acl/lib/runner.js` and run this suite from a normal shell; without the variable it
// reports that the confined tier is not covered instead of pretending it checked anything.
//
//   $env:DSH_BASH_NATIVE_CONFINE_RUNNER = "$env:APPDATA\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-sandbox-windows-acl\lib\runner.js"
//   node test-confined-verify.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { packageRoot, preparePackagedEngine } from "../lib/artifact.js";
import { captureStdio } from "../lib/verify.js";

const runner = process.env.DSH_BASH_NATIVE_CONFINE_RUNNER ?? "";
if (runner.length === 0) {
  console.log("SKIP  no confinement runner configured: the confined tier is NOT covered by this run");
  console.log("      set DSH_BASH_NATIVE_CONFINE_RUNNER to dsh-sandbox-windows-acl/lib/runner.js and run this suite from an unconfined shell");
  process.exit(0);
}

const packaged = preparePackagedEngine({ packageRoot: packageRoot(), env: process.env });
assert.equal("ready" in packaged, true, `the shipped engine is not ready: ${packaged.refused ?? "unknown"}`);

// The workspace is this repository (so the driver may read `lib/`), and the runner's temporary root must
// live outside it. The driver prints both facts: what the production verifier decided, and whether this
// machine actually denied a piped child (the control that makes the run meaningful).
const workspace = packageRoot();
const directory = mkdtempSync(join(tmpdir(), "dsh-confined-verify-"));
const temp = join(directory, "temp");
mkdirSync(temp, { recursive: true });
const driver = join(directory, "driver.mjs");
writeFileSync(
  driver,
  [
    `import { readBrushVersion } from ${JSON.stringify(pathToFileURL(join(workspace, "lib", "verify.js")).href)};`,
    `import { spawnSync } from 'node:child_process';`,
    `const engine = ${JSON.stringify(packaged.ready)};`,
    `console.log('verdict=' + JSON.stringify(readBrushVersion(engine)));`,
    `const piped = spawnSync(process.execPath, ['-e', 'console.log(1)'], { encoding: 'utf8' });`,
    `console.log('piped=' + (piped.error === undefined ? 'allowed' : piped.error.code));`,
  ].join("\n"),
);

let output = "";
try {
  // The capture goes through files for the same reason the verifier does: the driver inherits the tier the
  // runner gives it. The runner itself is the part that needs an unconfined caller (see the header).
  const stdoutPath = join(directory, "stdout.txt");
  const stderrPath = join(directory, "stderr.txt");
  const capture = captureStdio(stdoutPath, stderrPath);
  let result;
  try {
    result = spawnSync(
      process.execPath,
      [runner, "--workspace", workspace, "--temp", temp, "--mode", "workspace-write", "--", process.execPath, driver],
      { stdio: capture.stdio, windowsHide: true, timeout: 120_000 },
    );
  } finally {
    capture.close();
  }
  assert.equal(result.error, undefined, `the runner could not be started: ${String(result.error)}`);
  output = `${readFileSync(stdoutPath, "utf8")}${readFileSync(stderrPath, "utf8")}`;
} finally {
  rmSync(directory, { recursive: true, force: true });
}

const verdict = /verdict=(\{.*\})/.exec(output)?.[1];
const piped = /piped=(\w+)/.exec(output)?.[1];
assert.notEqual(
  verdict,
  undefined,
  output.includes("CreateRestrictedToken")
    ? "the runner could not create a restricted token because this suite is itself running under one (measured: Win32 error 87, runner exit 127 before the child starts); run this suite from an unconfined shell"
    : `the confined driver printed no verdict:\n${output}`,
);
const parsed = JSON.parse(verdict);
assert.equal(parsed.refused, null, `the confined verifier refused the shipped engine: ${parsed.refused}`);
assert.match(parsed.version, /^brush\b/i);
console.log("PASS  the shipped engine verifies inside a workspace-write confinement");
if (piped === "allowed") {
  console.log("NOTE  this machine allowed a piped child, so the run did not exercise the pipe restriction");
} else {
  console.log(`PASS  a piped child was denied (${piped}), which is the condition the file capture exists for`);
}
console.log("\n2 项通过");