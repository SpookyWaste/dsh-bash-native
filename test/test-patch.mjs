// Composition checks for the bundle patch: the invariant that matters is that this bundle only
// ever ADDS rows. The Web surface keeps the shell tools inside agent presets, so a patch that
// reconfigures a host row would silently retarget the shipped presets' `pwsh` tool.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}
function skip(name) {
  console.log("SKIP  " + name);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const JS_TAG = { tag: "tag:yaml.org,2002:js", resolve: (value) => ({ __js: value }) };
const load = (path) => parse(readFileSync(path, "utf8"), { customTags: [JS_TAG] });

/**
 * Mirror of `applyEntryPatches` in `@deepseek-ai/dsh-app-boot` (the loader's one patch algorithm):
 * inserts append, id-targeted patches replace the supplied fields, `name` asserts rather than
 * renames, `group` entries index their `config` array, and unknown targets are skipped.
 */
function applyEntryPatches(data, patches) {
  const rows = structuredClone(data);
  const index = new Map();
  const buildMap = (entries) => {
    for (const entry of entries) {
      if (entry.id) index.set(entry.id, entry);
      if (entry.group && Array.isArray(entry.config)) buildMap(entry.config);
    }
  };
  buildMap(rows);
  for (const patch of patches) {
    const { id, insert, name, ...overrides } = patch;
    if (insert) {
      if (id) {
        const target = index.get(id);
        if (!target || !target.group) continue;
        target.config.push(...insert);
      } else rows.push(...insert);
      buildMap(insert);
      continue;
    }
    const target = index.get(id);
    if (!target) continue;
    Object.assign(target, overrides);
  }
  return rows;
}

/** The union of every command name a row can register as a tool, for the single-`bash` check. */
const BASH_TOOL_ROWS = ["@deepseek-ai/dsh-tool-bash", "@deepseek-ai/dsh-tool-bash-persistent"];

const bundle = load(`${root}cordis.patch.yml`);

/** The preset rows this bundle contributes, keyed by the preset id they register. */
const presets = new Map(bundle[0].insert.map((row) => [row.config?.id, row]));

/** One preset row's plugin list. */
const pluginsOf = (preset) => preset.config.plugins;

/** The shell group inside a preset, which is the row that isolates the realm's executor and terminal. */
const shellGroupOf = (preset) => pluginsOf(preset).find((row) => row.group === true && row.isolate?.shell === true);

// 1. The bundle patch is insert-only.
{
  assert.ok(Array.isArray(bundle), "the patch file is a top-level array");
  assert.equal(bundle.length, 1, "one insert and nothing else");
  assert.deepEqual(Object.keys(bundle[0]), ["insert"], "the only entry is an insert");
  pass("the bundle patch is insert-only, so no host row can be reconfigured");
}

// 2. Composing it over a host plane leaves every host row untouched.
{
  const host = [
    { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: true },
    { id: "tool-pwsh", name: "@deepseek-ai/dsh-tool-pwsh", disabled: false },
    { id: "pwsh-sandbox", name: "@deepseek-ai/dsh-pwsh-sandbox" },
    { id: "bash-sandbox", name: "@deepseek-ai/dsh-bash-sandbox", disabled: true },
  ];
  const composed = applyEntryPatches(host, bundle);
  assert.equal(composed.length, host.length + 2, "exactly the two preset rows are added");
  for (const original of host) {
    const after = composed.find((row) => row.id === original.id);
    assert.deepEqual(after, original, `host row ${original.id} is untouched`);
  }
  pass("composing the bundle patch leaves every host row byte-identical");
}

// 3. The added rows are two agent presets: the full surface and the lean one.
{
  assert.equal(bundle[0].insert.length, 2, "the full preset and the minimal one");
  for (const [id, order] of [["bash-native", 5], ["bash-native-minimal", 6]]) {
    const preset = presets.get(id);
    assert.ok(preset !== undefined, `the ${id} preset exists`);
    assert.equal(preset.name, "@deepseek-ai/dsh-agent-preset");
    assert.equal(preset.config.order, order);
    assert.match(preset.config.name, /Bash/);
    assert.match(preset.config.description, /brush/, "the preset names the engine this bundle ships");
    assert.doesNotMatch(
      preset.config.description,
      /Git Bash|MSYS2|Cygwin|WSL/,
      "the preset must not present an engine family it cannot drive as the one it runs",
    );
    assert.ok(Array.isArray(pluginsOf(preset)));
  }
  pass("the added rows declare two agent presets, the full surface and the lean one");
}

// 4. The shell group isolates the services this preset is supposed to own.
{
  const group = shellGroupOf(presets.get("bash-native"));
  assert.ok(group !== undefined, "the shell group exists");
  assert.equal(group.name, "cordis:group");
  assert.equal(group.group, true);
  assert.equal(group.isolate.shell, true);
  assert.equal(group.isolate.terminals, true);
  assert.ok(Array.isArray(group.config));
  pass("the shell group isolates `shell` and `terminals`");
}

// 5. The group mounts this plugin, the terminal family, and the bash tool.
{
  const group = shellGroupOf(presets.get("bash-native"));
  const names = group.config.map((row) => row.name);
  for (const required of [
    "dsh-bash-native",
    "@deepseek-ai/dsh-terminal",
    "@deepseek-ai/dsh-terminal-bash",
    "@deepseek-ai/dsh-tool-bash",
    "@deepseek-ai/dsh-tool-bash-persistent",
  ]) {
    assert.ok(names.includes(required), `${required} is mounted in the shell group`);
  }
  const executor = group.config.find((row) => row.name === "dsh-bash-native");
  assert.equal(executor.config.engine, undefined, "the preset no longer selects an engine family: brush is the only one");
  assert.equal(executor.config.confine, true, "the shipped preset confines by default");
  assert.equal(
    executor.config.requireEngineOnLoad,
    true,
    "the preset ships the engine, so a broken install must fail at load rather than at every call",
  );
  assert.equal(executor.config.promptDetail, undefined, "the preset leaves the collapsed shape key unset: it no longer changes the contract");
  pass("the shell group mounts the executor, the terminal family, and the bash tool");
}

// 6. Exactly one row can register the tool name `bash`.
{
  const group = shellGroupOf(presets.get("bash-native"));
  const candidates = group.config.filter((row) => BASH_TOOL_ROWS.includes(row.name));
  const enabled = candidates.filter((row) => row.disabled !== true);
  assert.equal(candidates.length, 2, "both bash tools are declared so the swap is one flag");
  assert.equal(enabled.length, 1, "exactly one of them is enabled");
  assert.equal(enabled[0].name, "@deepseek-ai/dsh-tool-bash", "the one-shot tool ships enabled");
  const persistent = candidates.find((row) => row.name === "@deepseek-ai/dsh-tool-bash-persistent");
  assert.equal(persistent.disabled, true);
  assert.match(persistent.config.description, /persistent bash shell/);
  assert.match(persistent.config.description, /stty` does not exist/);
  assert.match(persistent.config.description, /not PowerShell/);
  pass("exactly one bash tool is enabled, and the swap is a single flag");
}

// 7. The PTY row defers to the realm's executor for its engine path.
{
  const group = shellGroupOf(presets.get("bash-native"));
  const pty = group.config.find((row) => row.name === "@deepseek-ai/dsh-terminal-bash");
  assert.deepEqual(pty.inject, ["shell"], "the row waits for the realm executor before its expression resolves");
  assert.equal(pty.config.shellDialect, "bash");
  assert.equal(pty.config.backendType, "shell");
  assert.equal(typeof pty.config.shellPath, "object");
  assert.match(pty.config.shellPath.__js, /ctx\.get\('shell'\)\?\.enginePath/);
  assert.equal(typeof pty.config.shellArgs, "object", "the dialect's default argv would omit the toolchain");
  assert.match(pty.config.shellArgs.__js, /ctx\.get\('shell'\)\?\.engineArgs/);
  assert.ok(pty.config.timeoutMs > 0);
  pass("the PTY row resolves the realm engine path and its interactive argv");
}

// 8. Neither preset carries a PowerShell tool, so PowerShell text can never reach a bash engine.
{
  for (const preset of presets.values()) {
    const all = [...pluginsOf(preset), ...shellGroupOf(preset).config];
    assert.equal(
      all.some((row) => String(row.name).includes("tool-pwsh")),
      false,
      `${preset.config.id} declares no PowerShell tool`,
    );
  }
  pass("neither preset declares a PowerShell tool");
}

// 9. The lean preset mirrors the shipped `minimal` surface: a persona and one persistent shell.
{
  const minimal = presets.get("bash-native-minimal");
  const persona = pluginsOf(minimal).find((row) => row.id === "persona");
  assert.equal(persona.name, "@deepseek-ai/dsh-persona");
  assert.equal(persona.config.complete, true, "the lean persona replaces the default one");
  assert.equal(persona.config.includeRuntimeContext, false);
  const group = shellGroupOf(minimal);
  assert.equal(group.id, "bash-native-shell-minimal", "each preset owns its own realm group");
  const executor = group.config.find((row) => row.name === "dsh-bash-native");
  assert.equal(executor.config.promptDetail, undefined, "the lean preset states the same contract, so it sets no shape key");
  assert.equal(executor.config.confine, true);
  assert.equal(executor.config.requireEngineOnLoad, true);
  const bashTools = group.config.filter((row) => BASH_TOOL_ROWS.includes(row.name));
  assert.deepEqual(
    bashTools.map((row) => [row.name, row.disabled ?? false]),
    [["@deepseek-ai/dsh-tool-bash-persistent", false]],
    "the lean preset offers the persistent shell only",
  );
  assert.match(bashTools[0].config.description, /persistent bash shell/);
  // A lean surface is one shell rather than a fleet of tools, so nothing from the full preset leaks in.
  assert.deepEqual(
    pluginsOf(minimal).map((row) => row.id),
    ["persona", "bash-native-shell-minimal"],
    "the lean preset adds no other top-level row",
  );
  pass("the lean preset is a persona and one persistent bash shell stating the same two-sentence contract");
}

// 10. The preset keeps the full coding surface the shipped standard preset provides.
{
  const plugins = pluginsOf(presets.get("bash-native"));
  const ids = plugins.map((row) => row.id);
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
    assert.ok(ids.includes(required), `${required} is part of the preset`);
  }
  pass("the preset keeps the full standard coding surface");
}

// 11. The TUI overlay is explicit, complete, and switches the tool rows over.
{
  const overlay = load(`${root}overlays/single-agent-bash-native.yml`);
  const byId = new Map(overlay.filter((entry) => entry.id !== undefined).map((entry) => [entry.id, entry]));
  assert.equal(byId.get("bash-sandbox").disabled, true);
  assert.equal(byId.get("pwsh-sandbox").disabled, true);
  assert.equal(byId.get("tool-bash").disabled, false);
  assert.equal(byId.get("tool-pwsh").disabled, true);
  const inserted = overlay.find((entry) => entry.insert !== undefined).insert;
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].name, "dsh-bash-native");
  assert.equal(inserted[0].config.confine, true);
  // The two places that configure this plugin must agree on the key set. Schemastery keeps an unknown
  // key instead of rejecting it, so a stale field (the deleted `engine` selection was one) would
  // otherwise sit in the composed configuration looking like it does something.
  const presetRow = shellGroupOf(presets.get("bash-native")).config.find((row) => row.name === "dsh-bash-native");
  assert.deepEqual(
    Object.keys(inserted[0].config).sort(),
    Object.keys(presetRow.config).sort(),
    "the overlay and the shipped preset configure this plugin with the same keys",
  );
  assert.equal(inserted[0].config.requireEngineOnLoad, true, "the overlay verifies the engine on load, like the preset");
  const composed = applyEntryPatches(
    [
      { id: "bash-sandbox", name: "@deepseek-ai/dsh-bash-sandbox" },
      { id: "pwsh-sandbox", name: "@deepseek-ai/dsh-pwsh-sandbox" },
      { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: true },
      { id: "tool-pwsh", name: "@deepseek-ai/dsh-tool-pwsh" },
    ],
    overlay,
  );
  const executors = composed.filter((row) => ["bash-sandbox", "pwsh-sandbox", "bash-native"].includes(row.id));
  assert.equal(
    executors.filter((row) => row.disabled !== true).length,
    1,
    "exactly one ctx.shell provider remains enabled after the overlay",
  );
  assert.equal(executors.find((row) => row.disabled !== true).id, "bash-native");
  pass("the TUI overlay swaps in exactly one executor and one bash tool");
}

// 12. A wrong-shaped patch is not silently accepted by the mirror either.
{
  const composed = applyEntryPatches([{ id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: true }], [
    { id: "absent-row", disabled: false },
  ]);
  assert.equal(composed[0].disabled, true, "a patch for an absent row changes nothing");
  skip("the mirror documents skip-unknown-target behaviour");
}

console.log(`\n${passed} 项通过`);
