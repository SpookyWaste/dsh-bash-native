// Behaviour checks for the preset composition and the registration entry: which rows a given host
// gets, what the entry asks that host before deciding, and what it leaves behind when it goes away.
//
// The composition is pure data plus one host fact, so every claim here is a claim about a host shape:
// the newest harness line (all gates), the older one (no reminder tools), and a host that cannot
// answer at all. `test-preset-parity.mjs` owns the other half — that the mirror still matches the
// shipped presets — and `test-patch.mjs` owns the bundle-patch shape that mounts this entry.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Config, apply, inject, name, probeHostPackages } from "../lib/presets.js";
import {
  PRESET_IDS,
  TIME_CONTEXT_PACKAGE,
  TOOL_SCHEDULE_PACKAGE,
  composePreset,
  gatePackages,
} from "../lib/preset-data.js";

let passed = 0;
function pass(label) {
  passed += 1;
  console.log("PASS  " + label);
}

const root = fileURLToPath(new URL("..", import.meta.url));
/** Every gate open: the harness line that ships both packages this bundle can add rows from. */
const ALL_GATES = new Set([TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE]);
/** No gate open: the older line, and the shape a host that cannot answer produces. */
const NO_GATES = new Set();
/** Only the clock: the measured 0.2.0-rc.2 desktop line. */
const CLOCK_ONLY = new Set([TIME_CONTEXT_PACKAGE]);

const SCHEDULE_TOOLS = ["schedule_create", "schedule_delete", "schedule_list", "schedule_update"];
/** Rows that register the tool name `bash`, so exactly one of them may be enabled. */
const BASH_TOOL_ROWS = ["@deepseek-ai/dsh-tool-bash", "@deepseek-ai/dsh-tool-bash-persistent"];

const rowsOf = (definition) => definition.plugins;
const groupOf = (definition, id) => rowsOf(definition).find((row) => row.id === id);
/** All rows of a composition, groups included, as id -> row. */
function rowIndex(definition) {
  const index = new Map();
  const walk = (rows) => {
    for (const row of rows) {
      index.set(row.id, row);
      if (Array.isArray(row.config)) walk(row.config);
    }
  };
  walk(rowsOf(definition));
  return index;
}
/** The two enabled subagent providers, whose configuration carries the reminder-tool denial. */
const subagentsOf = (definition) =>
  groupOf(definition, "delegation").config.filter(
    (row) => row.name === "@deepseek-ai/dsh-tool-subagent" && row.disabled !== true,
  );

// 1. The ids are the pinned ones, and the entry declares the registry dependency it needs.
{
  assert.deepEqual(PRESET_IDS, ["bash-native", "bash-native-minimal"]);
  assert.equal(name, "bash-native-presets");
  assert.deepEqual(inject, ["agentPresets"], "the entry waits for the registry instead of probing for it");
  for (const id of PRESET_IDS) {
    const definition = composePreset(id, ALL_GATES);
    assert.equal(definition.id, id);
    assert.match(definition.name, /Bash/);
    assert.match(definition.description, /brush/, "each preset names the engine this bundle ships");
    assert.doesNotMatch(definition.description, /Git Bash|MSYS2|Cygwin|WSL/);
  }
  assert.deepEqual(
    PRESET_IDS.map((id) => composePreset(id, ALL_GATES).order),
    [5, 6],
    "the two presets keep their roster order",
  );
  pass("both presets compose under the ids sessions have pinned, with the registry as a declared dependency");
}

// 2. The gates are declared per preset, and only the full preset has any.
{
  assert.deepEqual(gatePackages("bash-native"), [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE]);
  assert.deepEqual(gatePackages("bash-native-minimal"), [], "the lean preset mirrors a preset with no host additions");
  pass("only the full preset declares host-dependent rows, one gate per package");
}

// 3. A host that ships both packages gets both rows, in the shipped preset's order, and the denial.
{
  const definition = composePreset("bash-native", ALL_GATES);
  const ids = rowsOf(definition).map((row) => row.id);
  assert.equal(ids.indexOf("time-context"), ids.indexOf("agent-instructions") + 1, "the clock follows agent-instructions");
  assert.equal(ids.indexOf("tool-schedule"), ids.indexOf("tool-jobs") + 1, "the reminder tools follow tool-jobs");
  for (const subagent of subagentsOf(definition)) {
    assert.deepEqual(
      subagent.config.toolFilter?.deny,
      SCHEDULE_TOOLS,
      `${subagent.id} denies the reminder tools, as the shipped preset does`,
    );
  }
  // 0.2.1-alpha.2 dropped the disabled provider rows this mirror used to carry (`tool-subagent-codex`,
  // `tool-subagent-claude-code`) along with `tool-ralph`, so the group now declares only live rows.
  const delegation = groupOf(definition, "delegation").config;
  assert.deepEqual(
    delegation.filter((row) => row.disabled === true),
    [],
    "no disabled provider rows remain: the shipped preset dropped them",
  );
  assert.deepEqual(
    delegation.map((row) => row.id),
    ["tool-subagent-control", "tool-subagent-list-agents", "tool-subagent", "tool-subagent-fork", "workflow-ptc", "tool-workflow"],
    "the delegation group carries exactly the rows the shipped preset declares",
  );
  pass("a host shipping both packages gets both rows in order, and the two enabled subagents lose the reminder tools");
}

// 4. A host that ships neither gets neither row and no denial, and nothing else moves.
{
  const full = composePreset("bash-native", ALL_GATES);
  const bare = composePreset("bash-native", NO_GATES);
  const ids = rowsOf(bare).map((row) => row.id);
  assert.equal(ids.includes("time-context"), false);
  assert.equal(ids.includes("tool-schedule"), false);
  assert.equal(
    subagentsOf(bare).some((row) => row.config.toolFilter !== undefined),
    false,
    "without the reminder tools there is nothing to deny",
  );
  assert.equal(rowsOf(bare).length, rowsOf(full).length - 2, "exactly the two host-dependent rows are missing");
  // Everything else is the same rows with the same order: gating adds and amends, it never rewrites.
  const stripped = structuredClone(rowsOf(full)).filter((row) => !["time-context", "tool-schedule"].includes(row.id));
  for (const row of stripped) {
    const children = Array.isArray(row.config) ? row.config : undefined;
    if (children !== undefined) for (const child of children) delete child.config?.toolFilter;
  }
  assert.deepEqual(bare.plugins, stripped, "the host-dependent parts are the only difference");
  pass("a host shipping neither package gets neither row, no denial, and an otherwise identical composition");
}

// 5. The measured desktop line: the clock ships, the reminder tools do not.
{
  const desktop = composePreset("bash-native", CLOCK_ONLY);
  const ids = rowsOf(desktop).map((row) => row.id);
  assert.ok(ids.includes("time-context"));
  assert.equal(ids.includes("tool-schedule"), false);
  assert.equal(subagentsOf(desktop).some((row) => row.config.toolFilter !== undefined), false);
  pass("the older harness line keeps the clock and drops exactly the reminder tools");
}

// 6. Composition is a pure function of the host facts.
{
  const first = composePreset("bash-native", NO_GATES);
  const second = composePreset("bash-native", ALL_GATES);
  const third = composePreset("bash-native", NO_GATES);
  assert.deepEqual(first.plugins, third.plugins, "the same host facts compose the same rows");
  assert.equal(rowsOf(second).length, rowsOf(first).length + 2, "and a richer host is unaffected by the earlier call");
  assert.equal(first.plugins.some((row) => row.id === "tool-schedule"), false);
  pass("composing one host shape never changes what another host shape composes");
}

// 7. Every row is named the way the registry's base can resolve it.
{
  for (const id of PRESET_IDS) {
    const index = rowIndex(composePreset(id, ALL_GATES));
    for (const [rowId, row] of index) {
      if (row.name === "cordis:group") continue;
      assert.ok(
        String(row.name).startsWith("@deepseek-ai/") || String(row.name).startsWith("file:"),
        `${id}/${rowId} names a harness package or a URL, not a bare package the harness install cannot see`,
      );
    }
  }
  // This bundle's own rows cannot be named by package: the registry resolves them from the harness
  // installation, which never carries this package. A URL computed from this module's location can.
  for (const id of PRESET_IDS) {
    const index = rowIndex(composePreset(id, ALL_GATES));
    const own = [...index.values()].filter((row) => String(row.name).startsWith("file:"));
    assert.equal(own.length, 1, `${id} names its own executor exactly once`);
    assert.equal(own[0].id, "bash-native");
    assert.equal(own[0].name, new URL("../lib/index.js", import.meta.url).href, "and points at this package's entry point");
    assert.equal(own[0].config.confine, true, "the shipped preset confines by default");
    assert.equal(
      own[0].config.requireEngineOnLoad,
      true,
      "the preset ships the engine, so a broken install fails at load rather than at every call",
    );
    assert.equal(own[0].config.promptDetail, undefined, "no shape key: the contract no longer varies");
    assert.equal(own[0].config.engine, undefined, "no engine family: brush is the only one");
  }
  pass("every row is named for the base it resolves from, and this bundle's own executor is a URL into this package");
}

// 8. The shell group is the realm contract, and exactly one row may register the tool name `bash`.
{
  for (const [id, groupId] of [["bash-native", "bash-native-shell"], ["bash-native-minimal", "bash-native-shell-minimal"]]) {
    const definition = composePreset(id, ALL_GATES);
    const group = groupOf(definition, groupId);
    assert.equal(group.name, "cordis:group");
    assert.equal(group.group, true);
    assert.deepEqual(group.isolate, { shell: true, terminals: true }, `${id} isolates the realm's executor and terminals`);
    for (const required of ["@deepseek-ai/dsh-terminal", "@deepseek-ai/dsh-terminal-bash"]) {
      assert.ok(group.config.some((row) => row.name === required), `${id} mounts ${required} in the realm`);
    }
    const enabled = group.config.filter((row) => BASH_TOOL_ROWS.includes(row.name) && row.disabled !== true);
    assert.deepEqual(
      enabled.map((row) => row.name),
      [id === "bash-native" ? "@deepseek-ai/dsh-tool-bash" : "@deepseek-ai/dsh-tool-bash-persistent"],
      `${id} enables exactly one bash tool`,
    );
    const declared = group.config.filter((row) => BASH_TOOL_ROWS.includes(row.name));
    assert.equal(declared.length, id === "bash-native" ? 2 : 1, `${id} declares every bash tool it swaps between`);
    const persistent = declared.find((row) => row.name === "@deepseek-ai/dsh-tool-bash-persistent");
    assert.match(persistent.config.description, /persistent bash shell/);
    assert.match(persistent.config.description, /not PowerShell/, "the tool tells the model which dialect it speaks");
    assert.match(persistent.config.description, /stty` does not exist/, "and what this engine cannot do");
    assert.match(persistent.config.description, /very large amount of output/);
  }
  pass("each preset owns one realm group with exactly one enabled bash tool in it");
}

// 9. The PTY row defers to the realm's executor, and it keeps the Loader's expression form.
{
  const group = groupOf(composePreset("bash-native", ALL_GATES), "bash-native-shell");
  const pty = group.config.find((row) => row.name === "@deepseek-ai/dsh-terminal-bash");
  assert.deepEqual(pty.inject, ["shell"], "the row waits for the realm executor before its expression resolves");
  assert.equal(pty.config.shellDialect, "bash");
  assert.equal(pty.config.backendType, "shell");
  assert.deepEqual(Object.keys(pty.config.shellPath), ["__jsExpr"], "a `!!js` node, as the Loader recognizes one");
  assert.match(pty.config.shellPath.__jsExpr, /ctx\.get\('shell'\)\?\.enginePath/);
  assert.match(pty.config.shellArgs.__jsExpr, /ctx\.get\('shell'\)\?\.engineArgs/);
  assert.ok(pty.config.timeoutMs > 0);
  pass("the PTY row resolves the realm engine path and its interactive argv through one deferred expression");
}

// 10. Neither preset can hand PowerShell text to a bash engine.
{
  for (const id of PRESET_IDS) {
    const index = rowIndex(composePreset(id, ALL_GATES));
    assert.equal(
      [...index.values()].some((row) => String(row.name).includes("tool-pwsh")),
      false,
      `${id} declares no PowerShell tool`,
    );
  }
  pass("neither preset declares a PowerShell tool");
}

// 11. The lean preset mirrors the shipped `minimal` surface: a persona and one persistent shell.
{
  const minimal = composePreset("bash-native-minimal", ALL_GATES);
  assert.deepEqual(
    rowsOf(minimal).map((row) => row.id),
    ["persona", "bash-native-shell-minimal"],
    "the lean preset adds no other top-level row",
  );
  const persona = rowsOf(minimal).find((row) => row.id === "persona");
  assert.equal(persona.name, "@deepseek-ai/dsh-persona");
  assert.equal(persona.config.complete, true, "the lean persona replaces the default one");
  assert.equal(persona.config.includeRuntimeContext, false);
  assert.equal(
    rowsOf(minimal).some((row) => row.id === "time-context"),
    false,
    "the shipped minimal preset carries no clock, so neither does this one",
  );
  pass("the lean preset stays a persona and one persistent shell, with no host-dependent rows");
}

// 12. The full preset keeps the standard coding surface, with the host-dependent rows named as such.
{
  const carried = rowsOf(composePreset("bash-native", NO_GATES)).map((row) => row.id);
  for (const required of [
    "persona",
    "agent-instructions",
    "tool-fs",
    "tool-fs-search",
    "tool-jobs",
    "skill-filesystem",
    "tool-skill",
    "command-goal",
    "tool-goal",
    "planning",
    "compaction",
    "delegation",
    "tool-ask-user",
    "tool-todo",
    "tool-web",
    "present",
    "tool-plugin-manager",
  ]) {
    assert.ok(carried.includes(required), `${required} is part of every composition`);
  }
  const withGates = rowsOf(composePreset("bash-native", ALL_GATES)).map((row) => row.id);
  assert.deepEqual(
    withGates.filter((id) => !carried.includes(id)),
    ["time-context", "tool-schedule"],
    "the reminder tools and the clock are the only rows a host decides on",
  );
  pass("the full surface is unconditional, and only the two host rows are added on top of it");
}

// 13. An unknown preset id is a configuration error, not a silently ignored line.
{
  const configured = Config({});
  assert.deepEqual(configured.presets, ["bash-native", "bash-native-minimal"], "both presets register by default");
  assert.deepEqual(Config({ presets: ["bash-native"] }).presets, ["bash-native"], "a deployment can register one");
  assert.deepEqual(Config({ presets: [] }).presets, [], "and can register none");
  assert.throws(() => Config({ presets: ["native-bash"] }), /presets/, "a typo is rejected at load");
  pass("the row's own configuration validates the ids it registers");
}

/** A fake `agentPresets` service and its context, for the registration and probe paths. */
function fakeHost({ baseUrl = "file:///harness/dsh-web-app/", imports = {}, register } = {}) {
  const effects = [];
  const logs = [];
  const warnings = [];
  const calls = { imports: [], registered: [], unregistered: [] };
  const ctx = {
    loader: {
      internal: {
        import(specifier, parentURL, attributes) {
          calls.imports.push({ specifier, parentURL, attributes });
          const outcome = imports[specifier];
          return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve({});
        },
      },
    },
    agentPresets: {
      ctx: { baseUrl },
      register:
        register ??
        (async (definition) => {
          calls.registered.push(definition);
          return async () => {
            calls.unregistered.push(definition.id);
          };
        }),
    },
    logger: { info: (line) => logs.push(line), warn: (line) => warnings.push(line) },
    effect: (callback, label) => {
      effects.push({ callback, label });
    },
  };
  return { ctx, calls, logs, warnings, dispose: () => effects.forEach((effect) => effect.callback()()) };
}

/** A resolution failure of the kind a missing package produces. */
const absent = (specifier) => Object.assign(new Error(`Cannot find package '${specifier}'`), { code: "ERR_MODULE_NOT_FOUND" });

// 14. The probe asks with the Loader's own call, from the registry's base.
{
  const { ctx, calls } = fakeHost();
  const available = await probeHostPackages(ctx, "file:///harness/dsh-web-app/", [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE]);
  assert.deepEqual([...available], [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE]);
  assert.deepEqual(calls.imports.map((call) => call.parentURL), ["file:///harness/dsh-web-app/", "file:///harness/dsh-web-app/"]);
  assert.deepEqual(calls.imports[0].attributes, {}, "the call carries no import attributes, exactly as the tree's does");
  pass("the probe resolves from the registry's base with the loader's own import");
}

// 15. A missing package is an absence; a broken one is a failure.
{
  const { ctx } = fakeHost({ imports: { [TOOL_SCHEDULE_PACKAGE]: absent(TOOL_SCHEDULE_PACKAGE) } });
  assert.deepEqual([...(await probeHostPackages(ctx, "file:///harness/", [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE]))], [
    TIME_CONTEXT_PACKAGE,
  ]);
  const { ctx: broken } = fakeHost({
    imports: { [TOOL_SCHEDULE_PACKAGE]: Object.assign(new Error("SyntaxError: unexpected token"), { code: "ERR_INVALID_SYNTAX" }) },
  });
  await assert.rejects(
    () => probeHostPackages(broken, "file:///harness/", [TOOL_SCHEDULE_PACKAGE]),
    /unexpected token/,
    "a package that exists but cannot load must not read as absent",
  );
  pass("a missing package reads as absent, and a broken one fails the lookup instead of hiding");
}

// 16. Without a loader internal, or without a base, the answer falls back to a package resolve.
{
  const bare = { loader: {} };
  // This package's own directory can resolve its devDependencies; a nonsense name cannot resolve anywhere.
  assert.deepEqual([...(await probeHostPackages(bare, new URL("../lib/", import.meta.url).href, ["@deepseek-ai/dsh-tool-jobs"]))], [
    "@deepseek-ai/dsh-tool-jobs",
  ]);
  assert.deepEqual([...(await probeHostPackages(bare, new URL("../lib/", import.meta.url).href, ["no-such-package-here"]))], []);
  assert.deepEqual(
    [...(await probeHostPackages(bare, undefined, ["@deepseek-ai/dsh-tool-jobs"]))],
    ["@deepseek-ai/dsh-tool-jobs"],
    "no base at all falls back to this module's own location",
  );
  pass("a loader without internals, and a registry without a base, both degrade to a package resolve");
}

// 17. Registration follows the host facts, and disposal retires what it registered.
{
  const { ctx, calls, logs, dispose } = fakeHost({ imports: { [TOOL_SCHEDULE_PACKAGE]: absent(TOOL_SCHEDULE_PACKAGE) } });
  await apply(ctx, { presets: [...PRESET_IDS] });
  assert.deepEqual(calls.registered.map((definition) => definition.id), [...PRESET_IDS]);
  const full = calls.registered[0];
  assert.equal(full.plugins.some((row) => row.id === "tool-schedule"), false, "the host that lacks the package registers no such row");
  assert.ok(full.plugins.some((row) => row.id === "time-context"), "the row it can mount is still carried");
  assert.equal(calls.registered[1].plugins.some((row) => row.id === "time-context"), false);
  assert.equal(logs.length, 2, "each registration reports what it carried");
  assert.match(logs[0], /preset 'bash-native' registered \(\d+ rows; host rows @deepseek-ai\/dsh-time-context; not shipped by this harness: @deepseek-ai\/dsh-tool-schedule\)/);
  assert.match(logs[1], /no host-dependent rows/);
  dispose();
  assert.deepEqual(calls.unregistered, [...PRESET_IDS], "disposal unregisters both definitions");
  pass("the entry registers what the host can mount, reports it, and unregisters on disposal");
}

// 18. Nothing is registered when nothing is configured.
{
  const quiet = fakeHost();
  await apply(quiet.ctx, { presets: [] });
  assert.deepEqual(quiet.calls.registered, []);
  assert.deepEqual(quiet.calls.imports, [], "with no preset selected there is nothing to probe");
  pass("an empty selection registers nothing and asks the host nothing");
}

// 19. An upgrade in place reports the id it could not take, and still registers the other one.
//
// This is the shape a running app has when the previous version's declaration row is still mounted —
// bundle layers are read at process start, so removing the old package does not unmount them. The
// registry throws `Duplicate agent preset: <id>`; the entry has to survive it, because the alternative
// is "1 entry did not activate" on every upgrade, with the same restart as the only way forward.
{
  const taken = "Duplicate agent preset: bash-native";
  const upgraded = fakeHost({
    register: async (definition) => {
      if (definition.id === "bash-native") throw new Error(taken);
      upgraded.calls.registered.push(definition);
      return async () => upgraded.calls.unregistered.push(definition.id);
    },
  });
  await apply(upgraded.ctx, { presets: [...PRESET_IDS] });
  assert.deepEqual(
    upgraded.calls.registered.map((definition) => definition.id),
    ["bash-native-minimal"],
    "the id another registration holds is skipped, and the free one is still registered",
  );
  assert.equal(upgraded.warnings.length, 1, "the skip is reported");
  assert.match(upgraded.warnings[0], /preset 'bash-native' is already registered in this process/);
  assert.match(upgraded.warnings[0], /restart/, "and it names the one action that clears it");
  upgraded.dispose();
  assert.deepEqual(upgraded.calls.unregistered, ["bash-native-minimal"], "no disposer is held for a definition this entry does not own");

  // The tolerance is for that one message and that one id: anything else is still a misconfiguration.
  const broken = fakeHost({
    register: async () => {
      throw new Error("the composition must be a top-level list of plugin rows");
    },
  });
  await assert.rejects(() => apply(broken.ctx, { presets: ["bash-native"] }), /top-level list/);
  const otherId = fakeHost({
    register: async () => {
      throw new Error("Duplicate agent preset: bash-native-minimal");
    },
  });
  await assert.rejects(
    () => apply(otherId.ctx, { presets: ["bash-native"] }),
    /Duplicate agent preset: bash-native-minimal/,
    "a conflict that is not this id is not read as an upgrade artifact",
  );
  pass("a taken id is reported and skipped, and every other registration failure still propagates");
}

console.log(`\n${passed} 项通过`);