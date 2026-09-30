// Runs the toolchain's programs for real, because "installed" is not "works": `stdbuf` passed an
// existence check and then failed with "External libstdbuf not found" the first time it was invoked.
//
// Two checks, in the order a break would show up: the advertised programs answer their own invocation, and
// every installed name starts at all. The two that used to follow — that a name the engine bundles also had
// a program form here, and that both layers reported one version — described the farm's second copy of the
// engine's utilities; patch `0016` and the shim directory replaced that copy, and those gates now live in
// `test-package.mjs` and in the corpus's `xargs-rm` case.
//
// Skipped unless an engine and a toolchain are installed, so a machine without either still runs the suite.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTABLE_ADDITIONS, TOOLCHAIN_COMMANDS } from "../lib/toolchain.js";
import { createRunner, findEngine, pathWithToolchain, toolsDirectory } from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

/** One invocation per advertised program: enough to make it start and do the thing it exists for. */
const INVOCATIONS = {
  grep: "printf 'a\\n' | grep -c a",
  sed: "printf 'a\\n' | sed s/a/b/",
  awk: "printf '1 2\\n' | awk '{print $2}'",
  jq: "printf '{\"k\":1}' | jq .k",
  find: "find . -maxdepth 1 -name '*.exe' | wc -l",
  // `echo` rather than a bundled utility: this suite composes the farm's directory only, and the engine's
  // own utilities reach a child process through the shim directory instead (the corpus's `xargs-rm` case and
  // `test-package.mjs` are the gates for that path).
  xargs: "printf 'a\\nb\\n' | xargs -n1 echo",
  diff: "printf 'a\\n' > one.txt; printf 'b\\n' > two.txt; diff one.txt two.txt; echo rc=$?",
  cmp: "printf 'a\\n' > one.txt; printf 'a\\n' > two.txt; cmp one.txt two.txt; echo rc=$?",
  which: "which grep",
  timeout: "timeout 5 which grep",
  stat: "printf x > one.txt; stat -c %s one.txt",
  ps: "ps -e | head -1",
  tty: "tty -s; echo rc=$?",
  nohup: "nohup which grep",
  nice: "nice which grep",
  uptime: "uptime | wc -l",
  hostid: "hostid | wc -l",
  pathchk: "pathchk .; echo rc=$?",
  locate: "locate --version 2>&1 | head -1",
  updatedb: "updatedb --help 2>&1 | head -1",
};

/** A program that cannot start says one of these; anything else is the program's own answer. */
const STARTUP_FAILURE = /not recognized|cannot find the (file|path)|libstdbuf|os error 126|os error 193/i;

const dir = toolsDirectory([], process.env);
const engine = dir.length > 0 && existsSync(dir) ? findEngine() : null;
if (dir.length === 0 || !existsSync(dir) || engine === null) {
  console.log("SKIP  no toolchain and engine installed to run the toolchain's programs");
} else {
  // Through files, not pipes: a confined tier denies a piped spawnSync before the child starts.
  const scratch = mkdtempSync(join(tmpdir(), "dsh-bash-native-programs-"));
  const run = createRunner(engine, scratch);
  const env = { ...process.env, PATH: pathWithToolchain({ withTools: true, toolsDir: dir, engine, basePath: process.env.PATH ?? "" }) };

  // 1. Every advertised program answers the invocation the contract's readers would write.
  const broken = [];
  for (const name of [...TOOLCHAIN_COMMANDS, ...NOTABLE_ADDITIONS]) {
    const invocation = INVOCATIONS[name];
    assert.ok(invocation !== undefined, `${name} is advertised but has no invocation in this suite`);
    const result = run(invocation, { cwd: scratch, env });
    const output = `${result.stdout}${result.stderr}`;
    if (STARTUP_FAILURE.test(output) || result.status === 127) {
      broken.push(`${name}: rc=${result.status} ${output.trim().split(/\r?\n/)[0] ?? ""}`);
    }
  }
  assert.deepEqual(broken, [], `advertised programs that cannot run:\n  ${broken.join("\n  ")}`);
  pass(`all ${TOOLCHAIN_COMMANDS.length + NOTABLE_ADDITIONS.length} advertised programs answer their own invocation`);

  // 2. Every installed name starts. `--help` rather than a bare call, because a bare `cat` would wait on
  // stdin; the point is only that the executable loads and dispatches.
  const unrunnable = [];
  const names = readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith(".exe"))
    .map((entry) => entry.replace(/\.exe$/i, ""));
  for (const name of names) {
    const result = run(`${name} --help >/dev/null 2>&1; echo rc=$?`, { cwd: scratch, env });
    if (STARTUP_FAILURE.test(`${result.stdout}${result.stderr}`)) unrunnable.push(name);
  }
  assert.deepEqual(unrunnable, [], `installed names that cannot start: ${unrunnable.join(" ")}`);
  pass(`all ${names.length} installed names start`);

  // The program forms of the utilities the engine bundles are no longer this farm's business: the plugin's
  // shim directory publishes those names as hard links to the engine (patch `0016`), so `xargs rm` and
  // `find -exec rm` reach the same implementation the prompt does. `test-package.mjs` gates that the shim name
  // *is* the engine and that a child process's `rm` refuses a refused operand, and the corpus's
  // `xargs-rm-refuses-trailing-slash-on-a-file` case gates the same thing end to end. The version comparison
  // that used to sit here went with the second copy: one implementation cannot drift from itself.
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过`);