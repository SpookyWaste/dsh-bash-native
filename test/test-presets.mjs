// Behaviour checks for the preset composition and the registration entry: which rows a given host
// gets, what the entry asks that host before deciding, and what it leaves behind when it goes away.
//
// The composition is pure data plus host facts — which packages a host can mount, and which fields
// its modules' own exported `Config` schemas declare — so every claim here is a claim about a host
// shape: the 0.2.1-alpha.2 line (denial accepted, no fs toggles), 0.2.1-alpha.3 (Agent Presets and
// fs toggles), the 0.2.0-rc.2 desktop line (clock only), and hosts that cannot answer at all.
// `test-preset-parity.mjs` owns the other half — that the mirror still matches the shipped presets —
// and `test-patch.mjs` owns the bundle-patch shape that mounts this entry.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Config, apply, inject, name, probeHostFacts } from "../lib/presets.js";
import {
  PRESET_IDS,
  SUBAGENT_PACKAGE,
  TIME_CONTEXT_PACKAGE,
  TOOL_FS_PACKAGE,
  TOOL_SCHEDULE_PACKAGE,
  capabilityPackages,
  composePreset,
  gatePackages,
  probePackages,
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
/** The toggle family the alpha.3 `dsh-tool-fs` config declares, which the lean preset's fs row needs. */
const FS_TOGGLES = ["read", "readImage", "write", "edit"];
/** Build host facts; a config value of null is a module whose field map could not be read. */
const factsOf = (packages, configs) => ({
  packages,
  configs: new Map(Object.entries(configs).map(([name, fields]) => [name, fields === null ? null : new Set(fields)])),
});
/** Facts from the alpha.1/alpha.2 line: every optional row, `toolFilter` accepted, no fs toggles. */
const FILTER_FACTS = factsOf(ALL_GATES, { [SUBAGENT_PACKAGE]: ["toolFilter"], [TOOL_FS_PACKAGE]: [] });
/** Facts from 0.2.1-alpha.3: the reminder tools still ship, the subagent selects Agent Presets. */
const AGENT_PRESET_FACTS = factsOf(ALL_GATES, { [SUBAGENT_PACKAGE]: [], [TOOL_FS_PACKAGE]: FS_TOGGLES });
/** Facts from the newest line: both capabilities declared. */
const CURRENT_FACTS = factsOf(ALL_GATES, { [SUBAGENT_PACKAGE]: ["toolFilter"], [TOOL_FS_PACKAGE]: FS_TOGGLES });
/** Facts from a host whose subagent config could not be read. */
const UNREADABLE_FACTS = factsOf(ALL_GATES, { [SUBAGENT_PACKAGE]: null, [TOOL_FS_PACKAGE]: FS_TOGGLES });
/** Facts from the 0.2.0-rc.2 desktop line: clock only, `toolFilter` accepted, no fs toggles. */
const CLOCK_FACTS = factsOf(CLOCK_ONLY, { [SUBAGENT_PACKAGE]: ["toolFilter"], [TOOL_FS_PACKAGE]: [] });
/** Facts from a host that cannot mount either optional row. */
const BARE_FACTS = factsOf(NO_GATES, {});

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
    const definition = composePreset(id, FILTER_FACTS);
    assert.equal(definition.id, id);
    assert.match(definition.name, /Bash/);
    assert.match(definition.description, /brush/, "each preset names the engine this bundle ships");
    assert.doesNotMatch(definition.description, /Git Bash|MSYS2|Cygwin|WSL/);
  }
  assert.deepEqual(
    PRESET_IDS.map((id) => composePreset(id, FILTER_FACTS).order),
    [5, 6],
    "the two presets keep their roster order",
  );
  pass("both presets compose under the ids sessions have pinned, with the registry as a declared dependency");
}

// 2. Each preset declares its package gates and the packages whose exported configs its host-dependent
// rows need.
{
  assert.deepEqual(gatePackages("bash-native"), [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE]);
  assert.deepEqual(capabilityPackages("bash-native"), [SUBAGENT_PACKAGE], "the denial is written only where the subagent config declares its field");
  assert.deepEqual(gatePackages("bash-native-minimal"), [], "the lean preset adds no package-gated row");
  assert.deepEqual(capabilityPackages("bash-native-minimal"), [TOOL_FS_PACKAGE], "its alpha.3 rows wait on the file tool toggles");
  assert.deepEqual(probePackages("bash-native"), [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE, SUBAGENT_PACKAGE]);
  assert.deepEqual(probePackages("bash-native-minimal"), [TOOL_FS_PACKAGE]);
  pass("each preset declares its row gates and the packages whose configs its host-dependent rows need");
}

// 2b. Every package the composition tests is in the probe list (amendment gates included), and the
// composition really applies when only that list is answered. A gate outside the list would leave a
// host-dependent change silently unapplied forever.
{
  for (const id of PRESET_IDS) {
    const probed = new Set(probePackages(id));
    for (const pkg of [...gatePackages(id), ...capabilityPackages(id)]) {
      assert.ok(probed.has(pkg), `${id}: ${pkg} is probed`);
    }
  }
  // The denial does not need the clock: with only the amendment gate answered, it is still written.
  const amendmentOnly = factsOf(new Set([TOOL_SCHEDULE_PACKAGE]), { [SUBAGENT_PACKAGE]: ["toolFilter"] });
  const subagents = groupOf(composePreset("bash-native", amendmentOnly), "delegation").config.filter(
    (row) => row.name === "@deepseek-ai/dsh-tool-subagent",
  );
  assert.deepEqual(subagents[0].config.toolFilter.deny, SCHEDULE_TOOLS, "the amendment gate alone is enough to write the denial");
  pass("the probe list covers every gate the composition tests, so no host-dependent change is silently skipped");
}

// 3. A host that ships both packages gets both rows, in the shipped preset's order, and the denial.
{
  const definition = composePreset("bash-native", FILTER_FACTS);
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

// 3b. 0.2.1-alpha.3 still ships the reminder tools, and its subagent selects Agent Presets instead of
// filtering tools: the rows stay and the denial is left out, exactly as the shipped preset does.
{
  const definition = composePreset("bash-native", AGENT_PRESET_FACTS);
  const ids = rowsOf(definition).map((row) => row.id);
  assert.ok(ids.includes("tool-schedule"), "the reminder-tool row still follows its own package gate");
  assert.equal(
    subagentsOf(definition).some((row) => row.config.toolFilter !== undefined),
    false,
    "no subagent row carries a key 0.2.1-alpha.3 rejects at mount",
  );
  assert.deepEqual(
    groupOf(definition, "delegation").config.map((row) => row.id),
    groupOf(composePreset("bash-native", FILTER_FACTS), "delegation").config.map((row) => row.id),
    "the group keeps the same rows: only the denial is left out",
  );
  pass("0.2.1-alpha.3 keeps the reminder-tool row and gets no toolFilter: the denial is written only where the config declares it");
}

// 3c. A host that cannot answer the subagent question is treated like one that rejects the field:
// the denial is left out, because writing it is the only choice that can break a mount.
{
  const definition = composePreset("bash-native", UNREADABLE_FACTS);
  assert.equal(subagentsOf(definition).some((row) => row.config.toolFilter !== undefined), false);
  pass("an unreadable subagent config leaves the denial out");
}

// 3d. The alpha.3 `minimal` rows are gated by the file tool's own config: a host whose `dsh-tool-fs`
// predates the toggles keeps the persona + shell composition instead of silently registering the full
// read/write/edit suite under an image-only config.
{
  const current = composePreset("bash-native-minimal", CURRENT_FACTS);
  assert.deepEqual(
    rowsOf(current).map((row) => row.id),
    ["persona", "tool-fs", "compaction", "bash-native-shell-minimal"],
    "the alpha.3 line gets the two rows the shipped minimal gained",
  );
  const older = composePreset("bash-native-minimal", FILTER_FACTS);
  assert.deepEqual(
    rowsOf(older).map((row) => row.id),
    ["persona", "bash-native-shell-minimal"],
    "an older file tool keeps this preset at its pre-alpha.3 rows",
  );
  const unreadable = composePreset("bash-native-minimal", factsOf(NO_GATES, { [TOOL_FS_PACKAGE]: null }));
  assert.deepEqual(rowsOf(unreadable).map((row) => row.id), ["persona", "bash-native-shell-minimal"]);
  pass("the lean preset carries the alpha.3 rows only where the file tool declares the full toggle family");
}

// 4. A host that ships neither gets neither row and no denial, and nothing else moves.
{
  const full = composePreset("bash-native", FILTER_FACTS);
  const bare = composePreset("bash-native", BARE_FACTS);
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
  const desktop = composePreset("bash-native", CLOCK_FACTS);
  const ids = rowsOf(desktop).map((row) => row.id);
  assert.ok(ids.includes("time-context"));
  assert.equal(ids.includes("tool-schedule"), false);
  assert.equal(subagentsOf(desktop).some((row) => row.config.toolFilter !== undefined), false);
  pass("the older harness line keeps the clock and drops exactly the reminder tools");
}

// 6. Composition is a pure function of the host facts.
{
  const first = composePreset("bash-native", BARE_FACTS);
  const second = composePreset("bash-native", FILTER_FACTS);
  const third = composePreset("bash-native", BARE_FACTS);
  assert.deepEqual(first.plugins, third.plugins, "the same host facts compose the same rows");
  assert.equal(rowsOf(second).length, rowsOf(first).length + 2, "and a richer host is unaffected by the earlier call");
  assert.equal(first.plugins.some((row) => row.id === "tool-schedule"), false);
  pass("composing one host shape never changes what another host shape composes");
}

// 7. Every row is named the way the registry's base can resolve it.
{
  for (const id of PRESET_IDS) {
    const index = rowIndex(composePreset(id, FILTER_FACTS));
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
    const index = rowIndex(composePreset(id, FILTER_FACTS));
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
    const definition = composePreset(id, FILTER_FACTS);
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
  const group = groupOf(composePreset("bash-native", FILTER_FACTS), "bash-native-shell");
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
    const index = rowIndex(composePreset(id, FILTER_FACTS));
    assert.equal(
      [...index.values()].some((row) => String(row.name).includes("tool-pwsh")),
      false,
      `${id} declares no PowerShell tool`,
    );
  }
  pass("neither preset declares a PowerShell tool");
}

// 11. On the newest line the lean preset mirrors the shipped `minimal` surface: a persona, a
// read-only image fs, a compaction group, and one persistent shell. Test 3d owns the older line.
{
  const minimal = composePreset("bash-native-minimal", CURRENT_FACTS);
  assert.deepEqual(
    rowsOf(minimal).map((row) => row.id),
    ["persona", "tool-fs", "compaction", "bash-native-shell-minimal"],
    "the lean preset adds no other top-level row",
  );
  const persona = rowsOf(minimal).find((row) => row.id === "persona");
  assert.equal(persona.name, "@deepseek-ai/dsh-persona");
  assert.equal(persona.config.complete, true, "the lean persona replaces the default one");
  assert.equal(persona.config.includeRuntimeContext, false);
  // 0.2.1-alpha.3 added these two rows to the shipped minimal preset: a restricted image-only fs,
  // and compaction as its own realm. The old lines keep their rows out (test 3d), because the
  // toggles that make the fs row image-only do not exist there and would be silently dropped.
  const fs = rowsOf(minimal).find((row) => row.id === "tool-fs");
  assert.deepEqual(
    fs.config,
    { read: false, readImage: true, write: false, edit: false },
    "the lean fs can read images and nothing else",
  );
  const compaction = rowsOf(minimal).find((row) => row.id === "compaction");
  assert.equal(compaction.group, true);
  assert.deepEqual(compaction.isolate, { compaction: true }, "the lean compaction group owns its realm");
  assert.deepEqual(
    compaction.config.map((row) => row.id),
    ["compaction-basic", "command-compact"],
  );
  assert.equal(
    rowsOf(minimal).some((row) => row.id === "time-context"),
    false,
    "the shipped minimal preset carries no clock, so neither does this one",
  );
  pass("the newest line gets the alpha.3 minimal rows: restricted fs, compaction, shell");
}

// 12. The full preset keeps the standard coding surface, with the host-dependent rows named as such.
{
  const carried = rowsOf(composePreset("bash-native", BARE_FACTS)).map((row) => row.id);
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
  const withGates = rowsOf(composePreset("bash-native", FILTER_FACTS)).map((row) => row.id);
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
          return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome ?? {});
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

// 14. The probe asks with the Loader's own call, from the registry's base, and records the exported
// `Config` field map of every capability package.
{
  const { ctx, calls } = fakeHost({
    imports: {
      [SUBAGENT_PACKAGE]: { Config: { dict: { provider: {}, agentPreset: {}, allowedAgentPresets: {}, maxDepth: {} } } },
      [TOOL_FS_PACKAGE]: { Config: { dict: { read: {}, readImage: {}, write: {}, edit: {}, readLimit: {} } } },
    },
  });
  const facts = await probeHostFacts(
    ctx,
    "file:///harness/dsh-web-app/",
    [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE, SUBAGENT_PACKAGE, TOOL_FS_PACKAGE],
    new Set([SUBAGENT_PACKAGE, TOOL_FS_PACKAGE]),
  );
  assert.deepEqual([...facts.packages], [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE, SUBAGENT_PACKAGE, TOOL_FS_PACKAGE]);
  assert.deepEqual([...(facts.configs.get(SUBAGENT_PACKAGE) ?? [])], ["provider", "agentPreset", "allowedAgentPresets", "maxDepth"]);
  assert.deepEqual([...(facts.configs.get(TOOL_FS_PACKAGE) ?? [])], ["read", "readImage", "write", "edit", "readLimit"]);
  assert.deepEqual(calls.imports.map((call) => call.parentURL), Array(4).fill("file:///harness/dsh-web-app/"));
  assert.deepEqual(calls.imports[0].attributes, {}, "the call carries no import attributes, exactly as the tree's does");
  pass("the probe resolves from the registry's base with the loader's own import and records the declared config fields");
}

// 14b. The field map is the whole answer: only own enumerable keys count, an unrecognized shape is
// unreadable, and an unreadable map never reads as a declared field.
{
  const readable = (dict) => ({ Config: { dict } });
  const cases = [
    ["declared", readable({ toolFilter: {}, persona: {} })],
    ["missing", readable({ agentPreset: {}, provider: {} })],
    ["unreadable", readable(undefined)],
    ["unreadable", { Config: {} }],
    ["unreadable", {}],
    ["unreadable", null],
    ["missing", readable(Object.create({ toolFilter: {} }))],
    ["unreadable", readable([])],
    ["unreadable", readable(new Map([["toolFilter", {}]]))],
  ];
  for (const [expected, namespace] of cases) {
    const { ctx } = fakeHost({ imports: { [SUBAGENT_PACKAGE]: namespace } });
    const facts = await probeHostFacts(ctx, "file:///harness/", [SUBAGENT_PACKAGE], new Set([SUBAGENT_PACKAGE]));
    const fields = facts.configs.get(SUBAGENT_PACKAGE);
    const verdict = fields == null ? "unreadable" : fields.has("toolFilter") ? "declared" : "missing";
    assert.equal(verdict, expected, `${JSON.stringify(namespace)} has to read as ${expected}`);
  }
  const { ctx, warnings } = fakeHost({
    imports: { [SUBAGENT_PACKAGE]: { get Config() { throw new Error("boom"); } } },
  });
  const facts = await probeHostFacts(ctx, "file:///harness/", [SUBAGENT_PACKAGE], new Set([SUBAGENT_PACKAGE]));
  assert.equal(facts.configs.get(SUBAGENT_PACKAGE), null, "a throwing getter is unreadable, not a crash");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /exposes no readable Config field map/);
  pass("only own config keys count, unrecognized shapes are unreadable, and a throwing getter degrades with a warning");
}

// 15. A missing package is an absence; a broken row gate is a failure.
{
  const { ctx } = fakeHost({ imports: { [TOOL_SCHEDULE_PACKAGE]: absent(TOOL_SCHEDULE_PACKAGE) } });
  const facts = await probeHostFacts(ctx, "file:///harness/", [TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE], new Set());
  assert.deepEqual([...facts.packages], [TIME_CONTEXT_PACKAGE]);
  assert.equal(facts.configs.has(TOOL_SCHEDULE_PACKAGE), false, "a package that is not there has no config entry");
  const { ctx: broken } = fakeHost({
    imports: { [TOOL_SCHEDULE_PACKAGE]: Object.assign(new Error("SyntaxError: unexpected token"), { code: "ERR_INVALID_SYNTAX" }) },
  });
  await assert.rejects(
    () => probeHostFacts(broken, "file:///harness/", [TOOL_SCHEDULE_PACKAGE], new Set()),
    /unexpected token/,
    "a row-gate package that exists but cannot load must not read as absent",
  );
  pass("a missing package reads as absent, and a broken row gate fails the lookup instead of hiding");
}

// 15b. A broken capability module is the one failure that degrades instead of propagating: the rows
// that need its fields are left out, and the warning names what could not be read.
{
  const { ctx, warnings } = fakeHost({
    imports: { [SUBAGENT_PACKAGE]: Object.assign(new Error("SyntaxError: unexpected token"), { code: "ERR_INVALID_SYNTAX" }) },
  });
  const facts = await probeHostFacts(ctx, "file:///harness/", [SUBAGENT_PACKAGE], new Set([SUBAGENT_PACKAGE]));
  assert.equal(facts.configs.get(SUBAGENT_PACKAGE), null);
  assert.deepEqual([...facts.packages], [], "a module that cannot load is not a package this host can mount");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not import @deepseek-ai\/dsh-tool-subagent to read its config/);
  assert.match(warnings[0], /left out/);
  pass("a broken capability module is reported and leaves its dependent rows out instead of failing the entry");
}

// 16. Without a loader internal, or without a base, the answer falls back to a package resolve, and a
// capability question — which needs the loaded module — stays unanswered and is reported.
{
  const warnings = [];
  const bare = { loader: {}, logger: { warn: (line) => warnings.push(line) } };
  const base = new URL("../lib/", import.meta.url).href;
  // This package's own directory can resolve its devDependencies; a nonsense name cannot resolve anywhere.
  const jobs = await probeHostFacts(bare, base, ["@deepseek-ai/dsh-tool-jobs"], new Set());
  assert.deepEqual([...jobs.packages], ["@deepseek-ai/dsh-tool-jobs"]);
  const capability = await probeHostFacts(bare, base, ["@deepseek-ai/dsh-tool-jobs"], new Set(["@deepseek-ai/dsh-tool-jobs"]));
  assert.equal(capability.configs.get("@deepseek-ai/dsh-tool-jobs"), null, "a resolve-only answer cannot read the module's config");
  assert.equal(warnings.length, 1, "and the degraded read is reported, not silent");
  assert.deepEqual([...(await probeHostFacts(bare, base, ["no-such-package-here"], new Set())).packages], []);
  assert.deepEqual(
    [...(await probeHostFacts(bare, undefined, ["@deepseek-ai/dsh-tool-jobs"], new Set())).packages],
    ["@deepseek-ai/dsh-tool-jobs"],
    "no base at all falls back to this module's own location",
  );
  pass("a loader without internals, and a registry without a base, both degrade to a package resolve");
}
// 17. Registration follows the host facts, and disposal retires what it registered.
{
  const { ctx, calls, logs, dispose } = fakeHost({
    imports: {
      [TOOL_SCHEDULE_PACKAGE]: absent(TOOL_SCHEDULE_PACKAGE),
      [SUBAGENT_PACKAGE]: { Config: { dict: { provider: {}, toolFilter: {} } } },
      [TOOL_FS_PACKAGE]: { Config: { dict: { readLimit: {} } } },
    },
  });
  await apply(ctx, { presets: [...PRESET_IDS] });
  assert.deepEqual(calls.registered.map((definition) => definition.id), [...PRESET_IDS]);
  const full = calls.registered[0];
  assert.equal(full.plugins.some((row) => row.id === "tool-schedule"), false, "the host that lacks the package registers no such row");
  assert.ok(full.plugins.some((row) => row.id === "time-context"), "the row it can mount is still carried");
  assert.equal(calls.registered[1].plugins.some((row) => row.id === "time-context"), false);
  assert.equal(calls.registered[1].plugins.some((row) => row.id === "tool-fs"), false, "the older file tool keeps the alpha.3 rows out");
  assert.equal(logs.length, 2, "each registration reports what it carried");
  assert.match(
    logs[0],
    /preset 'bash-native' registered \(\d+ rows; host rows @deepseek-ai\/dsh-time-context; not shipped by this harness: @deepseek-ai\/dsh-tool-schedule; config fields @deepseek-ai\/dsh-tool-subagent\.\{toolFilter\}=declared\)/,
  );
  assert.match(logs[1], /config fields @deepseek-ai\/dsh-tool-fs\.\{read,readImage,write,edit\}=missing/);
  dispose();
  assert.deepEqual(calls.unregistered, [...PRESET_IDS], "disposal unregisters both definitions");
  pass("the entry registers what the host can mount, reports it, and unregisters on disposal");
}

// 17b. Through the entry, each module's own config decides its host-dependent rows and amendments:
// the alpha.2/alpha.1 shape keeps the denial and the old lean rows, the alpha.3 shape is the mirror.
{
  const line = async (imports) => {
    const host = fakeHost({ imports });
    await apply(host.ctx, { presets: [...PRESET_IDS] });
    return { full: host.calls.registered[0], minimal: host.calls.registered[1], logs: host.logs };
  };
  const alpha2 = await line({
    [SUBAGENT_PACKAGE]: { Config: { dict: { provider: {}, toolFilter: {} } } },
    [TOOL_FS_PACKAGE]: { Config: { dict: { readLimit: {}, readMaxBytes: {} } } },
  });
  const denial = alpha2.full.plugins
    .find((row) => row.id === "delegation")
    .config.find((row) => row.id === "tool-subagent");
  assert.deepEqual(denial.config.toolFilter.deny, SCHEDULE_TOOLS, "the alpha.2 line keeps the shipped denial");
  assert.deepEqual(
    alpha2.minimal.plugins.map((row) => row.id),
    ["persona", "bash-native-shell-minimal"],
    "and its lean preset keeps the pre-alpha.3 rows",
  );
  assert.match(alpha2.logs[0], /config fields @deepseek-ai\/dsh-tool-subagent\.\{toolFilter\}=declared/);
  assert.match(alpha2.logs[1], /config fields @deepseek-ai\/dsh-tool-fs\.\{read,readImage,write,edit\}=missing/);

  const alpha3 = await line({
    [SUBAGENT_PACKAGE]: { Config: { dict: { provider: {}, agentPreset: {} } } },
    [TOOL_FS_PACKAGE]: { Config: { dict: { read: {}, readImage: {}, write: {}, edit: {} } } },
  });
  const rejected = alpha3.full.plugins
    .find((row) => row.id === "delegation")
    .config.find((row) => row.id === "tool-subagent");
  assert.equal(rejected.config.toolFilter, undefined, "the alpha.3 line must not carry a key its mount rejects");
  assert.deepEqual(
    alpha3.minimal.plugins.map((row) => row.id),
    ["persona", "tool-fs", "compaction", "bash-native-shell-minimal"],
    "and its lean preset follows the alpha.3 minimal",
  );
  assert.match(alpha3.logs[0], /config fields @deepseek-ai\/dsh-tool-subagent\.\{toolFilter\}=missing/);
  assert.match(alpha3.logs[1], /config fields @deepseek-ai\/dsh-tool-fs\.\{read,readImage,write,edit\}=declared/);
  pass("the registration entry writes each host-dependent change exactly where the module's own config declares its fields");
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
    imports: {
      [SUBAGENT_PACKAGE]: { Config: { dict: { provider: {}, toolFilter: {} } } },
      [TOOL_FS_PACKAGE]: { Config: { dict: { read: {}, readImage: {}, write: {}, edit: {} } } },
    },
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
