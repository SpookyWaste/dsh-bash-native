// The PTY integration spec: the shipped bash backend over this package's brush engine, driven the way
// `@deepseek-ai/dsh-tool-terminal` drives it.
//
// This is the evidence behind the interactive terminal component's claim — that `terminal_open` opens a
// POSIX bash on Windows and that state survives across sends. The backend is the shipped
// `@deepseek-ai/dsh-terminal-bash` (`BashTerminalBackend`), so readiness detection, the OSC prompt
// marker, scrollback bounding and teardown are all the real implementation; only the agent registry and
// the terminal service above it are left out, because both exist to fence ownership rather than to run
// the shell.
//
// Skipped, never faked, in two situations: harness packages this checkout did not install, and a session
// that cannot allocate a ConPTY pipe (the confined-session case, which fails with EPERM before the child
// starts — a property of the session, not of this engine).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageRoot, preparePackagedEngine } from "../lib/artifact.js";
import { interactiveArgsWithRcFile } from "../lib/argv.js";
import { resolveEngine } from "../lib/resolve.js";
import { readBrushVersion } from "../lib/verify.js";

const HARNESS = ["@deepseek-ai/cordis", "@deepseek-ai/dsh-terminal", "@deepseek-ai/dsh-terminal-bash", "@deepseek-ai/dsh-subprocess-local"];
const loaded = [];
for (const name of HARNESS) {
  try {
    loaded.push(await import(name));
  } catch {
    loaded.push(null);
  }
}
const missing = HARNESS.filter((_name, index) => loaded[index] === null);
if (missing.length > 0) {
  console.log(`SKIP  the harness packages are not installed: ${missing.join(", ")}`);
  console.log("      they are dependencies of this package, so `npm install` provides them");
  process.exit(0);
}

/**
 * The file-effect mode this run opens its session under.
 *
 * Unconfined by default, because confinement is the sandbox provider's subject and `test-executor.mjs`
 * owns it. `DSH_BASH_NATIVE_PTY_MODE=workspace-write` promotes this run instead, which is how the other
 * half gets measured: a confined session wraps the engine in the sandbox runner, and whether *that*
 * starts is a property of the runner, the engine's location and the policy rather than of the engine.
 */
const MODE = process.env.DSH_BASH_NATIVE_PTY_MODE ?? "danger-full-access";

/** The two providers a confined mode needs on top of the subprocess provider. */
const SANDBOX = MODE === "danger-full-access" ? null : await Promise.all(
  ["@deepseek-ai/dsh-sandbox-local", "@deepseek-ai/dsh-sandbox-policy"].map((name) => import(name).catch(() => null)),
);

// `spawnSync` over pipes is the cheapest proof that this session can allocate the handles a terminal
// needs; a confined session fails it with EPERM, exactly as it fails ConPTY allocation later.
{
  const probe = spawnSync(process.execPath, ["-e", "0"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  if (probe.error !== undefined) {
    console.log(`SKIP  this session cannot open pipes (${probe.error.code ?? probe.error.message}), so PTY integration is not covered here`);
    process.exit(0);
  }
}

const [cordisModule, terminalModule, terminalBashModule, subprocessModule] = loaded;
const { Context } = cordisModule;
const BashTerminalBackend = terminalBashModule.BashTerminalBackend;
const LocalSubprocessRuntime = subprocessModule.default;

// The engine is resolved exactly as the executor resolves it: the packaged artifact, verified against
// `engine.lock.json`. A spec that hard-coded a path would stop testing the composition the moment the
// artifact moved.
const resolution = resolveEngine(
  { bashPath: "", bundledEngineDir: "", packaged: preparePackagedEngine({ packageRoot: packageRoot(), env: process.env }) },
  process.env,
  process.platform,
  { isFile: (path) => existsSync(path) },
  (path) => readBrushVersion(path),
);
if (resolution.engine === null) {
  console.log(`SKIP  no engine resolved, so there is nothing to open a terminal on:\n${resolution.failure ?? ""}`);
  process.exit(0);
}

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-pty-"));
const WORKSPACE = process.cwd();

/** The interactive argv the preset's PTY row hands this backend. The rc file is left empty, so this
 * spec covers the engine's own startup rather than a machine's generated toolchain file. */
const shellArgs = interactiveArgsWithRcFile(resolution.engine, "")
console.log(`engine: ${resolution.engine.path}`);
console.log(`argv:   ${JSON.stringify(shellArgs)}`);
console.log(`mode:   ${MODE}`);

// The subprocess provider is the shipped one, because PTY allocation is exactly what this spec is
// about. Everything above it is stubbed to the two facts this backend reads: the shared policy and the
// session's directory. A confined mode additionally needs a sandbox provider, mounted only for that run.
const ctx = new Context();
ctx.plugin(LocalSubprocessRuntime);
if (SANDBOX !== null) {
  if (SANDBOX.some((module) => module === null)) {
    console.log(`SKIP  ${MODE} needs @deepseek-ai/dsh-sandbox-local and @deepseek-ai/dsh-sandbox-policy, which are not installed here`);
    process.exit(0);
  }
  ctx.plugin(SANDBOX[0].default, { workspaceRoot: FIXTURE });
  ctx.plugin(SANDBOX[1].default, { mode: MODE, workspaceRoot: FIXTURE });
}
await new Promise((resolve) => setTimeout(resolve, 400));
assert.notEqual(ctx.subprocess, undefined, "the shipped subprocess provider is composed");
if (SANDBOX !== null) {
  assert.notEqual(ctx.get("sandbox"), undefined, `a sandbox provider is composed for ${MODE}`);
}

const stubCtx = {
  subprocess: ctx.subprocess,
  sandboxPolicy: { resolve: () => ({ mode: MODE, workspaceRoot: FIXTURE }) },
  workingDirectory: { ensure: async () => FIXTURE },
  get: (name) => (name === "sandbox" ? ctx.get("sandbox") : undefined),
};

const backend = new BashTerminalBackend(
  stubCtx,
  terminalBashModule.Config({
    backendType: "shell",
    shellDialect: "bash",
    shellPath: resolution.engine.path,
    shellArgs,
  }),
);
/**
 * An owner stand-in carrying exactly what the backend reads from one: the session it resolves the
 * sandbox policy for, the id it puts in the environment, and the context it attaches its
 * sandbox-mode fence to. Ownership fencing itself belongs to the terminal service, which needs a
 * live agent registry and is therefore outside this spec.
 */
const owner = {
  id: "test-terminal-pty",
  session: "test-terminal-pty-session",
  ctx: { on: () => () => undefined, effect: () => () => undefined },
};

/** Retire the provider subtree and the fixture, whatever the spec decided to do. */
async function teardown() {
  await ctx.fiber.dispose();
  rmSync(FIXTURE, { recursive: true, force: true });
}

let session;
try {
  session = await backend.spawn({ type: "shell", sessionId: "test-terminal-pty-1", owner, cwd: FIXTURE });
} catch (error) {
  const code = error?.code ?? error?.spawnError?.code ?? error?.cause?.code;
  if (code === "EPERM") {
    console.log("SKIP  this session cannot allocate a ConPTY pipe (EPERM), so PTY integration is not covered here");
    await teardown();
    process.exit(0);
  }
  throw error;
}

/**
 * Assertions, then teardown, then an explicit exit.
 *
 * The exit is load-bearing and not a shortcut: after the shell is closed and the provider subtree is
 * disposed, the PTY transport still holds a message port and a pipe that keep the event loop alive with
 * no work left to do, so a spec that ended by falling off the end would hang instead of reporting. The
 * status is carried out of the block rather than assumed, so a failing assertion still exits non-zero.
 */
let failure = null;
/** Send one submitted line and settle, the way the terminal tools drive a foreground send. */
async function send(text) {
  const operation = session.startSend({ text, submit: true });
  const result = await operation.done;
  return { ...result, output: operation.readOutput().delta };
}

try {
  assert.ok(session.pid !== undefined, "the backend reports the shell's process id");
  assert.match(session.motd, /dsh>/, `startup settles on the controlled prompt: ${JSON.stringify(session.motd)}`);
  pass("the shipped backend spawns a brush-backed session and settles on its controlled prompt");

  const first = await send("echo ready-$((6*7))");
  assert.match(first.output, /ready-42/, `the first send round-trips through the engine: ${JSON.stringify(first.output)}`);
  assert.notEqual(first.waitReason, "timeout", "a settled send is not a timeout");
  pass("a send reaches readiness and returns the command's output");

  await send("BRUSH_MARK=persisted");
  const readBack = await send("echo mark=$BRUSH_MARK");
  assert.match(readBack.output, /mark=persisted/, `state survives across sends: ${JSON.stringify(readBack.output)}`);
  pass("shell state survives across sends, which is the capability the component exists for");

  // The engine identifies itself as bash, which is the claim the preset's tool description makes.
  const version = await send("echo $BASH_VERSION");
  assert.match(version.output, /\d+\.\d+/, `the engine reports a bash version: ${JSON.stringify(version.output)}`);
  pass("the engine in the session is bash and reports its version");

  // A non-zero status is reported by the prompt marker rather than by parsing output.
  const failed = await send("false");
  assert.notEqual(failed.waitReason, "timeout");
  pass("a failing command still returns the session to readiness");

  // Retained scrollback is a separate read path from a send's returned output.
  const page = session.read({});
  assert.ok(page.text.includes("mark=persisted"), `retained output is readable without sending input: ${JSON.stringify(page.text.slice(-120))}`);
  pass("the retained scrollback is readable independently of a send");

  // Signals reach the foreground process group through the provider, not by writing control bytes.
  const signalled = await session.signal("SIGINT");
  assert.equal(signalled.delivered, true, "the foreground process group accepts a signal");
  pass("a signal is delivered to the terminal's foreground process group");

  // A session that exits settles the next send as `session_exit` instead of hanging.
  const bye = await send("exit 7");
  assert.equal(bye.waitReason, "session_exit", `the shell's exit settles the send: ${JSON.stringify(bye.waitReason)}`);
  pass("the shell's exit settles the active send as a session exit rather than a timeout");
} catch (error) {
  failure = error;
} finally {
  await session.close("test complete").catch(() => undefined);
  await teardown();
}

if (failure === null) console.log(`\n${passed} 项通过`);

// The PTY transport outlives its session: after the shell is closed and the provider subtree is
// disposed, node-pty's conout connection still holds a message port and a pipe, which keep the event
// loop alive with no work left to do. Every assertion has run and the engine is gone by this point, so
// the spec leaves explicitly instead of waiting on handles that belong to the transport — carrying the
// verdict out, so a failing assertion still reports itself as a failure.
if (failure !== null) {
  console.error(failure);
  process.exit(1);
}
process.exit(0);
