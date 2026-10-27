// Scores the `RUBASH_FILE_COMMANDS_FROM_PATH` contract on the real engine.
//
// That variable is how this plugin sends `sed` and `rmdir` to its toolchain's programs instead of the
// engine's in-process copies, and it is read from the shell's own variables so a startup file can state it
// — a persistent PTY session inherits the host environment and never sees the executor's spawn environment.
// The toolchain half of these cases skips on a machine with no toolchain; the half that needs nothing but
// the engine proves the switch itself, because `chmod` has no toolchain program on Windows at all.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, findEngine, pathWithToolchain, toolsDirectory } from "../scripts/engine-harness.mjs";
import { probeToolchain } from "../lib/toolchain.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}
function skip(name) {
  console.log("SKIP  " + name);
}

const engine = findEngine();
if (engine === null) {
  console.log("SKIP  test-file-commands.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE or build one)");
  process.exit(0);
}

const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-file-commands-"));
const run = createRunner(engine, FIXTURE);
// The ambient value belongs to whatever shell started this run, not to these cases.
const baseEnv = { ...process.env };
delete baseEnv.RUBASH_FILE_COMMANDS_FROM_PATH;
const withPolicy = (value) => ({ ...baseEnv, RUBASH_FILE_COMMANDS_FROM_PATH: value });
// `all` has to reach a PATH that cannot answer the name, and a CI runner carries Git's `usr/bin`, where a real
// `chmod.exe` lives. The Windows directory holds no such program, so the case states the switch, not the host.
const bareEnv = {
  ...baseEnv,
  PATH: process.env.SystemRoot === undefined ? "" : join(process.env.SystemRoot, "System32"),
};
const withBarePolicy = (value) => ({ ...bareEnv, RUBASH_FILE_COMMANDS_FROM_PATH: value });

/** One scratch directory and one executable fixture file inside it. */
function scratch(name) {
  const directory = join(FIXTURE, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "f.sh"), "echo hi\n");
  return directory;
}

// 1. The value table: `all` leaves even a command with no PATH program to the external path (which fails
// here, and is the one observation that needs no toolchain), while unset and `none` keep the copy.
{
  const cwd = scratch("table");
  const all = run("chmod +x f.sh; echo rc=$?", { cwd, env: withBarePolicy("all") });
  assert.match(all.stdout, /rc=127/, "`all` runs the command from PATH, where chmod does not exist on Windows");
  assert.match(all.stderr, /chmod/, "the failure names the command");
  for (const [label, env] of [["unset", baseEnv], ["none", withPolicy("none")], ["0", withPolicy("0")]]) {
    const kept = run("chmod +x f.sh; echo rc=$?", { cwd, env });
    assert.match(kept.stdout, /rc=0/, `${label} keeps the engine's in-process copy`);
  }
  for (const value of ["on", "1"]) {
    const program = run("chmod +x f.sh; echo rc=$?", { cwd, env: withBarePolicy(value) });
    assert.match(program.stdout, /rc=127/, `${value} means every file command runs from PATH`);
  }
  pass("`all`/`on`/`1` send a file command to PATH while unset, `none` and `0` keep the in-process copy");
}

// 2. The shell's own variable table carries the policy, which is the only route a PTY startup file has.
{
  const cwd = scratch("shell-variable");
  const assignment = run("RUBASH_FILE_COMMANDS_FROM_PATH=all; chmod +x f.sh; echo rc=$?", { cwd, env: baseEnv });
  assert.match(assignment.stdout, /rc=127/, "a shell variable, not just an exported one, states the policy");
  pass("the policy is read from the shell's variables, so a startup file can state it");
}

// 3. The toolchain half: a named command runs the toolchain's program, which is what fixes the two measured
// disagreements with GNU.
{
  const toolsDir = toolsDirectory(process.argv, process.env);
  const listed = (path) => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch {
      return null;
    }
  };
  const isFile = (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  const probe = probeToolchain(toolsDir, process.platform, { isFile, listDirectory: listed });
  const available = new Set([...probe.provided, ...probe.additional]);
  const toolEnv = {
    ...baseEnv,
    PATH: pathWithToolchain({ withTools: true, toolsDir, engine, basePath: process.env.PATH ?? "" }),
  };

  if (available.has("sed")) {
    const cwd = scratch("sed");
    const program = run("printf 'foo x\\n' | sed 's/\\bfoo\\b/bar/'", { cwd, env: { ...toolEnv, RUBASH_FILE_COMMANDS_FROM_PATH: "sed" } });
    assert.equal(program.stdout.trim(), "bar x", "the toolchain's sed implements the word boundary");
    const copy = run("printf 'foo x\\n' | sed 's/\\bfoo\\b/bar/'", { cwd, env: toolEnv });
    assert.equal(copy.stdout.trim(), "foo x", "the in-process copy still does not, which is the gap the policy closes");
    pass("`sed` runs the toolchain's program, and the in-process copy keeps its narrower matcher");
  } else {
    skip("sed: the toolchain directory does not publish it");
  }

  if (available.has("rmdir")) {
    const cwd = join(FIXTURE, "rmdir");
    mkdirSync(join(cwd, "d"), { recursive: true });
    const question = "rmdir d/. 2>/dev/null; echo rc=$?; test -d d && echo kept || echo gone";
    const program = run(question, { cwd, env: { ...toolEnv, RUBASH_FILE_COMMANDS_FROM_PATH: "rmdir" } });
    assert.match(program.stdout, /rc=1[\s\S]*kept/, "the toolchain's rmdir refuses a final dot and keeps the directory");
    const copy = run(question, { cwd, env: toolEnv });
    assert.match(copy.stdout, /rc=0[\s\S]*gone/, "the in-process copy removes the parent and reports success");
    pass("`rmdir` runs the toolchain's program, and the in-process copy keeps its silent success");
  } else {
    skip("rmdir: the toolchain directory does not publish it");
  }

  if (available.has("cat")) {
    const cwd = scratch("cat");
    const absolute = run("echo hi > g.txt; /bin/cat g.txt", { cwd, env: { ...toolEnv, RUBASH_FILE_COMMANDS_FROM_PATH: "all" } });
    assert.equal(absolute.stdout.trim(), "hi", "an absolute /bin spelling still resolves through PATH");
    pass("an absolute /bin spelling resolves through PATH under `all`");
  } else {
    skip("cat: the toolchain directory does not publish it");
  }
}

try {
  rmSync(FIXTURE, { recursive: true, force: true });
} catch (error) {
  // A child that outlived its case can hold the tree on Windows; the assertions above are the result.
  console.log(`note: the fixture tree could not be removed (${error.code ?? error.message})`);
}
console.log(`\n${passed} 项通过`);