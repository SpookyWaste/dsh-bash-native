import assert from "node:assert/strict";
import { buildCommandArgv, buildInteractiveArgv, buildShellEnv, interactiveArgsWithRcFile } from "../lib/argv.js";
import { resolveEngine } from "../lib/resolve.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

function fixture(paths) {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return { isFile: (p) => set.has(p.toLowerCase()) };
}

const baseInput = { bashPath: "", bundledEngineDir: "", packaged: null };
const accept = (path) => ({ version: `brush 0.4.0 (test) ${path}`, refused: null });
const bashEngine = resolveEngine(baseInput, { PATH: "C:\\tools" }, "win32", fixture(["C:\\tools\\brush.exe"]), accept).engine;

// 1. The command string travels as one verbatim operand after the activation argv and the flag that
// keeps the engine's own diagnostics free of ANSI escapes.
{
  const argv = buildCommandArgv(bashEngine, "ls -la | head -3 && echo \"$?\"");
  assert.deepEqual(argv, ["C:\\tools\\brush.exe", "--disable-color", "-c", "ls -la | head -3 && echo \"$?\""]);
  pass("an engine command argv is [engine, --disable-color, -c, command]");
}

// 2. The interactive argv is profile-free and interactive, matching the PTY backend's dialect default.
{
  assert.deepEqual(buildInteractiveArgv(bashEngine), ["C:\\tools\\brush.exe", "--disable-color", "--noprofile", "--norc", "-i"]);
  pass("the interactive argv is profile-free and interactive");
}

// 2b. The startup-file variant carries the same flag, and an empty path is the plain prefix.
{
  assert.deepEqual(interactiveArgsWithRcFile(bashEngine, ""), ["--disable-color", "--noprofile", "--norc", "-i"]);
  assert.deepEqual(interactiveArgsWithRcFile(bashEngine, "C:\\state\\rc.sh"), [
    "--disable-color",
    "--noprofile",
    "--rcfile",
    "C:\\state\\rc.sh",
    "-i",
  ]);
  pass("the startup-file argv replaces --norc and keeps the color flag");
}

// 3. Environment layering: defaults first, managed facts last, caller entries in between.
{
  const env = buildShellEnv({
    overrides: { PAGER: "from-overrides", EXTRA: "1" },
    env: { PAGER: "from-request", CALLER: "2", NO_COLOR: "caller" },
    dshEnv: { DSH_SESSION_ID: "s-1", NO_COLOR: "managed" },
  });
  assert.equal(env.TERM, "dumb");
  assert.equal(env.GIT_PAGER, "cat");
  assert.equal(env.EXTRA, "1");
  assert.equal(env.CALLER, "2");
  assert.equal(env.PAGER, "from-request", "the request outranks the executor overrides");
  assert.equal(env.NO_COLOR, "managed", "a managed fact outranks everything");
  assert.equal(env.DSH_SESSION_ID, "s-1");
  pass("environment layering is defaults, overrides, request, then managed facts");
}

// 3b. Several prepended directories keep the caller's priority order, and a repeat is not added twice.
{
  const env = buildShellEnv({ toolsDirs: ["C:\\tools\\bin", "C:\\shim"], basePath: "C:\\Windows" });
  assert.equal(env.PATH, "C:\\tools\\bin;C:\\shim;C:\\Windows", "the first entry of toolsDirs ends up first");
  const repeated = buildShellEnv({ toolsDirs: ["C:\\tools", "C:\\tools"], basePath: "C:\\Windows" });
  assert.equal(repeated.PATH, "C:\\tools;C:\\Windows", "a directory that is already at the front is not added again");
  const empty = buildShellEnv({ toolsDirs: ["", "C:\\shim"], basePath: "C:\\Windows" });
  assert.equal(empty.PATH, "C:\\shim;C:\\Windows", "an empty entry stands for 'nothing to prepend'");
  pass("prepended directories keep their order and cannot duplicate an entry");
}

// 4. Temp variables stay out of the executor's hands: the sandbox runner owns them.
{
  const env = buildShellEnv({});
  assert.equal(Object.hasOwn(env, "TMP"), false);
  assert.equal(Object.hasOwn(env, "TEMP"), false);
  assert.equal(Object.hasOwn(env, "TMPDIR"), false);
  const passed = buildShellEnv({ env: { TMPDIR: "/only-if-the-caller-asked" } });
  assert.equal(passed.TMPDIR, "/only-if-the-caller-asked");
  pass("temp variables are only ever set by the caller, never by this executor");
}

console.log(`\n${passed} 项通过`);
