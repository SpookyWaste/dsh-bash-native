// The tool-and-jobs integration spec: the real `bash` tool, the real job registry, and this plugin's
// executor composed in one cordis Context, driven the way the agent loop drives them.
//
// This is the evidence that this engine fits DSH's existing bash surface rather than only running bash
// scripts: `ctx.tools` (`@deepseek-ai/dsh-tools`), `ctx.jobs` (`@deepseek-ai/dsh-jobs-local`), the
// `job_output`/`job_kill` tools, the sandbox policy chain, the managed `DSH_*` environment, and the
// `bash` tool's own schema are the shipped implementations, and every command runs through the shipped
// brush artifact.
//
// Skipped only when the harness packages are absent, and then it says what to install.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import BashNativeExecutor from "../lib/index.js";
import { packageRoot, preparePackagedEngine } from "../lib/artifact.js";

// The harness packages are devDependencies, and a checkout whose install never fetched them should say so
// rather than fail as if the engine or the integration were broken.
const HARNESS = [
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-tools",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-subprocess-local",
  "@deepseek-ai/dsh-sandbox-local",
  "@deepseek-ai/dsh-session-projection",
  "@deepseek-ai/dsh-sandbox-policy",
  "@deepseek-ai/dsh-shell-env",
  "@deepseek-ai/dsh-jobs-local",
  "@deepseek-ai/dsh-tool-bash",
  "@deepseek-ai/dsh-tool-jobs",
];
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
  console.log("      they are devDependencies of this package, so `npm install` provides them");
  process.exit(0);
}

// The harness's subprocess seam opens pipes, and a confined session cannot open them at all: `spawnSync`
// fails with EPERM before the child starts. That is a property of the session and not of this engine, so the
// spec reports itself as not covered here, and it runs in an unconfined shell (and in CI).
{
  const probe = spawnSync(process.execPath, ["-e", "0"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  if (probe.error !== undefined) {
    console.log(`SKIP  this session cannot open pipes (${probe.error.code ?? probe.error.message}), so the tool-and-jobs integration is not covered here`);
    process.exit(0);
  }
}
const [cordis, toolsModule, systemPromptModule, subprocessModule, sandboxModule, projectionsModule, policyModule, shellEnvModule, jobsModule, toolBashModule, toolJobsModule] = loaded;
const { Context } = cordis;
const ToolRuntime = toolsModule.default;
const SystemPrompt = systemPromptModule.default;
const LocalSubprocessRuntime = subprocessModule.default;
const LocalSandboxProvider = sandboxModule.default;
const SessionProjectionRegistry = projectionsModule.default;
const SandboxPolicy = policyModule.default;
const ShellEnv = shellEnvModule;
const LocalJobRegistry = jobsModule.default;
const ToolBash = toolBashModule;
const ToolJobs = toolJobsModule;

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const WORKSPACE = process.cwd();
const packaged = preparePackagedEngine({ packageRoot: packageRoot(), env: process.env });
if (!("ready" in packaged)) {
  console.log("SKIP  the packaged engine is not prepared: " + packaged.refused);
  console.log("      run `node scripts/build-engine.mjs --refresh` or check engine.lock.json");
  process.exit(0);
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Compose the shipped chain plus this executor.
 *
 * Unconfined by default so the subject is the tool/job path; `confine: true` adds the real
 * `windows-acl` confinement through the shipped sandbox provider, which the schema case needs.
 */
async function compose({ confine = false } = {}) {
  const ctx = new Context();
  ctx.plugin(ToolRuntime);
  ctx.plugin(SystemPrompt);
  ctx.plugin(LocalSubprocessRuntime);
  ctx.plugin(LocalSandboxProvider, { workspaceRoot: WORKSPACE });
  ctx.plugin(SessionProjectionRegistry);
  ctx.plugin(SandboxPolicy, { mode: "workspace-write", workspaceRoot: WORKSPACE });
  ctx.plugin(ShellEnv);
  ctx.plugin(LocalJobRegistry);
  ctx.plugin(BashNativeExecutor, { confine, bashPath: packaged.ready });
  ctx.plugin(ToolBash);
  ctx.plugin(ToolJobs);
  await settle();
  assert.notEqual(ctx.get("shell"), undefined, "this plugin provides the shell seam");
  assert.notEqual(ctx.get("tools"), undefined, "the tool runtime is composed");
  assert.notEqual(ctx.get("jobs"), undefined, "the job registry is composed");
  return ctx;
}

/** One tool call, the way the runtime dispatches it. */
const caller = (ctx) => {
  let counter = 0;
  return (name, args) => ctx.tools.execute({
    callId: `spec-${++counter}`,
    name,
    arguments: args,
    signal: new AbortController().signal,
  });
};

/** The text a tool result renders to the model. */
const text = (result) => (result?.content ?? []).map((block) => block.text ?? "").join("");

/** A `bash` call with the description the shipped schema requires. */
const bash = (run, command, extra = {}) => run("bash", { command, description: "spec call", ...extra });

// 1. The shipped tool registers a `bash` tool that runs this engine, and each call is a fresh shell:
// state does not survive, and `workdir` decides the working directory.
{
  const ctx = await compose();
  const run = caller(ctx);
  assert.equal((ctx.tools.schemas() ?? []).some((schema) => schema.name === "bash"), true, "the bash tool is registered");
  assert.equal(text(await bash(run, "echo hi")).trim(), "hi");
  await bash(run, "x=1");
  assert.equal(text(await bash(run, 'echo "${x:-unset}"')).trim(), "unset", "each call is a fresh shell");
  const workdir = text(await bash(run, "pwd", { workdir: WORKSPACE })).trim();
  assert.equal(workdir.toLowerCase(), WORKSPACE.toLowerCase(), "workdir is honored");
  pass("the shipped bash tool runs this engine with fresh-shell semantics and a honored workdir");
}

// 2. `run_in_background` registers the process with the shipped job registry, `job_output` reads it,
// and the output arrives after the command finishes.
{
  const ctx = await compose();
  const run = caller(ctx);
  const started = text(await bash(run, "sleep 1; echo late", { run_in_background: true }));
  const jobs = ctx.jobs.list();
  assert.equal(jobs.length, 1, "exactly one job is registered");
  assert.match(started, /bash-\d+/, "the tool reports the job id it registered");
  assert.equal(jobs[0].id.includes("bash-"), true, "the registry uses the bash job ids");
  assert.equal(jobs[0].status, "running", "the job is running in the registry");
  assert.equal(jobs[0].kind, "bash", "the registry records the producer kind the tool registered");
  assert.match(jobs[0].label ?? "", /sleep 1/, "the registry carries a label for the command");
  await settle(1500);
  const read = text(await run("job_output", { job_id: jobs[0].id }));
  assert.match(read, /late/, `the finished job's output is readable: ${read}`);
  pass("a background call becomes a registry job whose output the job tools can read");
}

// 3. `job_kill` stops a long background command through the shipped registry.
{
  const ctx = await compose();
  const run = caller(ctx);
  await bash(run, "sleep 30", { run_in_background: true });
  const job = ctx.jobs.list()[0];
  assert.notEqual(job, undefined, "the long job is registered");
  const killed = text(await run("job_kill", { job_id: job.id }));
  await settle(600);
  const after = ctx.jobs.list().find((entry) => entry.id === job.id);
  assert.equal(after?.status === "running", false, `the job is no longer running (${killed})`);
  pass("job_kill stops a long background command registered by the shipped registry");
}

// 4. A foreground call that reaches its timeout is promoted to a job instead of being killed, which is
// the shipped tool's documented `promoteOnTimeout` behavior — and the command keeps running.
{
  const ctx = await compose();
  const run = caller(ctx);
  const answer = text(await bash(run, "sleep 2; echo promoted", { timeoutMs: 500 }));
  assert.match(answer, /bash-\d+/, `the timeout returns a job id rather than killing the command: ${answer}`);
  const job = ctx.jobs.list()[0];
  assert.notEqual(job, undefined, "the promoted command is a registry job");
  assert.equal(job.status, "running", "it kept running after the foreground wait expired");
  await settle(2500);
  assert.match(text(await run("job_output", { job_id: job.id })), /promoted/, "its output is still delivered");
  pass("a foreground timeout promotes the command to a job instead of killing it");
}

// 5. The managed `DSH_*` environment reaches the engine: the tool collects it per call and the executor
// layers it onto the child's environment.
{
  const ctx = await compose();
  ctx.shellEnv.register({
    name: "spec-contributor",
    variables: { DSH_SPEC_PROBE: { description: "value supplied by this test" } },
    resolve: () => ({ DSH_SPEC_PROBE: "from-the-registry" }),
  });
  const run = caller(ctx);
  assert.equal(text(await bash(run, 'echo "$DSH_SPEC_PROBE"')).trim(), "from-the-registry");
  assert.equal(text(await bash(run, 'echo "$DSH_BASH_SPEC_ABSENT"')).trim(), "", "nothing else is invented");
  pass("a registered DSH_* environment fact reaches the command through the tool and the executor");
}

// 6. The tool's schema follows what the executor reports: the escalation fields appear only when this
// executor confines, because only then is a mode there to escalate from.
{
  const plain = await compose({ confine: false });
  const confined = await compose({ confine: true });
  const fields = (ctx) => {
    const schema = (ctx.tools.schemas() ?? []).find((entry) => entry.name === "bash");
    assert.notEqual(schema, undefined, "the bash schema is projected");
    return Object.keys(schema.parameters?.properties ?? {});
  };
  assert.equal(fields(plain).includes("sandbox_permissions"), false, "an unconfined executor offers no escalation");
  assert.equal(fields(confined).includes("sandbox_permissions"), true, "a confining executor exposes the escalation field");
  assert.equal(fields(confined).includes("justification"), true, "and its justification");
  assert.equal(confined.get("shell").sandboxMode, "workspace-write", "the reported mode is the configured one");
  assert.equal(plain.get("shell").sandboxMode, undefined, "an unconfined executor reports no mode");
  pass("the bash schema's escalation fields follow the sandbox mode this executor reports");
}

console.log(`\n${passed} 项通过`);