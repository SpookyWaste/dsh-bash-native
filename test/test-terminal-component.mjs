// The interactive terminal component's composition spec.
//
// The component is one Loader entry that has to bring up four children in one isolated `shell` realm:
// this bundle's executor, the harness's terminal registry, its bash PTY backend and its six
// `terminal_*` tools. What this spec pins is the part the patch file cannot show — that mounting the
// entry produces a registry carrying a `shell` backend and a runtime that receives all six tool names,
// and that disposal takes both away again — because a component that mounts without contributing them
// would present to the user as a switch that silently does nothing.
//
// It needs no PTY, so unlike `test-terminal-pty.mjs` it runs everywhere, a confined session included.
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import { readFileSync } from "node:fs";
import LocalSandboxProvider from "@deepseek-ai/dsh-sandbox-local";
import SandboxPolicy from "@deepseek-ai/dsh-sandbox-policy";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import LocalSubprocessRuntime from "@deepseek-ai/dsh-subprocess-local";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { TERMINAL_TOOL_NAMES } from "../lib/entries.js";
import { findEngine } from "../scripts/engine-harness.mjs";
import * as component from "../lib/terminal.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

/** Let a fiber's registrations settle, the way the sibling integration specs do. */
const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mount the component on a host plane that carries only a tool runtime.
 *
 * Everything else the children need (`sandboxPolicy`, `subprocess`, `workingDirectory`) is inherited
 * from the root scope in a real deployment, and the component must not depend on being handed any of
 * them here: the point of the isolate is that the component brings its own `shell`.
 * @returns the live context, the tool names the runtime accepted, and the fiber to dispose; or `null`
 *   when a child cannot be resolved in this checkout.
 */
async function compose() {
  const ctx = new Context();
  // The host plane this component is written against: the prompt service the tool runtime injects, and
  // the three services the PTY backend injects that a real deployment keeps on the root plane. Nothing
  // the component owns is provided here.
  ctx.plugin(SystemPrompt);
  ctx.plugin(ToolRuntime);
  ctx.plugin(LocalSubprocessRuntime);
  ctx.plugin(LocalSandboxProvider, { workspaceRoot: process.cwd() });
  ctx.plugin(SandboxPolicy, { mode: "workspace-write", workspaceRoot: process.cwd() });
  ctx.plugin(SessionProjectionRegistry);
  await settle();

  const tools = ctx.get("tools");
  assert.notEqual(tools, undefined, "the tool runtime is composed");
  const seen = [];
  const original = tools.register.bind(tools);
  tools.register = (definition) => {
    seen.push(definition.name);
    return original(definition);
  };

  try {
    const fiber = ctx.plugin(component, { runInBackground: true });
    await fiber;
    await settle();
    return { ctx, seen, fiber };
  } catch (error) {
    // A checkout whose install skipped one of the harness packages says so rather than failing as if the
    // component were broken; `test-terminal-pty.mjs` covers the same backend where those packages exist.
    const reason = error instanceof Error ? error.message : String(error);
    if (/Cannot find package|ERR_MODULE_NOT_FOUND/.test(reason)) {
      console.log(`SKIP  the interactive terminal component's children are not installed here: ${reason.split("\n")[0]}`);
      return null;
    }
    throw error;
  }
}

const composed = await compose();

if (composed === null) {
  console.log("\n0 项通过（组件未安装齐全，见上面的 SKIP）");
} else {
  const { ctx, seen, fiber } = composed;

  // 1. The registry exists and carries the one backend the six tools open sessions through.
  const terminals = ctx.get("terminals");
  assert.notEqual(terminals, undefined, "the component mounts a terminal registry of its own");
  assert.deepEqual(terminals.listBackends(), ["shell"], "and registers the backend type the tools name");
  pass("mounting the component yields a terminal registry carrying its shell backend");

  // 2. The six names reach the tool runtime. This is the end of the chain the component owns: the names
  // and their schemas belong to the harness's tool package, and what this asserts is that the component
  // actually mounted it rather than only the registry underneath it.
  for (const toolName of TERMINAL_TOOL_NAMES) {
    assert.ok(seen.includes(toolName), `${toolName} is registered by the component (saw: ${seen.join(", ") || "nothing"})`);
  }
  pass("all six terminal tool names are registered by the component");

  // 3. The component keeps its executor to itself. `shell` is provided on the component's own isolated
  // scope, so the host plane must not see it: a second provider on the same plane would displace whatever
  // else provides one, and every composition that provides `shell` — the shipped presets and this
  // bundle's own presets — isolates it for exactly that reason.
  assert.equal(ctx.get("shell"), undefined, "the executor does not leak onto the host plane");
  pass("the executor stays inside the component's isolated scope");

  // 4. The engine actually reached the backend. `shellPath` is a deferred expression reading the executor
  // mounted on the previous iteration, so reaching a *registered* backend already proves the interpolation
  // step ran against a scope that had the executor: without interpolation the backend's validator rejects
  // the raw expression node, and against the wrong scope the path would be empty and the same validator
  // rejects that too. What is asserted here is the other half — that this package resolves a real engine
  // to put in that path, so the component is not being handed an empty string in a deployment.
  const enginePath = findEngine();
  assert.ok(enginePath !== null, "this package resolves a brush engine to hand the component's backend");
  assert.match(enginePath, /brush\.exe$/i, `the resolved engine is this package's artifact (got ${JSON.stringify(enginePath)})`);
  pass("this package resolves the brush engine the component hands its backend");

  // 5. Disposal takes the registry and the tools with it, which is what makes the switch a switch.
  await fiber.dispose();
  assert.equal(ctx.get("terminals"), undefined, "disposal removes the registry");
  assert.equal(ctx.get("shell"), undefined, "and the executor");
  pass("disposing the component unregisters its registry and executor");

  // 6. The manifest publishes no copy of the three packages, and the copies a checkout resolves agree on
  // one harness line. Both halves guard the same failure: a second copy from another line keeps the tools
  // visible while the backend drives a sandbox and subprocess contract it was not built against, which
  // surfaces as every `terminal_open` failing rather than as anything a version check would report.
  {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const terminalPackages = ["@deepseek-ai/dsh-terminal", "@deepseek-ai/dsh-terminal-bash", "@deepseek-ai/dsh-tool-terminal"];
    for (const name of terminalPackages) {
      assert.equal(manifest.dependencies?.[name], undefined, `${name} must not be a runtime dependency: installing a copy is what creates the skew`);
      assert.equal(manifest.peerDependencies?.[name] !== undefined, true, `${name} is a peer the host provides`);
    }
    const versions = terminalPackages.map((name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8")));
    assert.equal(new Set(versions.map((pkg) => pkg.version)).size, 1, `the resolved terminal packages come from one line (${versions.map((pkg) => pkg.version).join(", ")})`);
    // The backend and the tools each pin the harness packages they were compiled against in lockstep, so
    // their pins agreeing is the machine check that one line is in play.
    const pinOf = (pkg, name) => pkg.peerDependencies?.[name];
    assert.equal(
      pinOf(versions[1], "@deepseek-ai/dsh-terminal"),
      pinOf(versions[2], "@deepseek-ai/dsh-terminal"),
      "the backend and the tools pin the same terminal package version",
    );
    assert.equal(pinOf(versions[0], "@deepseek-ai/dsh-agent"), pinOf(versions[1], "@deepseek-ai/dsh-agent"), "and the same agent version");
    pass("no copy of the terminal packages is published, and the resolved copies agree on one harness line");
  }

  console.log(`\n${passed} 项通过`);
}
