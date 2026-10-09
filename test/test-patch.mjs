// Composition checks for the bundle patch: the invariant that matters is that this bundle only
// ever ADDS rows. The Web surface keeps the shell tools inside agent presets, so a patch that
// reconfigures a host row would silently retarget the shipped presets' `pwsh` tool.
//
// The patch is one row now: the entry that registers this bundle's presets at runtime. The preset
// bodies themselves are `lib/preset-data.js`, and `test-presets.mjs` owns their behaviour.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { PRESET_IDS, TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE, composePreset } from "../lib/preset-data.js";

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

const bundle = load(`${root}cordis.patch.yml`);
const manifest = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

// 1. The bundle patch is insert-only.
{
  assert.ok(Array.isArray(bundle), "the patch file is a top-level array");
  assert.equal(bundle.length, 1, "one insert and nothing else");
  assert.deepEqual(Object.keys(bundle[0]), ["insert"], "the only entry is an insert");
  pass("the bundle patch is insert-only, so no host row can be reconfigured");
}

// 2. Composing it over a host plane leaves every host row untouched and adds one row.
{
  const host = [
    { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: true },
    { id: "tool-pwsh", name: "@deepseek-ai/dsh-tool-pwsh", disabled: false },
    { id: "pwsh-sandbox", name: "@deepseek-ai/dsh-pwsh-sandbox" },
    { id: "bash-sandbox", name: "@deepseek-ai/dsh-bash-sandbox", disabled: true },
  ];
  const composed = applyEntryPatches(host, bundle);
  assert.equal(composed.length, host.length + 1, "exactly the registration row is added");
  for (const original of host) {
    const after = composed.find((row) => row.id === original.id);
    assert.deepEqual(after, original, `host row ${original.id} is untouched`);
  }
  pass("composing the bundle patch leaves every host row byte-identical");
}

// 3. The added row is the registration entry, and it says which presets it registers.
{
  assert.equal(bundle[0].insert.length, 1, "one row: the entry that registers both presets");
  const row = bundle[0].insert[0];
  assert.equal(row.id, "bash-native-presets");
  assert.equal(row.name, "dsh-bash-native/presets");
  assert.deepEqual(row.config.presets, [...PRESET_IDS], "the patch and the composition data name the same ids");
  assert.equal(
    bundle[0].insert.some((inserted) => inserted.name === "@deepseek-ai/dsh-agent-preset"),
    false,
    "no preset body is declared here any more: a row declared by this file resolves from the profile, " +
      "which cannot see the harness packages a registered preset's rows resolve against",
  );
  pass("the patch adds one row: the entry that registers the two presets");
}

// 4. The subpath that row names is one this package actually exports, and its build is present.
{
  const row = bundle[0].insert[0];
  const subpath = `./${row.name.slice(row.name.indexOf("/") + 1)}`;
  assert.equal(subpath, "./presets");
  assert.equal(manifest.exports[subpath]?.default, "./lib/presets.js", `${subpath} resolves to the built entry`);
  assert.ok(existsSync(join(root, "lib", "presets.js")), "the built entry the subpath points at exists");
  pass("the row names a subpath this package exports, and the build behind it is in the tree");
}

// 5. The TUI overlay is explicit, complete, and switches the tool rows over.
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
  const shellGroup = composePreset("bash-native", new Set([TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE])).plugins.find(
    (row) => row.id === "bash-native-shell",
  );
  const presetRow = shellGroup.config.find((row) => String(row.name).startsWith("file:"));
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

// 6. A wrong-shaped patch is not silently accepted by the mirror either.
{
  const composed = applyEntryPatches([{ id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: true }], [
    { id: "absent-row", disabled: false },
  ]);
  assert.equal(composed[0].disabled, true, "a patch for an absent row changes nothing");
  skip("the mirror documents skip-unknown-target behaviour");
}

console.log(`\n${passed} 项通过`);