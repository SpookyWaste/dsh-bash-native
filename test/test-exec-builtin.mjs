// `exec` is a special builtin on both platforms, but only its command form needs a process image
// replacement. Windows has no such operation, so the no-argument form — which only applies the command's
// redirections to the calling shell — is what this engine can honor, and the command form must say so
// instead of running the command and returning (which would let the commands after `exec` run).
//
// Skipped unless an engine is available: `DSH_BASH_NATIVE_ENGINE`, or a `brush` on PATH.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, findEngine } from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const engine = findEngine();
if (engine === null) {
  console.log(
    "SKIP  test-exec-builtin.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE to a bash-compatible engine path, or put brush on PATH)",
  );
  process.exit(0);
}
console.log(`engine: ${engine}`);

const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-exec-"));
const run = createRunner(engine, FIXTURE);

try {
  {
    const result = run("type -t exec", { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "builtin", "exec is registered as a builtin");
    pass("exec is a builtin");
  }

  {
    const result = run("exec; echo after", { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "after", "exec with no arguments does nothing and returns");
    pass("exec with no arguments is a no-op");
  }

  {
    const result = run("exec 3>&1; echo hi >&3", { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "hi", "exec applies a descriptor duplication to the shell");
    pass("exec applies a descriptor duplication to the shell");
  }

  {
    const result = run("exec 3>&1; exec > exec-out.txt; echo hi; exec 1>&3; cat exec-out.txt", { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "hi", "exec redirects the shell's own output, and a later exec restores it");
    pass("exec redirects the shell's own output");
  }

  {
    const result = run("( exec true ); echo subshell-ok", { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "subshell-ok", "exec in a subshell runs through the command builtin and returns");
    pass("exec in a subshell delegates to the command builtin");
  }

  {
    // rubash replaces the shell instead of refusing: the command's status is the process's, and nothing
    // after the `exec` word runs in this shell.
    const replaced = run('exec node -e "0"; echo after', { cwd: FIXTURE });
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.doesNotMatch(replaced.stdout, /after/, "the shell is gone after a successful exec");
    const status = run('exec node -e "process.exit(7)"; echo after', { cwd: FIXTURE });
    assert.equal(status.status, 7, "the executed command's status is the shell's own");
    pass("exec with a command replaces the shell and keeps its status");
  }
} finally {
  rmSync(FIXTURE, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过`);