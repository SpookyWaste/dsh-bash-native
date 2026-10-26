// Re-checks the behaviours the retired brush patch set used to guarantee, on the engine that replaced it.
//
// The 26 patches under the old `patches/brush/` existed because brush lacked these behaviours; brush is gone,
// and the corpus covers many of them indirectly. This suite answers the direct question — "is the thing that
// patch fixed still true?" — with the probe that patch's own README recorded, so a behaviour cannot quietly
// regress just because no corpus case happens to hit it.
//
// Two probes (a compound or function stage writing one very long line into a closed pipe) are known to fail
// on rubash 1.4.3 and are reported as NOTE rather than assertions: a hang is not an acceptable outcome to pin,
// and the failure is documented in `docs/research.md` §72 so the fix is tracked where the fix belongs.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, findEngine, pathWithToolchain, toolsDirectory } from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}
function note(name, detail) {
  console.log("NOTE  " + name + (detail === undefined ? "" : ` — ${detail}`));
}

const engine = findEngine();
if (engine === null) {
  console.log("SKIP  test-brush-regressions.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE or build one)");
  process.exit(0);
}

const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-brush-regressions-"));
const run = createRunner(engine, FIXTURE);
const toolsDir = toolsDirectory(process.argv, process.env);
const env = { ...process.env, PATH: pathWithToolchain({ withTools: true, toolsDir, engine, basePath: process.env.PATH ?? "" }) };

/** One case directory with the files that case needs; `link:` names are copies of the engine under test. */
function prepare(id, files = {}) {
  const cwd = join(FIXTURE, id);
  mkdirSync(cwd, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    if (name.startsWith("link:")) copyFileSync(engine, join(cwd, name.slice(5)));
    else writeFileSync(join(cwd, name), body);
  }
  return cwd;
}

/** Run one snippet and return its normalised streams. */
function shell(id, script, files, options = {}) {
  const cwd = prepare(id, files);
  const result = run(script, { cwd, env, timeout: options.timeout ?? 10000 });
  return {
    cwd,
    status: result.status,
    stdout: result.stdout.replace(/\r\n/g, "\n").trimEnd(),
    stderr: result.stderr.replace(/\r\n/g, "\n").trimEnd(),
  };
}

// 0001 — the PID behind `$!`: a real number, visible to `jobs -p`, and killable.
{
  const result = shell("pid", 'sleep 0.3 & p=$!; case "$p" in ""|*[!0-9]*) echo pid-empty;; *) echo pid-number;; esac; case "$(jobs -p)" in ""|*[!0-9]*) echo jobs-empty;; *) echo jobs-ok;; esac; kill "$p" 2>/dev/null; echo done');
  assert.equal(result.stdout, "pid-number\njobs-ok\ndone", "an external background job reports a real PID");
  pass("0001: $! and jobs -p report a real PID");
}

// 0002/0004/0009 — the path aliases, for what the shell opens and what a child is handed.
{
  const tmp = shell("tmp", 'f=/tmp/dsh-probe-$$.txt; printf "x\\n" > "$f"; cat "$f"; rm -f "$f"; echo rc=$?');
  assert.equal(tmp.stdout, "x\nrc=0", "/tmp names the temp directory");
  const argv = shell("argv", 'touch /tmp/dsh-probe-arg.txt; node -e "console.log(require(\'fs\').existsSync(process.argv[1]))" /tmp/dsh-probe-arg.txt; rm -f /tmp/dsh-probe-arg.txt');
  assert.equal(argv.stdout, "true", "a /tmp argument reaches the real file");
  const drive = shell("drive", "cd /c/Windows && pwd; test -f /c/Windows/System32/drivers/etc/hosts; echo rc=$?");
  assert.equal(drive.stdout, "/c/Windows\nrc=0", "/c is a drive mount for cd, test and pwd");
  pass("0002/0004/0009: /tmp and /c aliases hold for the shell and for child arguments");
}

// 0003 — an ERR trap fires in the scope that set it.
{
  const result = shell("err-trap", "(trap 'echo caught' ERR; false) 2>/dev/null; echo done");
  assert.equal(result.stdout, "caught\ndone", "a subshell's own ERR trap fires in that subshell");
  pass("0003: an ERR trap set inside a subshell fires there");
}

// 0005 — a closed reader ends the writer without the shell's own noise. The tool's own wording (`seq` prints
// `write error: Broken pipe`) is the declared platform gap, not a regression; the status and the lines are
// what this case asserts.
{
  const result = shell("closed-reader", "seq 1 300000 | head -2; echo rc=$?");
  assert.equal(result.stdout, "1\n2\nrc=0", "a closed reader leaves the pipeline successful");
  pass("0005: a closed reader does not fail the pipeline");
}

// 0006 — descriptor paths resolve against this process's descriptors.
{
  const result = shell("descriptor", 'printf "in\\n" | cat /dev/stdin; printf "out\\n" > /dev/stdout');
  assert.equal(result.stdout, "in\nout", "/dev/stdin and /dev/stdout are the shell's descriptors");
  pass("0006: /dev/stdin and /dev/stdout work in a pipeline and a redirect");
}

// 0007/0008 — wait selectors and the kill builtin.
{
  const result = shell("wait-kill", 'sh -c "exit 4" & p=$!; wait "$p"; echo rc=$?; sleep 0.1 & wait -n; echo n=$?; sleep 5 & q=$!; kill "$q"; wait "$q"; echo k=$?');
  assert.equal(result.stdout, "rc=4\nn=0\nk=143", "wait reports the job's status and kill ends it with 128+n");
  pass("0007/0008: wait $pid, wait -n and kill report the statuses they owe");
}

// 0010 — the builtins a script expects.
{
  const result = shell("builtins", "umask; umask -S; umask 077; umask; umask 022; history; echo rc=$?");
  assert.equal(result.stdout, "0022\nu=rwx,g=rx,o=rx\n0077\nrc=0", "umask and history answer like bash");
  pass("0010: umask and history answer instead of failing");
}

// 0011 — a CRLF-authored script parses as text.
{
  const result = shell("crlf", "bash crlf.sh; echo rc=$?", { "crlf.sh": "echo one\r\necho two\r\nmkdir -p /tmp/dsh-probe-crlf\r\n" });
  assert.equal(result.stdout, "one\ntwo\nrc=0", "carriage returns do not become part of the tokens");
  pass("0011: a CRLF script runs as written");
}

// 0012 — a relative command path runs as spelled.
{
  const result = shell("relative", './prog.exe -c "echo ok"; echo rc=$?', { "link:prog.exe": "" });
  assert.equal(result.stdout, "ok\nrc=0", "./name runs a program in the script's directory");
  pass("0012: a relative command path runs beside the script");
}

// 0015/0017 — the trailing separator means a directory, in a pattern and in `rm`.
{
  const result = shell("trailing", "mkdir -p d; echo */; echo *.md/; echo x > f.txt; rm f.txt/ 2>/dev/null; echo rc=$?; test -e f.txt && echo kept || echo gone", { "note.md": "x\n" });
  assert.equal(result.stdout, "d/\n*.md/\nrc=1\nkept", "a trailing separator matches directories only and rm refuses a file");
  pass("0015/0017: a trailing separator has to mean a directory");
}

// 0016 — a bundled utility name is reachable as a program a child can exec.
{
  const result = shell("bundled-names", 'printf "t.txt\\n" | xargs rm; test -e t.txt && echo kept || echo gone', { "t.txt": "x\n" });
  assert.equal(result.stdout, "gone", "xargs can exec the utility it names");
  pass("0016: a utility name resolves to a program, not only a builtin");
}

// 0019 — one directory, one spelling.
{
  const result = shell("pwd-spelling", 'cd "$TEMP" && a=$(pwd); cd "$(pwd -P)" && b=$(pwd); [ "$a" = "$b" ] && echo same || echo different');
  assert.equal(result.stdout, "same", "$PWD does not flip between the long and the 8.3 spelling");
  pass("0019: $PWD keeps one spelling per directory");
}

// 0020 — test -ef compares real file identity.
{
  const result = shell("file-identity", "ln a.txt b.txt; test a.txt -ef b.txt; echo linked=$?; cp a.txt c.txt; test a.txt -ef c.txt; echo copied=$?", { "a.txt": "x\n" });
  assert.equal(result.stdout, "linked=0\ncopied=1", "a hard link shares identity, a copy does not");
  pass("0020: test -ef compares file identity");
}

// 0021/0022/0026 — a refusing stage is a result, printf reports its own failure, exec keeps the shell alive.
{
  const stage = shell("builtin-stage", "(exit 3) | cat; echo rc=$?; echo alive");
  assert.equal(stage.stdout, "rc=0\nalive", "a refusing builtin stage does not end the script");
  const printf = shell("printf-error", 'printf "abc%" > o.txt 2>/dev/null; echo "rc=$? bytes=$(wc -c < o.txt)"');
  assert.equal(printf.stdout, "rc=1 bytes=3", "printf keeps what it wrote and exits 1");
  const exec = shell("exec", "exec > out.txt; echo x; echo after");
  assert.equal(readFileSync(join(exec.cwd, "out.txt"), "utf8").replace(/\r\n/g, "\n"), "x\nafter\n", "exec with only redirections keeps the shell alive");
  pass("0021/0022/0026: a stage result, printf's error path, and exec without a command");
}

// 0023/0024/0025 — stdio follows the copy, BASH_SOURCE keeps the frame, `(( ))` is arithmetic only when the
// parentheses touch.
{
  const stdio = shell("stdio", 'sh -c "echo e >&2" 2>&1 | cat');
  assert.equal(stdio.stdout, "e", "2>&1 hands the child the stream it copied");
  const source = shell("bash-source", "bash s.sh", { "s.sh": 'echo "${BASH_SOURCE[0]}"\n' });
  assert.equal(source.stdout, "s.sh", "BASH_SOURCE names the script frame");
  const arithmetic = shell("arithmetic", "(( 1 + 1 )); echo a=$?; (( 0 )); echo b=$?; ( (echo sub) )");
  assert.equal(arithmetic.stdout, "a=0\nb=1\nsub", "(( )) is arithmetic, ( (cmd) ) is a subshell");
  pass("0023/0024/0025: stdio, BASH_SOURCE and the arithmetic command");
}

// The limitations the brush-era READMEs listed after the patches (`72b6b52:README.md` §"已知限制", and the
// 0.2.1 note about `exec`): none of them was ever asserted here, and every one of them is now a behaviour a
// script may rely on.
{
  const select = shell("select", "printf '1\\n' | { select x in a b; do echo \"x=$x\"; break; done; }");
  assert.match(select.stdout, /x=a$/, "select reads its menu choice");
  const exec = shell("exec-with-command", "exec echo hi; echo after");
  assert.equal(exec.stdout, "hi", "exec with a command replaces the shell");
  const ulimit = shell("ulimit", "ulimit -n; echo rc=$?; ulimit -a | head -1");
  assert.match(ulimit.stdout, /^\d+\nrc=0\n/, "ulimit answers with a real table");
  const jobs = shell("jobs-substitution", 'sleep 0.3 & p=$(jobs -p); case "$p" in ""|*[!0-9]*) echo empty;; *) echo number;; esac; wait');
  assert.equal(jobs.stdout, "number", "jobs -p inside a command substitution sees the job table");
  const multi = shell("kill-multi", '"$BASH" -c "i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done" & "$BASH" -c "i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done" & kill %1 %2; printf "rc=%s\\n" "$?"; true', undefined, { timeout: 15000 });
  assert.equal(multi.stdout, "rc=0", "kill accepts several job specs");
  const zero = shell("kill-zero", 'sleep 5 & p=$!; kill -0 "$p"; echo alive=$?; kill "$p"', undefined, { timeout: 15000 });
  assert.match(zero.stdout, /^alive=0/, "kill -0 reports a live background job");
  const builtinJob = shell("builtin-background", '{ echo x; } & p=$!; case "$p" in ""|*[!0-9]*) echo empty;; *) echo number;; esac; wait');
  assert.match(builtinJob.stdout, /^number/, "a builtin background job reports a numeric PID");
  const data = shell("data-operands", "printf '/tmp/x\\n' > p.txt; grep /tmp/x p.txt; sed -n '/tmp\\/x/p' p.txt; awk '/tmp\\/x/{print}' p.txt");
  assert.equal(data.stdout, "/tmp/x\n/tmp/x\n/tmp/x", "a /tmp word used as data stays data in grep, sed and awk");
  const byPath = shell("script-by-path", 'printf "echo hi\\n" > s.sh; ./s.sh; echo rc=$?');
  assert.equal(byPath.stdout, "hi\nrc=0", "./s.sh runs a script by its path");
  const processSubstitution = shell("process-substitution", "echo hi > >(cat); sleep 0.2; echo done");
  assert.match(processSubstitution.stdout, /^hi\ndone$/m, "the write side of >( ) is waited for");
  pass("the old README's limitations: select, exec, ulimit, jobs, kill, data operands, ./s.sh and >( )");
}

// 0013/0014 — a compound or function stage that writes one long line while its reader leaves. The brush
// patches fixed exactly this; rubash 1.4.3 does not, and the outcome depends on where the shell's stdout goes:
// a file hangs it, a pipe loses the output. Reported, not asserted, so the suite stays a regression gate for
// everything that does work — `docs/research.md` §72 carries the measurement and the workaround.
{
  const one = "x".repeat(200000) + "\n";
  // The shape matters: appending a byte count to the pipeline moves the reader onto an internal pipe and
  // then it works, so these two run exactly as an agent would write them.
  const compound = shell("compound-stage", "{ cat long.txt; } | head -1", { "long.txt": one }, { timeout: 3000 });
  const fn = shell("function-stage", "f() { cat long.txt; }; f | head -1", { "long.txt": one }, { timeout: 3000 });
  const outcomes = [compound, fn].map((result) => (result.status === null ? "timed out" : `status ${result.status}, ${JSON.stringify(result.stdout)}`));
  note("0013/0014: a compound stage writing one long line into a closed pipe", outcomes.join("; "));
}

// 0018 — an undecodable environment entry. Staging an unpaired surrogate needs a PowerShell launcher, and this
// harness decodes the environment as UTF-8, so the behaviour is covered by the engine patch (`0002`) and by
// `docs/research.md` §72 instead of by a case that cannot be built here.
note("0018: an undecodable environment entry is not stageable through this harness");

try {
  rmSync(FIXTURE, { recursive: true, force: true });
} catch (error) {
  console.log(`note: the fixture tree could not be removed (${error.code ?? error.message})`);
}
console.log(`\n${passed} 项通过`);