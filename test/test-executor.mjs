// Drives the real executor through a minimal context: the point is the argv this plugin builds,
// the confinement it requests, and the sandbox facts it stamps — not cordis' own plumbing.
// Engine resolution probes the real filesystem, so every case points `bashPath` at a fixture file.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { SANDBOX_UNAVAILABLE } from "@deepseek-ai/dsh-sandbox";
import { packageRoot } from "../lib/artifact.js";
import { Config } from "../lib/config.js";
import { BashNativeExecutor, ENVIRONMENT_SECTION } from "../lib/index.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "dsh-bash-native-test-"));
const ENGINE = join(FIXTURE_DIR, "brush.exe");
const FOREIGN = join(FIXTURE_DIR, "bash.exe");
const MISSING = join(FIXTURE_DIR, "missing-engine.exe");
writeFileSync(ENGINE, "");
writeFileSync(FOREIGN, "");

/**
 * Hermetic engine resolution for these cases: the real verifier runs `--version`, which an empty
 * fixture file cannot answer, so this subclass answers from the path the way the real one answers from
 * a banner. The identification parse itself has its own test (`test-verify.mjs`).
 */
class FixtureExecutor extends BashNativeExecutor {
  verifyEngine(path) {
    return /brush/i.test(path)
      ? { version: "brush 0.4.0 (test)", refused: null }
      : { version: "", refused: 'it reports "GNU bash, version 5.3.15(1)-release", which is not brush' };
  }
}

const WORKSPACE = "D:\\Pi\\dsh_plugins\\ws";
const DENIAL = "access is denied";
const RUNNER_FATAL = "windows-acl-run:";

/** Minimal context: only the surface `Service`, the executor, and `LocalBashExecutor` touch. */
function makeContext({ defaultMode = "workspace-write", policy = undefined } = {}) {
  const state = {
    provided: new Map(),
    confined: [],
    spawned: [],
    sections: [],
    warnings: [],
    script: { stdout: "", stderr: "", exitCode: 0 },
  };
  const ctx = {
    reflect: { provide: (name, value) => state.provided.set(name, value) },
    logger: { warn: (...args) => state.warnings.push(args.join(" ")) },
    effect: (callback) => {
      callback();
      return () => {};
    },
    sandboxPolicy: {
      defaultMode,
      resolve: () => policy ?? { mode: defaultMode, workspaceRoot: WORKSPACE },
    },
    sandbox: {
      confine: async (argv, requested, signal) => {
        if (signal?.aborted === true) signal.throwIfAborted();
        state.confined.push({ argv, policy: requested });
        return {
          argv: ["windows-acl-run", "--", ...argv],
          enforcement: "partial",
          denialSignatures: [DENIAL],
          runnerFailureRules: [{ fatalSignatures: [RUNNER_FATAL] }],
        };
      },
    },
    subprocess: {
      resolveExecutable: async () => "",
      terminalEnvironment: async () => ({ platform: "windows" }),
      spawnTerminal: async () => {
        throw new Error("spawnTerminal is not used by this executor");
      },
      spawn: (spec) => {
        const outcome = { ...state.script };
        state.spawned.push({ spec, outcome });
        const reader = (text) => ({
          readFrom: (from) => ({
            text: text.slice(Math.min(from, text.length)),
            nextOffset: text.length,
            lossy: false,
          }),
        });
        return {
          stdin: undefined,
          stdout: undefined,
          stderr: undefined,
          control: undefined,
          collected: { stdout: reader(outcome.stdout), stderr: reader(outcome.stderr) },
          done: Promise.resolve({ exitCode: outcome.exitCode, signal: null }),
          terminate: () => {
            outcome.terminated = true;
          },
          waitForExit: async () => true,
        };
      },
    },
    systemPrompt: {
      section: (section) => {
        state.sections.push(section);
        return () => {};
      },
      getSectionOrder: () => 1000,
    },
  };
  return { ctx, state };
}

function makeExecutor({ bashPath = ENGINE, config = {}, ...contextOptions } = {}) {
  const env = makeContext(contextOptions);
  const executor = new FixtureExecutor(env.ctx, Config({ bashPath, confine: true, ...config }));
  return { executor, ...env };
}

// 1. The command reaches the engine as one verbatim operand, with the model-friendly environment.
{
  const { executor, state } = makeExecutor();
  const spec = executor.resolve({ command: "echo hi" });
  assert.equal(spec.workdir, process.cwd(), "the inherited resolve() supplies the working directory");
  const execution = await executor.execute(spec);
  const spawn = state.spawned[0].spec;
  assert.deepEqual(spawn.argv.slice(0, 2), ["windows-acl-run", "--"]);
  assert.deepEqual(state.confined[0].argv, [ENGINE, "--disable-color", "-c", "echo hi"]);
  assert.deepEqual(spawn.argv.slice(2), [ENGINE, "--disable-color", "-c", "echo hi"]);
  assert.equal(spawn.cwd, spec.workdir);
  assert.equal(spawn.env.TERM, "dumb");
  assert.equal(spawn.env.NO_COLOR, "1");
  assert.equal(spawn.stdio.stdin, "ignore");
  assert.ok(spawn.stdio.stdout.maxBytes > 0);
  assert.equal(state.confined.length, 1, "a confined tier wraps the engine argv exactly once");
  assert.equal(state.confined[0].policy.mode, "workspace-write");
  assert.equal(state.confined[0].policy.workspaceRoot, WORKSPACE);
  await execution.result();
  pass("a confined command spawns the wrapped engine argv with the model-friendly environment");
}

// 2. Workspace-write results carry the mode, enforcement, and an undenied verdict.
{
  const { executor } = makeExecutor();
  const result = await (await executor.execute(executor.resolve({ command: "echo hi" }))).result();
  assert.deepEqual(result.sandbox, { mode: "workspace-write", denied: false, enforcement: "partial" });
  pass("a confined result reports the mode, enforcement, and denied: false");
}

// 3. A denial signature on a failed run is reported as a denial.
{
  const { executor, state } = makeExecutor();
  state.script = { stdout: "", stderr: `touch: cannot touch 'x': ${DENIAL}\n`, exitCode: 1 };
  const result = await (await executor.execute(executor.resolve({ command: "touch x" }))).result();
  assert.equal(result.exitCode, 1);
  assert.equal(result.sandbox.denied, true);
  pass("a denied file effect is classified as a denial");
}

// 4. A runner failure outranks the denial and fails closed with SANDBOX_UNAVAILABLE.
{
  const { executor, state } = makeExecutor();
  state.script = { stdout: "", stderr: `${RUNNER_FATAL} token creation failed\n`, exitCode: 127 };
  const execution = await executor.execute(executor.resolve({ command: "echo hi" }));
  await assert.rejects(execution.result(), (error) => error.code === SANDBOX_UNAVAILABLE);
  assert.equal(execution.sandbox.runnerFailed, true, "the settled handle records the runner failure");
  pass("a runner failure outranks a denial and rejects with SANDBOX_UNAVAILABLE");
}

// 4b. A localized Windows access-denied is still classified as a denial.
{
  const localized = "error: failed to redirect to D:/tmp/x.txt: 拒绝访问。 (os error 5)";
  const { executor, state } = makeExecutor();
  state.script = { stdout: "", stderr: `${localized}\n`, exitCode: 1 };
  const result = await (await executor.execute(executor.resolve({ command: "echo x > /tmp/x.txt" }))).result();
  assert.equal(result.sandbox.denied, true, "a non-English host still reports the denial");
  const strict = makeExecutor({ config: { denialSignatureAdditions: [] } });
  strict.state.script = { stdout: "", stderr: `${localized}\n`, exitCode: 1 };
  const strictResult = await (await strict.executor.execute(strict.executor.resolve({ command: "echo x" }))).result();
  assert.equal(
    strictResult.sandbox.denied,
    false,
    "the provider's own dialect alone misses the localized message, which is why the default exists",
  );
  pass("a localized access-denied is classified as a denial, and the additions are configurable");
}

// 4c. A denial a later command masked is still classified: bash hands the script's status to the last
// command, so `echo x > <outside>/f; echo done` settles at 0 with the file unwritten. The engine reports
// the refusal on stderr exactly as it does at status 1 (measured), so the status is not the test.
{
  const masked = "error: failed to redirect to D:/tmp/x.txt: 拒绝访问。 (os error 5)";
  const { executor, state } = makeExecutor();
  state.script = { stdout: "done\n", stderr: `${masked}\n`, exitCode: 0 };
  const execution = await executor.execute(executor.resolve({ command: "echo x > /tmp/x.txt; echo done" }));
  const result = await execution.result();
  assert.equal(result.exitCode, 0, "the masked command really does settle at zero");
  assert.equal(result.sandbox.denied, true, "the masked write is still reported as denied");
  assert.equal(execution.sandbox.denied, true, "the settled handle carries the same verdict");
  const clean = makeExecutor();
  clean.state.script = { stdout: "done\n", stderr: "", exitCode: 0 };
  const cleanResult = await (await clean.executor.execute(clean.executor.resolve({ command: "echo done" }))).result();
  assert.equal(cleanResult.sandbox.denied, false, "a clean success is still not a denial");
  const killed = makeExecutor();
  killed.state.script = { stdout: "", stderr: `${masked}\n`, exitCode: null };
  const killedResult = await (await killed.executor.execute(killed.executor.resolve({ command: "echo x > /tmp/x.txt" }))).result();
  assert.equal(killedResult.sandbox.denied, false, "a signal death is not a denial");
  pass("a denial masked by a later command is classified, while a clean success and a signal death are not");
}

// 5. danger-full-access spawns the engine unconfined and still reports the mode.
{
  const { executor, state } = makeExecutor({ defaultMode: "danger-full-access" });
  const result = await (await executor.execute(executor.resolve({ command: "echo hi" }))).result();
  assert.equal(state.confined.length, 0, "full access never consults the sandbox provider");
  assert.deepEqual(state.spawned[0].spec.argv, [ENGINE, "--disable-color", "-c", "echo hi"]);
  assert.deepEqual(result.sandbox, { mode: "danger-full-access", denied: false });
  pass("danger-full-access spawns unconfined and reports denied: false");
}

// 6. An engine that is not brush is refused at resolution, and no tier makes it selectable.
{
  const refused = makeExecutor({ bashPath: FOREIGN });
  await assert.rejects(
    refused.executor.execute(refused.executor.resolve({ command: "echo hi" })),
    /refused: it reports "GNU bash/,
  );
  assert.equal(refused.state.spawned.length, 0, "a refused engine never spawns");
  const full = makeExecutor({ bashPath: FOREIGN, defaultMode: "danger-full-access" });
  await assert.rejects(
    full.executor.execute(full.executor.resolve({ command: "echo hi" })),
    /dsh-bash-local/,
    "full access does not make another shell selectable: this executor runs brush only",
  );
  assert.equal(full.state.spawned.length, 0);
  pass("an engine that is not brush is refused at resolution under every tier");
}

// 7. Without an engine every call fails with the probed candidates and the remedy.
{
  const { executor } = makeExecutor({ bashPath: MISSING });
  await assert.rejects(
    executor.execute(executor.resolve({ command: "echo hi" })),
    /no usable bash engine was found|missing/,
  );
  assert.equal(executor.enginePath, "", "an unresolved engine exposes no path");
  pass("an unresolved engine fails with the probe list and remedy");
}

// 8. confine: false drops the policy, the escalation fact, and every sandbox stamp.
{
  const { executor, state } = makeExecutor({ config: { confine: false } });
  assert.equal(executor.sandboxMode, undefined, "an unconfined executor advertises no sandbox mode");
  const spec = executor.resolve({ command: "echo hi" });
  assert.equal(spec.sandboxPolicy, undefined);
  const result = await (await executor.execute(spec)).result();
  assert.equal(state.confined.length, 0);
  assert.equal(result.sandbox, undefined);
  pass("confine: false runs unconfined and stamps no sandbox facts");
}

// 9. The resolved engine is exposed for a PTY composition, and its argv is the interactive one.
//
// A startup file is written when there is anything to put in it: a toolchain directory, the `bash`/`sh`
// names, or both. With *no* toolchain the names still count, so whether the argv says `--rcfile` depends on
// whether the names could be prepared at all — a confined session cannot write the per-user shim directory
// and falls back to `--norc`, while an unconfined one writes the file. The invariant asserted here is
// therefore the one that holds on both: exactly one of the two flags, and a toolchain-less startup file
// that carries the names directory and does not mention the toolchain.
{
  const local = mkdtempSync(join(tmpdir(), "dsh-bash-native-pty-none-"));
  const savedLocal = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  try {
    const noTools = mkdtempSync(join(tmpdir(), "dsh-bash-native-pty-notools-"));
    const { executor } = makeExecutor({ config: { toolsDir: noTools } });
    assert.equal(executor.enginePath, ENGINE);
    const args = [...executor.engineArgs];
    const named = args.includes("--rcfile");
    assert.equal(args.includes("--norc") !== named, true, "the interactive argv names a startup file or --norc, never both and never neither");
    if (named) {
      const contents = readFileSync(args[args.indexOf("--rcfile") + 1], "utf8");
      assert.equal(contents.includes(noTools), false, "the empty tools directory is not written into the startup file");
      assert.match(contents, /dsh-bash-native[\\/]+shim[\\/]+[0-9a-f]{64}/, "it carries the bash/sh names directory");
    }
    rmSync(noTools, { recursive: true, force: true });
  } finally {
    process.env.LOCALAPPDATA = savedLocal;
    rmSync(local, { recursive: true, force: true });
  }

  // With a toolchain the persistent session has to be told where it is, because a PTY spawns the
  // engine directly and never passes through the executor's environment layering. `rcFile` keeps this
  // case hermetic: the per-user default belongs to the machine running the suite, and a confined
  // session cannot write it at all, which is what made this suite fail outside an unconfined shell.
  const toolsDir = mkdtempSync(join(tmpdir(), "dsh-bash-native-pty-tools-"));
  writeFileSync(join(toolsDir, "grep.exe"), "");
  const rcRoot = mkdtempSync(join(tmpdir(), "dsh-bash-native-pty-rc-"));
  const rcFile = join(rcRoot, "state", "bash-native-rc.sh");
  const tooled = makeExecutor({ config: { toolsDir, rcFile } });
  const args = [...tooled.executor.engineArgs];
  assert.deepEqual(args.slice(0, 3), ["--disable-color", "--noprofile", "--rcfile"], "--norc is replaced, not supplemented");
  assert.equal(args.includes("--norc"), false, "--norc is gone rather than accompanied");
  assert.equal(args[4], "-i");
  assert.equal(args[3], rcFile, "the configured startup file is the one passed");
  // The parent directory is created: an install whose engine came from PATH or a bundled directory
  // never created the per-user state directory, and the write used to fail there and drop the toolchain.
  assert.equal(existsSync(rcFile), true, "a missing parent directory is created");
  {
    const contents = readFileSync(rcFile, "utf8");
    assert.match(contents, /^# Generated by dsh-bash-native: /, "the file names its own origin");
    const exported = /export PATH='([^']*)'";\$PATH"\n$/.exec(contents);
    assert.notEqual(exported, null, "the file exports a PATH");
    const dirs = exported[1].split(";");
    assert.equal(dirs[0], toolsDir, "the toolchain directory leads");
    for (const dir of dirs.slice(1)) {
      assert.match(dir, /dsh-bash-native[\\/]+shim[\\/]+[0-9a-f]{64}$/, "anything behind it is the bash/sh names directory");
    }
  }
  // The file is rewritten only when its contents differ, so a session's startup stays stable across
  // calls and an interrupted run cannot leave a stale file behind.
  const stable = statSync(rcFile).mtimeMs;
  const until = Date.now() + 30;
  while (Date.now() < until) { /* let the clock move so a rewrite would be visible */ }
  assert.deepEqual([...tooled.executor.engineArgs], args, "the argv does not change between calls");
  assert.equal(statSync(rcFile).mtimeMs, stable, "an identical rcfile is not rewritten");
  writeFileSync(rcFile, "stale\n");
  tooled.executor.engineArgs;
  assert.equal(readFileSync(rcFile, "utf8").includes("export PATH="), true, "a stale rcfile is replaced");
  // With no configured path the per-user location is derived from `LOCALAPPDATA`, and it is created
  // there too.
  const savedLocalAppData = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = rcRoot;
  try {
    const derived = makeExecutor({ config: { toolsDir } });
    const derivedFile = join(rcRoot, "dsh-bash-native", "bash-native-rc.sh");
    assert.equal(derived.executor.engineArgs[3], derivedFile, "the per-user startup file is derived from LOCALAPPDATA");
    assert.equal(existsSync(derivedFile), true, "the derived startup file is written");
  } finally {
    process.env.LOCALAPPDATA = savedLocalAppData;
  }
  rmSync(rcRoot, { recursive: true, force: true });
  rmSync(toolsDir, { recursive: true, force: true });
  pass("enginePath and the interactive engineArgs are exposed for a PTY composition");
}

// 10. The environment section is registered once, states the two contract sentences, and is switchable.
{
  const withSection = makeExecutor();
  assert.equal(withSection.state.sections.length, 1);
  const section = withSection.state.sections[0];
  assert.equal(section.name, ENVIRONMENT_SECTION);
  assert.equal(section.order, 1000);
  const text = section.text();
  assert.equal(
    text,
    [
      "This session's `bash` tool runs a bash-compatible shell natively on Windows; use bash syntax.",
      'Use `$VAR` names such as `$TMP`; prefer real Windows paths (`"C:\\..."` quoted, or `C:/...`) over POSIX shorthands.',
    ].join("\n"),
    "the contract is exactly those two sentences",
  );
  assert.equal(text.split("\n").length, 2, "two lines, one sentence each");

  // Neither the engine nor the toolchain enters the text any more, so nothing an install does can change
  // it — an installed directory, an unresolved engine and a lean composition all state the same pair.
  const toolsDir = mkdtempSync(join(tmpdir(), "dsh-bash-native-tools-"));
  writeFileSync(join(toolsDir, "grep.exe"), "");
  const withTools = makeExecutor({ config: { toolsDir } });
  assert.equal(withTools.state.sections[0].text(), text, "an installed toolchain does not change the text");
  rmSync(toolsDir, { recursive: true, force: true });
  const lean = makeExecutor({ config: { promptDetail: "minimal" } });
  assert.equal(lean.state.sections[0].text(), text, "the two promptDetail shapes render the same text");
  const unresolved = makeExecutor({ bashPath: MISSING });
  assert.equal(unresolved.state.sections[0].text(), text, "an unresolved engine does not change the text");

  const without = makeExecutor({ config: { promptSection: false } });
  assert.equal(without.state.sections.length, 0);
  pass("the environment section is registered once, states the two sentences, and is switchable");
}

// 11. Resolving a call finalizes the environment: the toolchain goes first on PATH, the configured
// overrides apply, and the managed facts still win.
{
  const toolsDir = mkdtempSync(join(tmpdir(), "dsh-bash-native-env-"));
  writeFileSync(join(toolsDir, "grep.exe"), "");
  const { executor } = makeExecutor({
    config: { toolsDir, shellEnvOverrides: { DSH_BASH_NATIVE_TEST: "override" } },
  });
  const spec = executor.resolve({ command: "grep x", env: { REQUEST_VAR: "request" }, dshEnv: { DSH_VAR: "managed" } });
  const path = spec.env.PATH ?? "";
  assert.equal(path.split(delimiter)[0], toolsDir, "the toolchain is first on PATH so its names win");
  assert.equal(spec.env.DSH_BASH_NATIVE_TEST, "override", "shellEnvOverrides is applied, not merely configured");
  assert.equal(spec.env.REQUEST_VAR, "request");
  assert.equal(spec.env.DSH_VAR, "managed", "managed facts merge last");
  assert.equal(spec.env.NO_COLOR, "1", "the model-friendly defaults survive");
  // A request that sets PATH itself still wins over the prepend, which is the documented precedence.
  const explicit = executor.resolve({ command: "x", env: { PATH: "C:\\only" } });
  assert.equal(explicit.env.PATH, "C:\\only");
  // Without a toolchain the inherited PATH is only touched for the `bash`/`sh` names, which are the
  // plugin's own addition and are prepared whenever the engine resolved. So the invariant is: either PATH
  // is untouched, or every entry in front of the inherited value is a names directory.
  const empty = mkdtempSync(join(tmpdir(), "dsh-bash-native-emptytools-"));
  const none = makeExecutor({ config: { toolsDir: empty } });
  const untooled = none.executor.resolve({ command: "x" });
  const inherited = process.env.PATH ?? "";
  const untooledPath = untooled.env.PATH;
  if (untooledPath !== undefined) {
    assert.equal(untooledPath.endsWith(inherited), true, "the inherited PATH stays behind whatever was prepended");
    for (const dir of untooledPath.slice(0, untooledPath.length - inherited.length).split(delimiter).filter((part) => part.length > 0)) {
      assert.match(dir, /dsh-bash-native[\\/]+shim[\\/]+[0-9a-f]{64}$/, "only the bash/sh names directory is prepended without a toolchain");
    }
  }
  rmSync(empty, { recursive: true, force: true });
  rmSync(toolsDir, { recursive: true, force: true });
  pass("resolving a call prepends the toolchain and applies the configured overrides");
}

// 12. An unresolved engine still registers the section (the contract no longer names the engine, and
// case 10 pins that an unresolved engine renders the same two sentences) and warns once at load.
{
  const { state } = makeExecutor({ bashPath: MISSING });
  assert.equal(state.sections.length, 1);
  assert.equal(state.sections[0].text().split("\n").length, 2, "the section states the same two sentences");
  assert.equal(state.warnings.length, 1);
  assert.match(state.warnings[0], /no bash engine resolved yet/);
  pass("an unresolved engine warns at load and still registers the section");
}

// 13. requireEngineOnLoad turns the same condition into a load failure.
{
  const { ctx } = makeContext();
  assert.throws(
    () => new BashNativeExecutor(ctx, Config({ bashPath: MISSING, requireEngineOnLoad: true })),
    /no usable bash engine was found|missing/,
  );
  pass("requireEngineOnLoad fails plugin load instead of every call");
}

// 14. An install with nothing built uses the toolchain the package carries, outside the workspace.
//
// `LOCALAPPDATA` is redirected so both directories the executor can use live under a temporary root: with
// nothing built there, the packaged toolchain is the one that has to answer, which is the install-and-use
// claim this package makes.
{
  const local = mkdtempSync(join(tmpdir(), "dsh-bash-native-packaged-"));
  const saved = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  try {
    const { executor } = makeExecutor({ config: { toolsDir: "" } });
    const spec = executor.resolve({ command: "grep x" });
    const first = (spec.env.PATH ?? "").split(delimiter)[0] ?? "";
    assert.match(
      first,
      /dsh-bash-native\\toolchain\\[0-9a-f]{64}\\bin$/,
      "the packaged toolchain is prepared into a content-addressed cache outside the workspace",
    );
    assert.equal(existsSync(join(first, "grep.exe")), true, "its published names are there to be run");
    assert.equal(existsSync(join(first, "awk.exe")), true);
    // The cache is what runs, and the package's own copy is never put on PATH.
    assert.doesNotMatch(first, /toolchain\\win32-x64$/, "the files are not run where they ship");
    pass("an install with nothing built uses the packaged toolchain");
  } finally {
    process.env.LOCALAPPDATA = saved;
    rmSync(local, { recursive: true, force: true });
  }
}

// 15. The engine runs where the package puts it, whatever tree the sandbox grants. This is the release
// arrangement (`dsh plugin add` lands under `$DSH_HOME/profiles/<profile>/node_modules/…`, outside the
// granted tree), so there is one behavior to pin: the packaged path is the engine path, and no copy of it
// appears under `LOCALAPPDATA` even when the granted tree is the package's own directory.
{
  const local = mkdtempSync(join(tmpdir(), "dsh-bash-native-placement-"));
  const saved = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  try {
    const artifact = join(packageRoot(), "engine", "win32-x64", "brush.exe");
    const outside = makeExecutor({ bashPath: "", policy: { mode: "workspace-write", workspaceRoot: "D:\\Pi\\dsh_plugins\\ws" } });
    assert.equal(outside.executor.enginePath, artifact, "a package outside the granted tree runs where it lies");

    const inside = makeExecutor({ bashPath: "", policy: { mode: "workspace-write", workspaceRoot: packageRoot() } });
    assert.equal(inside.executor.enginePath, artifact, "and so does one inside it: there is no second placement");
    assert.equal(
      existsSync(join(local, "dsh-bash-native", "engine")),
      false,
      "nothing is materialized for the engine, so a session pays no copy",
    );
    pass("the engine runs where the package puts it, with no copy in either arrangement");
  } finally {
    process.env.LOCALAPPDATA = saved;
    rmSync(local, { recursive: true, force: true });
  }
}

// 16. `bash` and `sh` are on PATH beside the toolchain, so a script, a Makefile or a tool that shells out
// to `bash` finds one; they are the verified engine under two more names, not a second binary.
{
  const local = mkdtempSync(join(tmpdir(), "dsh-bash-native-shim-"));
  const saved = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = local;
  try {
    const { executor } = makeExecutor({ config: { toolsDir: "" } });
    const spec = executor.resolve({ command: "bash -c 'echo hi'" });
    const entries = (spec.env.PATH ?? "").split(delimiter);
    const shim = entries.find((entry) => /dsh-bash-native\\shim\\[0-9a-f]{64}$/.test(entry));
    assert.notEqual(shim, undefined, "the shell names are prepended to PATH");
    assert.equal(entries.indexOf(shim) < 2, true, "and they come before everything the host had");
    assert.equal(existsSync(join(shim, "bash.exe")), true, "bash resolves to the engine");
    assert.equal(existsSync(join(shim, "sh.exe")), true, "and so does sh");
    pass("bash and sh are published on PATH beside the toolchain");
  } finally {
    process.env.LOCALAPPDATA = saved;
    rmSync(local, { recursive: true, force: true });
  }
}

rmSync(FIXTURE_DIR, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);