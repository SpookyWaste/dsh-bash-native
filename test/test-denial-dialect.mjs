// What a refused file effect looks like on stderr, from the engine this package ships.
//
// The plugin cannot use the exit status to decide whether the file policy refused something — bash hands
// the script's status to its last command, so `… > <unwritable>; echo done` settles at 0 — so it matches
// stderr against the dialect the sandbox provider names plus the configured additions. That makes the
// wording of a refusal part of this package's contract, which is what these cases pin:
//
//   * the engine's own refusals (a redirect, `touch`, `mkdir`, and a toolchain program the engine starts)
//     are worded in POSIX English — `Permission denied` — whatever the host language is, so the
//     provider's own dialect matches them and no code is needed;
//   * the packaged toolchain's programs (`find`, `sed`) still print the localized system text, and the
//     default addition (`os error 5`) is what makes that class visible;
//   * `test-executor.mjs` pins the other half — that such stderr at status 0 is classified `denied` — so
//     the two suites together state the whole rule;
//   * the masking premise itself is measured here rather than assumed: the denial is produced by a
//     read-only file, and the command still exits 0 because a later command succeeds;
//   * the rule is a wording test and not evidence: case 7 measures the false positive the README
//     discloses (a plain stderr phrase, status 0, no file effect, still accepted), and case 8 pins that
//     the engine writes no escape bytes at all and rejects the brush-only `--disable-color` flag, so the
//     plugin's argv must not carry it.
//
// The denial is produced with a file attribute rather than a sandbox, so this suite needs neither a DSH
// session nor a confined runner, and it works under any file policy the session happens to have.
import assert from "node:assert/strict";
import { closeSync, chmodSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "../lib/config.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENGINE = join(REPO_ROOT, "engine", "win32-x64", "rubash.exe");
const SCRATCH = mkdtempSync(join(tmpdir(), "dsh-denial-dialect-"));
const STDOUT = join(SCRATCH, "stdout.txt");
const STDERR = join(SCRATCH, "stderr.txt");
const SOURCE = join(SCRATCH, "src.txt");
const READ_ONLY = join(SCRATCH, "read-only.txt");

/** The English dialect `dsh-sandbox-local` names for the `windows-acl` backend, plus the shipped default. */
const DIALECT = [...["access is denied", "access to the path", "permission denied", "operation not permitted"], ...Config({}).denialSignatureAdditions];

/** Run the shipped engine on one command, capturing both streams through files. */
function runEngine(command, env = undefined, args = ["-c"]) {
  const out = openSync(STDOUT, "w");
  const err = openSync(STDERR, "w");
  try {
    const result = spawnSync(ENGINE, [...args, command], { stdio: ["ignore", out, err], windowsHide: true, ...(env === undefined ? {} : { env }) });
    if (result.error !== undefined) throw result.error;
    return { status: result.status, stdout: readFileSync(STDOUT, "utf8"), stderr: readFileSync(STDERR, "utf8") };
  } finally {
    closeSync(out);
    closeSync(err);
  }
}

/** The slash form of a scratch path, which is how a command spells it. */
const slash = (path) => path.replace(/\\/g, "/");

/** Whether the shipped dialect accepts this stderr, which is the test the plugin itself applies. */
const matchesDialect = (stderr) => {
  const lowered = stderr.toLowerCase();
  return DIALECT.some((signature) => lowered.includes(signature.toLowerCase()));
};

writeFileSync(SOURCE, "content\n");
writeFileSync(READ_ONLY, "existing\n");
chmodSync(READ_ONLY, 0o444);

// 1. The shell's own redirect onto a read-only file: refused, still exit 0, and the wording is the
// engine's POSIX English rather than the host's localized message.
{
  const result = runEngine(`echo x > '${slash(READ_ONLY)}'; echo done`);
  assert.equal(result.status, 0, "the later command decides the status, which is why the status cannot carry the denial");
  assert.equal(result.stdout.includes("done"), true, "the command really ran to the end");
  assert.match(result.stderr, /permission denied/i, `the redirect refusal names the POSIX error: ${JSON.stringify(result.stderr)}`);
  assert.doesNotMatch(result.stderr, /[^\x00-\x7f]/, "the wording carries no host-language text, so one dialect covers every locale");
  assert.equal(matchesDialect(result.stderr), true, "the shipped dialect accepts the message");
  pass("a redirect onto a read-only file is refused in POSIX English at status 0");
}

// 2. A toolchain program the engine starts (`cp`): the same wording, through the program's own message.
{
  const result = runEngine(`cp '${slash(SOURCE)}' '${slash(READ_ONLY)}'; echo done`);
  assert.equal(result.status, 0, "the masking command still decides the status");
  assert.match(result.stderr, /permission denied/i, `the toolchain refusal names the POSIX error: ${JSON.stringify(result.stderr)}`);
  assert.equal(matchesDialect(result.stderr), true, "the shipped dialect accepts the message");
  pass("a toolchain program refusal is worded in POSIX English at status 0");
}

// 3. `mkdir` inside a directory the OS protects: the same class of refusal, and the one shape that a
// read-only file cannot produce. The premise is measured first — a host that allows the write would make
// the assertion meaningless, so it is reported instead of asserted.
{
  const protectedRoot = "C:/System Volume Information";
  const probe = runEngine(`mkdir '${protectedRoot}/dsh-denial-probe'; echo done`);
  if (probe.stdout.includes("done") && probe.stderr.trim().length === 0) {
    runEngine(`rmdir '${protectedRoot}/dsh-denial-probe'`);
    console.log(`NOTE  ${protectedRoot} accepted the write on this host, so the mkdir shape is not measured here`);
  } else {
    assert.match(probe.stderr, /permission denied/i, `the mkdir refusal names the POSIX error: ${JSON.stringify(probe.stderr)}`);
    assert.equal(matchesDialect(probe.stderr), true, "the shipped dialect accepts the message");
    pass("a mkdir refusal inside an OS-protected directory is worded in POSIX English");
  }
}

// 4. A program from the packaged toolchain: the engine does not ship `find` or `sed`, and their `uucore`
// formatting keeps the localized system message, so this class is visible only through the code.
{
  const packaged = [join(REPO_ROOT, "toolchain", "win32-x64"), process.env.PATH ?? ""].join(delimiter);
  const env = { ...process.env, PATH: packaged };
  const find = runEngine(`find '${slash(SCRATCH)}' -maxdepth 1 -name src.txt -fprint '${slash(READ_ONLY)}'; echo done`, env);
  assert.equal(find.status, 0, "the masking command still decides the status");
  assert.match(find.stderr, /\(os error 5\)/, `the packaged find refusal keeps the code: ${JSON.stringify(find.stderr)}`);
  // `sed -i` cannot be this case's shape: it writes a temporary file and renames it over the target, so a
  // read-only file is replaced with no refusal at all (measured on this build). A `w` command opens the
  // file the script names, which is the refusal wanted here — and the path is spelled natively because an
  // operand inside program text is not alias-translated (the script-operand boundary the README states).
  const sed = runEngine(`sed -e 's/content/changed/w ${slash(READ_ONLY)}' '${slash(SOURCE)}'; echo done`, env);
  assert.match(sed.stderr, /\(os error 5\)/, `the packaged sed refusal keeps the code: ${JSON.stringify(sed.stderr)}`);
  assert.equal(matchesDialect(sed.stderr), true, "the shipped dialect accepts the message through the default addition");
  pass("a packaged toolchain program refusal keeps the language-neutral code at status 0");
}

// 5. The engine's `touch` refusal is the same English wording, from a different builtin.
{
  const protectedRoot = "C:/System Volume Information";
  const result = runEngine(`touch '${protectedRoot}/dsh-denial-wording-probe'; echo done`);
  if (result.stdout.includes("done") && result.stderr.trim().length === 0) {
    console.log(`NOTE  ${protectedRoot} accepted the write on this host, so the touch wording is not measured here`);
  } else {
    assert.equal(result.status, 0, "the masking command still decides the status");
    assert.equal(matchesDialect(result.stderr), true, `the English wording is part of the dialect: ${JSON.stringify(result.stderr)}`);
    assert.match(result.stderr, /permission denied/i, "the wording is the POSIX English one");
    pass("a refusal worded in English is accepted through the provider's dialect");
  }
}

// 6. A command that was not refused is not classified, so the dialect is not simply "anything on stderr".
{
  const result = runEngine(`cat '${slash(SOURCE)}'; echo done`);
  assert.equal(result.status, 0);
  assert.equal(matchesDialect(result.stderr), false, "a clean run carries nothing the dialect matches");
  pass("a successful command carries nothing the dialect matches");
}

// 7. The other direction, and the reason the marker is a heuristic rather than evidence: the wording alone is
// the rule, so a run with no file effect at all is accepted too. The README discloses this; this case is
// what keeps the disclosure true.
{
  const result = runEngine(`echo "access is denied" >&2; echo done`);
  assert.equal(result.status, 0, "nothing failed and no file was touched");
  assert.equal(matchesDialect(result.stderr), true, "the shipped rule accepts wording no policy produced");
  pass("a plain stderr phrase is accepted by the dialect, which is the documented false positive");
}

// 8. The engine writes plain text: no escape bytes in its own diagnostics, with or without brush's
// color flag — which it rejects as an invalid option, so the plugin's argv must not carry it.
{
  const plain = runEngine(`./definitely-missing-tool; echo done`);
  assert.equal(plain.stderr.includes("\u001b"), false, `the engine colors nothing: ${JSON.stringify(plain.stderr)}`);
  assert.match(plain.stderr, /no such file or directory/i, "the diagnostic is the POSIX wording");
  const flagged = runEngine(`echo done`, undefined, ["--disable-color", "-c"]);
  assert.notEqual(flagged.status, 0, "the brush-only flag is an error on this engine");
  assert.match(flagged.stderr, /invalid option/, "and the error names the flag as invalid");
  const refusal = runEngine(`echo x > '${slash(READ_ONLY)}'; echo done`);
  assert.equal(refusal.stderr.includes("\u001b"), false, "a refusal is plain text too");
  assert.equal(matchesDialect(refusal.stderr), true, "and it is still matched without color codes");
  pass("the engine's diagnostics are plain text and it rejects the brush-only color flag");
}

chmodSync(READ_ONLY, 0o666);
rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);