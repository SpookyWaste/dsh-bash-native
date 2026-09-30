// The argv red line: a POSIX shell resolves quoting before `exec`, so a program that re-expands
// its own arguments silently corrupts data the model quoted correctly (`find . -name "*.ts"`).
//
// Every case with a `directArgv` runs twice:
//   * through the engine, which is the environment the model actually gets, and
//   * directly, with an explicit argv and no shell involved, which is the only way to tell
//     "the engine rewrote my argument" apart from "the program expanded its own argument".
// A check that only compared exit statuses would miss all of this: expanding `*.txt` into file
// names succeeds.
//
// Skipped unless an engine is available: `DSH_BASH_NATIVE_ENGINE`, or a `brush` on PATH.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDirectRunner,
  createRunner,
  findEngine,
  matchesOutput,
  normalizeOutput,
  pathWithToolchain,
  probeNeeds,
  toolsDirectory,
} from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const engine = findEngine();
if (engine === null) {
  console.log(
    "SKIP  test-argv-semantics.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE to a bash-compatible engine path, or put brush on PATH)",
  );
  process.exit(0);
}

const corpus = JSON.parse(readFileSync(new URL("../corpus/compat.json", import.meta.url), "utf8"));
const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-argv-"));
const run = createRunner(engine, FIXTURE);
const runDirect = createDirectRunner(FIXTURE);
const normalize = normalizeOutput;

// The red line is about the toolchain being in place, so it is exercised whenever one is installed;
// a machine without one skips the cases whose program is absent instead of failing them.
const toolsDir = toolsDirectory(process.argv, process.env);
const withTools = process.argv.includes("--with-tools") || process.argv.some((arg) => arg.startsWith("--tools-dir=")) || existsSync(toolsDir);
const env = { ...process.env, PATH: pathWithToolchain({ withTools, toolsDir, engine, basePath: process.env.PATH ?? "" }) };
console.log(`toolchain: ${withTools ? toolsDir : "engine-only"}`);

/** Lay out one case's working directory and resolve the external commands it depends on. */
function prepare(entry) {
  const cwd = join(FIXTURE, entry.id);
  mkdirSync(cwd, { recursive: true });
  for (const name of entry.files ?? []) writeFileSync(join(cwd, name), corpus.fixtures[name]);
  return { cwd, ...probeNeeds(run, entry.needs ?? [], { cwd, env }) };
}

const cases = corpus.cases.filter((entry) => entry.category === "argv-semantics");
assert.ok(cases.length >= 6, "the argv suite covers quoting, expansion, and external programs");

for (const entry of cases) {
  const { cwd, missing, collisions, foreign } = prepare(entry);
  const label = entry.id;
  if (collisions.length > 0) {
    // The name resolves to an unrelated Windows program, so this case cannot say anything about
    // argument handling until the toolchain shadows it.
    console.log(`SKIP  ${label}: collides with a Windows program (${collisions.join(", ")})`);
    continue;
  }
  if (foreign.length > 0) {
    // An MSYS build answers this name (a Git for Windows installation). It expands globs inside its own
    // argv, which is the behaviour this case exists to rule out for the toolchain this project ships.
    console.log(`SKIP  ${label}: a foreign implementation answers the name (${foreign.join(", ")})`);
    continue;
  }
  if (missing.length > 0) {
    // Both drivers need the program itself, so an absent tool is a skip rather than a verdict about
    // argument handling.
    console.log(`SKIP  ${label}: missing ${missing.join(", ")}`);
    continue;
  }

  const shell = run(entry.snippet, { cwd, env });
  const shellOk = matchesOutput(shell.stdout, entry.expect.stdout ?? {});
  const shellStatusOk = entry.expect.status === undefined || shell.status === entry.expect.status;

  if (entry.directArgv === undefined) {
    assert.ok(
      shellOk && shellStatusOk,
      `${entry.id}: the engine must pass the argument through verbatim, got ${JSON.stringify(shell.stdout)}`,
    );
    pass(`the engine leaves ${entry.id} intact`);
    continue;
  }

  const direct = runDirect(entry.directArgv.program, entry.directArgv.args, { cwd, env });
  const directOk = matchesOutput(direct.stdout, entry.expect.stdout ?? {});

  // Both drivers must agree with the expectation. When they disagree the message names the side at
  // fault, because that is the whole reason this suite exists.
  if (!shellOk && directOk) {
    assert.fail(
      `${entry.id}: the engine rewrote the argument; the program received it intact (shell=${JSON.stringify(shell.stdout.trim())} direct=${JSON.stringify(direct.stdout.trim())})`,
    );
  }
  if (shellOk && !directOk) {
    assert.fail(
      `${entry.id}: the engine produced the expected output but the program alone did not (shell=${JSON.stringify(shell.stdout.trim())} direct=${JSON.stringify(direct.stdout.trim())})`,
    );
  }
  if (!shellOk && !directOk) {
    assert.fail(
      `${entry.id}: the program expanded an argument it received verbatim (direct=${JSON.stringify(direct.stdout.trim())} stderr=${direct.stderr.trim().split(/\r?\n/)[0] ?? ""})`,
    );
  }
  pass(`${entry.id}: shell and direct spawn agree on the argument`);
}

// A control that must hold regardless of the toolchain: the shell itself never expands quoted text.
{
  const cwd = join(FIXTURE, "control");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "z.txt"), "z\n");
  const quoted = run("printf '%s\\n' \"*.txt\" '*.txt' \\*.txt", { cwd, env });
  assert.equal(normalize(quoted.stdout), "*.txt\n*.txt\n*.txt\n", "every quoted or escaped spelling stays literal");
  const unquoted = run("printf '%s\\n' *.txt", { cwd, env });
  assert.equal(normalize(unquoted.stdout), "z.txt\n", "an unquoted glob expands");
  pass("quoting, escaping, and expansion of glob characters follow POSIX");
}

rmSync(FIXTURE, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);
