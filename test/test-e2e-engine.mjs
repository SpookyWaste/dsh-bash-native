// Verifies the two sentences of this plugin's prompt section, and the documented limits they point at,
// against a real engine. The other measured deviations that section used to list are pinned by the corpus
// and the manual, where they are also stated; duplicating them here would be a second owner.
//
// Skipped unless an engine is available: `DSH_BASH_NATIVE_ENGINE`, or a `brush` on PATH.
import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectRunner, createRunner, findEngine } from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const engine = findEngine();
if (engine === null) {
  console.log(
    "SKIP  test-e2e-engine.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE to a bash-compatible engine path, or put brush on PATH)",
  );
  process.exit(0);
}
console.log(`engine: ${engine}`);

const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-engine-"));
const run = createRunner(engine, FIXTURE);

/**
 * The short (8.3) and long spellings of one existing directory.
 *
 * Windows' own `Scripting.FileSystemObject` is the thing that will name the short form, and PowerShell
 * resolving the same path is the long one, so both come from outside the engine under test. Returns
 * `{ ok: false, reason }` when PowerShell could not be run — a confined session fails it the same way it
 * fails any spawn.
 */
function windowsSpellings(directory) {
  const direct = createDirectRunner(FIXTURE);
  const literal = directory.replace(/'/g, "''");
  const script = [
    `$f = (New-Object -ComObject Scripting.FileSystemObject).GetFolder('${literal}')`,
    'Write-Output "short=$($f.ShortPath)"',
    `Write-Output "long=$((Get-Item -LiteralPath '${literal}').FullName)"`,
  ].join("; ");
  let result;
  try {
    result = direct("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
  if (result.status !== 0) return { ok: false, reason: result.stderr.trim().split(/\r?\n/)[0] ?? "no stderr" };
  const read = (label) => result.stdout.split(/\r?\n/).find((line) => line.startsWith(`${label}=`))?.slice(label.length + 1).trim();
  const short = read("short");
  const long = read("long");
  if (short === undefined || long === undefined || short.length === 0 || long.length === 0) {
    return { ok: false, reason: `PowerShell answered ${JSON.stringify(result.stdout.trim())}` };
  }
  return { ok: true, short, long };
}

// 1. The first contract sentence claims a bash-compatible shell, so the engine has to answer a bash
// version and behave like one at the syntax level.
{
  const result = run("echo $BASH_VERSION");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^5\./, "the engine reports a bash 5.x compatibility level");
  pass("the engine reports a bash 5.x compatibility level");
}

// 2. POSIX pipelines, builtins, and subshells behave as bash does.
{
  const pipeline = run("printf 'b\\na\\nb\\n' | sort | uniq -c");
  assert.equal(pipeline.status, 0, pipeline.stderr);
  assert.match(pipeline.stdout, /2 b/);
  assert.match(pipeline.stdout, /1 a/);
  const mixed = run('x=$(echo hi); echo "sub=$x"; false; echo "rc=$?"');
  assert.equal(mixed.status, 0, "the script itself ends successfully");
  assert.match(mixed.stdout, /sub=hi/);
  assert.match(mixed.stdout, /rc=1/);
  pass("pipelines, builtins, subshells, and exit codes behave as bash does");
}

// 3. Heredocs work, and `/dev/null` is a working write sink.
{
  const heredoc = run("cat <<EOF\nline1\nline2\nEOF");
  assert.equal(heredoc.status, 0, heredoc.stderr);
  assert.match(heredoc.stdout, /line1\nline2/);
  const devNull = run("echo hi > /dev/null; echo rc=$?");
  assert.equal(devNull.status, 0, devNull.stderr);
  assert.match(devNull.stdout, /rc=0/);
  pass("heredocs work and /dev/null accepts a redirect");
}

// 4. The engine writes and removes a scratch file under a directory this test controls.
//
// The directory is created inside the repository on purpose: a DSH workspace that carries the
// sandbox's standing Low integrity label makes every image inside it run at Low integrity, and
// Windows then denies that process every write to a Medium object such as `%TEMP%`. The engine's
// writable scope is therefore an environment fact, not an engine capability, so `$TEMP` is
// reported below instead of asserted.
{
  const scratch = mkdtempSync(join(process.cwd(), "engine-scratch-"));
  const target = join(scratch, "scratch.txt").replace(/\\/g, "/");
  const result = run(`echo scratch > "${target}" && cat "${target}" && rm -f "${target}" && echo cleaned`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scratch/);
  assert.match(result.stdout, /cleaned/);
  rmSync(scratch, { recursive: true, force: true });
  const temp = run('f="$TEMP/dsh-bash-native-e2e-$$.txt"; echo t > "$f" && rm -f "$f" && echo temp_ok');
  console.log(
    temp.status === 0 && /temp_ok/.test(temp.stdout)
      ? "INFO  $TEMP is writable for this engine"
      : `INFO  $TEMP is not writable for this engine (${temp.stderr.trim().split(/\r?\n/)[0] ?? "no stderr"}); the engine's writable scope is the workspace`,
  );
  pass("the engine writes and removes a scratch file in a directory the test controls");
}

// 5. The contract's second sentence, against the real engine: `$VAR` names are what expand (`%VAR%` is
// literal text), and both Windows path spellings it recommends reach a program unchanged.
{
  const variables = run('printf "TMP=%s\\n" "$TMP"; printf "LITERAL=%s\\n" "%TMP%"');
  assert.equal(variables.status, 0, variables.stderr);
  assert.match(variables.stdout, /^TMP=[A-Za-z]:\\/m, "`$TMP` expands to a Windows directory");
  assert.match(variables.stdout, /^LITERAL=%TMP%$/m, "`%TMP%` stays literal text in bash");
  const quoted = run("cat 'C:\\Windows\\System32\\drivers\\etc\\hosts' > /dev/null; echo \"rc=$?\"");
  assert.match(quoted.stdout, /rc=0/, "a quoted backslash path resolves");
  const forward = run('cat C:/Windows/System32/drivers/etc/hosts > /dev/null; echo "rc=$?"');
  assert.match(forward.stdout, /rc=0/, "the forward-slash spelling resolves to the same file");
  const unquoted = run('cat C:\\Windows\\System32\\drivers\\etc\\hosts > /dev/null 2>&1; echo "rc=$?"');
  assert.match(unquoted.stdout, /rc=1/, "an unquoted backslash path is eaten by bash's escaping, which is why the sentence says to quote it");
  pass("the contract's variable and Windows-path sentence holds on the real engine");
}

// 6. The `select` limitation the README states: a command containing one fails at parse time, so not one
// byte of it runs. The corpus owns the other deviations the contract used to list.
{
  const select = run("echo before; select x in a b; do break; done; echo after");
  assert.notEqual(select.status, 0, "`select` is still a parse error rather than a working loop");
  assert.doesNotMatch(select.stdout, /before|after/, "a command containing `select` runs nothing at all");
  pass("the README's `select` limitation still holds");
}

// 7. `wait` reports the status of the job it waited for: a job's own PID and a job spec both have to
// come back with that job's exit code, which is what makes `wait $!` usable in a script.
{
  const byPid = run('cmd.exe /c exit 7 & p=$!; wait $p; echo "rc=$?"');
  assert.equal(byPid.status, 0, byPid.stderr);
  assert.match(byPid.stdout, /rc=7/);
  const bySpec = run('cmd.exe /c exit 4 & wait %1; echo "rc=$?"');
  assert.match(bySpec.stdout, /rc=4/);
  const next = run('cmd.exe /c exit 5 & wait -n; echo "rc=$?"');
  assert.match(next.stdout, /rc=5/);
  pass("wait reports the status of the job it waited for");
}

// 8. One undecodable entry in the host environment costs that variable, not every command.
//
// The shell inherits the host's variables as it is created, so an entry the engine cannot decode used to
// abort the process before the first command ran. The variable has to be staged by PowerShell: Node
// normalizes a lone surrogate away before the child's environment block is built (measured — the same
// spawn against the pre-patch engine exits 0), so the runner's `env` option cannot produce this input.
{
  const direct = createDirectRunner(FIXTURE);
  const command = [
    "$env:DSH_PROBE_BAD = [string][char]0xD800 + 'tail'",
    `& '${engine.replace(/'/g, "''")}' --disable-color --noprofile --norc -c 'echo alive'`,
    'Write-Output "rc=$LASTEXITCODE"',
  ].join("; ");
  let staged;
  try {
    staged = direct("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
  } catch (error) {
    staged = { status: null, stdout: "", stderr: String(error) };
  }
  if (staged.status !== 0) {
    // PowerShell itself, not the engine: the engine's own outcome is read from the `rc=` line below, so
    // a non-zero status here means the harness could not stage the input at all.
    console.log(`SKIP  the undecodable host variable could not be staged (${staged.stderr.trim().split(/\r?\n/)[0] ?? "no stderr"})`);
  } else {
    assert.match(staged.stdout, /alive/, "the engine runs the command even though the host environment holds an entry it cannot decode");
    assert.match(staged.stdout, /rc=0/, `and exits successfully; PowerShell reported ${JSON.stringify(staged.stdout.trim())}`);
    pass("an undecodable entry in the host environment costs that variable, not every command");
  }
}

// 9. One directory has one spelling. Windows keeps a second, 8.3 name for most directories, so the same
// place used to leave two `$PWD` values behind: the short one arrived through `%TEMP%` and `/tmp`, the
// long one through a path a script wrote out in full, and `$TEMP` itself held the short one.
{
  const nested = join(FIXTURE, "long-path-probe", "child");
  mkdirSync(nested, { recursive: true });
  const spellings = windowsSpellings(nested);
  if (!spellings.ok) {
    console.log(`SKIP  the probe directory's two spellings could not be read (${spellings.reason})`);
  } else if (spellings.short.toLowerCase() === spellings.long.toLowerCase()) {
    console.log("SKIP  8.3 names are not generated on this volume, so the probe directory has only one spelling");
  } else {
    const viaShort = run(`cd "${spellings.short}" && printf '%s' "$PWD"`);
    const viaLong = run(`cd "${spellings.long}" && printf '%s' "$PWD"`);
    assert.equal(viaShort.status, 0, viaShort.stderr);
    assert.equal(viaLong.status, 0, viaLong.stderr);
    assert.equal(
      viaShort.stdout.trim(),
      viaLong.stdout.trim(),
      `the two spellings of one directory have to leave the same $PWD; got ${JSON.stringify(viaShort.stdout.trim())} and ${JSON.stringify(viaLong.stdout.trim())}`,
    );
    assert.doesNotMatch(viaShort.stdout, /~[0-9]/, `the engine keeps the long spelling: ${JSON.stringify(viaShort.stdout.trim())}`);

    // `$TEMP` is the name `/tmp` resolves through, so the two have to be the same string as well. The
    // comparison is case-insensitive because Windows paths are: what is under test is the absence of an
    // 8.3 component, not which case the volume stored.
    const env = { ...process.env, TEMP: spellings.short, TMP: spellings.short };
    delete env.TMPDIR;
    const fromEnv = run(`printf '%s' "$TEMP"`, { env });
    assert.equal(fromEnv.status, 0, fromEnv.stderr);
    assert.equal(
      fromEnv.stdout.trim().toLowerCase(),
      spellings.long.toLowerCase(),
      `$TEMP has to arrive in its long form; got ${JSON.stringify(fromEnv.stdout.trim())}`,
    );
    pass("one directory keeps one spelling, in $PWD and in $TEMP");
  }
}

// 10. `test -ef` compares file identity, not path text and not contents: a hard link is the same file, two
// files that happen to hold the same bytes are not, and every form of it used to answer `operation not
// supported on this platform`. The corpus owns the four plain forms; the hard link is here because a
// corpus case can only write file contents, and this is the one shape that separates identity from
// everything a string or a digest could answer.
{
  const a = join(FIXTURE, "identity-a.txt");
  const b = join(FIXTURE, "identity-b.txt");
  const hard = join(FIXTURE, "identity-hard.txt");
  const absent = join(FIXTURE, "identity-absent.txt");
  writeFileSync(a, "same bytes\n");
  writeFileSync(b, "same bytes\n");
  linkSync(a, hard);
  const quoted = (path) => `"${path.replace(/\\/g, "/")}"`;
  const result = run(
    [
      `[[ ${quoted(a)} -ef ${quoted(a)} ]]; printf 'self=%s\\n' $?`,
      `[[ ${quoted(a)} -ef ${quoted(b)} ]]; printf 'same-bytes=%s\\n' $?`,
      `[[ ${quoted(a)} -ef ${quoted(hard)} ]]; printf 'hard-link=%s\\n' $?`,
      `[[ ${quoted(a)} -ef ${quoted(absent)} ]]; printf 'absent=%s\\n' $?`,
      `[[ ${quoted(FIXTURE)} -ef ${quoted(FIXTURE)} ]]; printf 'directory=%s\\n' $?`,
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^self=0$/m);
  assert.match(result.stdout, /^same-bytes=1$/m, "two files with identical contents are two files");
  assert.match(result.stdout, /^hard-link=0$/m, "a hard link names the same file");
  assert.match(result.stdout, /^absent=1$/m, "an operand that is not there answers false rather than erroring");
  assert.match(result.stdout, /^directory=0$/m);
  assert.equal(result.stderr.trim(), "", `-ef must not report an error: ${JSON.stringify(result.stderr.trim())}`);
  pass("`test -ef` compares file identity, which the engine now has");
}


rmSync(FIXTURE, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);
