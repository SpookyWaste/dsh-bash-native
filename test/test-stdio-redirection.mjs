// The stdio mapping a child process gets from a redirection: `2>&1` and `>&2` must hand it the stream
// that was duplicated, not whichever descriptor it was assigned.
//
// The corpus pins the stdout-visible half of this. This test reads both streams directly, because the
// half that is wrong without the fix is the stderr side — `cmd >&2` printed to stdout, and
// `cmd 2>&1` kept its stderr — which a corpus expectation on stdout cannot distinguish from silence.
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
    "SKIP  test-stdio-redirection.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE to a bash-compatible engine path, or put brush on PATH)",
  );
  process.exit(0);
}
console.log(`engine: ${engine}`);

const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-stdio-"));
const run = createRunner(engine, FIXTURE);

try {
  {
    const result = run(`node -e "console.error('boom')" 2>&1`, { cwd: FIXTURE });
    assert.equal(result.status, 0, "an external command's 2>&1 keeps the status");
    assert.equal(result.stdout.trim(), "boom", "2>&1 sends the external command's stderr to stdout");
    assert.equal(result.stderr.trim(), "", "2>&1 leaves nothing on stderr");
    pass("an external command's 2>&1 reaches stdout");
  }

  {
    const result = run(`node -e "console.log('hi')" >&2`, { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "", ">&2 leaves stdout empty");
    assert.equal(result.stderr.trim(), "hi", ">&2 sends the external command's stdout to stderr");
    pass("an external command's >&2 reaches stderr");
  }

  {
    // Redirections apply left to right: `2>&1` copies the current stdout before `>/dev/null` replaces it.
    const result = run(`node -e "console.error('boom')" 2>&1 >/dev/null`, { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "boom", "the order of the two redirections is honored");
    assert.equal(result.stderr.trim(), "", "the duplicated descriptor is not the replaced one");
    pass("redirections are applied left to right");
  }

  {
    const result = run(`node -e "console.error('boom')" 2>&1 | cat`, { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "boom", "a pipe destination keeps behaving as it did");
    assert.equal(result.stderr.trim(), "", "the pipeline stage got the duplicated stream");
    pass("2>&1 into a pipe still reaches the next stage");
  }

  {
    const result = run(`node -e "console.error('boom')" > out.txt 2>&1; cat out.txt`, { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "boom", "a file destination keeps behaving as it did");
    pass("2>&1 into a file still reaches the file");
  }

  {
    const result = run("tail no-such-file 2>&1", { cwd: FIXTURE });
    assert.equal(result.status, 1, "a bundled utility's failure keeps its status");
    assert.match(result.stdout, /no-such-file/, "a bundled utility's stderr reaches stdout under 2>&1");
    assert.equal(result.stderr.trim(), "", "nothing is left on the bundled utility's stderr");
    pass("a bundled utility's 2>&1 reaches stdout");
  }

  {
    const result = run("seq 1 3 >&2", { cwd: FIXTURE });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "", ">&2 leaves a bundled utility's stdout empty");
    assert.deepEqual(result.stderr.trim().split(/\r?\n/), ["1", "2", "3"], "a bundled utility's stdout reaches stderr under >&2");
    pass("a bundled utility's >&2 reaches stderr");
  }
} finally {
  rmSync(FIXTURE, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过`);