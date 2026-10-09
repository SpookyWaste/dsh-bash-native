// Drift alarm for the mirrored preset body. The rows this bundle registers mirror the shipped
// `standard` and `minimal` presets because a bundle patch cannot address rows inside an agent preset;
// when upstream adds or removes a tool, this check says so instead of leaving the mirror quietly stale.
//
// The mirror is now data plus a host fact (`lib/preset-data.js`), so this check composes both presets
// with every host gate OPEN — the shape a harness line that ships every optional package produces — and
// compares that against the shipped presets row by row. Which rows a given host actually gets is
// `test-presets.mjs`'s subject.
//
// Upstream's preset is not a dependency, so the check needs a path to it, in this order:
// `DSH_WEB_APP_PRESET`; an installed `@deepseek-ai/dsh-web-app` this package can resolve; and — the case
// that makes the check run on a machine that installed the harness globally — that harness's own copy of
// the preset. A CI runner has none of the three, so the workflow fetches the one tarball the preset lives
// in with `scripts/fetch-upstream-preset.mjs` and exports the path (the checked-in `next` channel keeps
// that reference moving, which is what makes the alarm notice upstream drift at all). Without any of
// them the check skips and says what to run.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { PRESET_IDS, TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE, composePreset } from "../lib/preset-data.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const JS_TAG = { tag: "tag:yaml.org,2002:js", resolve: (value) => ({ __js: value }) };
const load = (path) => parse(readFileSync(path, "utf8"), { customTags: [JS_TAG] });

/** Every row of a preset subtree, keyed by path so a group's children keep their group in the key. */
function rowIndex(rows, prefix = "") {
  const index = new Map();
  for (const row of rows) {
    index.set(`${prefix}${row.id}`, row);
    if (Array.isArray(row.config)) {
      for (const [key, value] of rowIndex(row.config, `${prefix}${row.id}/`)) index.set(key, value);
    }
  }
  return index;
}

/** A JSON form that ignores mapping key order, which YAML makes no promise about. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonical(value[key])]),
  );
}

/**
 * Mirrored rows whose fields no longer match upstream, as `id (field)` strings.
 *
 * Comparing identifiers alone left a hole worth closing: `tool-subagent` gained a `toolFilter` that keeps
 * a subagent from creating schedules, and a preset that missed it would still pass a rows-only alarm while
 * handing a subagent a capability the shipped standard preset denies it.
 * @param upstreamRows - the upstream preset's rows.
 * @param ourRows - this bundle's mirrored rows.
 * @param replaced - the identifiers this bundle replaces rather than mirrors.
 * @returns one entry per differing field, in upstream order.
 */
function configDrift(upstreamRows, ourRows, replaced) {
  const upstream = rowIndex(upstreamRows);
  const ours = rowIndex(ourRows);
  const drift = [];
  for (const [id, row] of upstream) {
    if (replaced.has(id) || replaced.has(id.split("/")[0])) continue;
    const mine = ours.get(id);
    // A missing row is the check above's report, not this one's.
    if (mine === undefined) continue;
    for (const field of ["name", "group", "disabled", "inject", "isolate", "config"]) {
      if (canonical(row[field]) === undefined) continue;
      if (JSON.stringify(canonical(row[field])) !== JSON.stringify(canonical(mine[field]))) drift.push(`${id} (${field})`);
    }
  }
  return drift;
}

/** Rows a bundle cannot address inside an agent preset, so this preset deliberately replaces them. */
const REPLACED_BY_DESIGN = new Set(["tool-bash", "tool-pwsh"]);

/** Every host gate open: the composition a harness line shipping every optional package mounts. */
const ALL_GATES = new Set([TIME_CONTEXT_PACKAGE, TOOL_SCHEDULE_PACKAGE]);

/**
 * The preset inside a globally installed harness, derived rather than hard-coded.
 *
 * `npm`'s global prefix is `%APPDATA%\npm` on Windows and `%APPDATA%\npm\node_modules\@deepseek-ai\dsh`
 * is where this machine's `dsh` lives. A checkout that never installed one simply finds nothing here.
 * @param env - the process environment, for `APPDATA`.
 * @returns the path when it exists, else null.
 */
function installedHarnessPreset(env) {
  const appData = env.APPDATA;
  if (appData === undefined || appData.length === 0) return null;
  const candidate = join(appData, "npm", "node_modules", "@deepseek-ai", "dsh", "node_modules", "@deepseek-ai", "dsh-web-app", "presets", "standard.patch.yml");
  return existsSync(candidate) ? candidate : null;
}

/** Locate the installed upstream preset, or null when this environment does not have it. */
function upstreamPresetPath() {
  const configured = process.env.DSH_WEB_APP_PRESET;
  if (configured !== undefined && configured.length > 0) return existsSync(configured) ? configured : null;
  try {
    const require = createRequire(import.meta.url);
    return join(dirname(require.resolve("@deepseek-ai/dsh-web-app/package.json")), "presets", "standard.patch.yml");
  } catch {
    // Not resolvable as a dependency here; try the globally installed harness before giving up.
    return installedHarnessPreset(process.env);
  }
}

const upstreamPath = upstreamPresetPath();
if (upstreamPath === null) {
  console.log("SKIP  test-preset-parity.mjs: no upstream preset is reachable here; run `node scripts/fetch-upstream-preset.mjs --env` and export the line it prints, or set DSH_WEB_APP_PRESET to an installed presets/standard.patch.yml");
  process.exit(0);
}

/** The rows this bundle mirrors, keyed by the preset id they register, with every host gate open. */
const ours = new Map(PRESET_IDS.map((id) => [id, composePreset(id, ALL_GATES).plugins]));

/** The upstream presets, read from the directory the located one lives in. */
const upstreamDir = dirname(upstreamPath);
const upstream = load(upstreamPath)[0].insert[0].config.plugins;
const ourIds = new Set(ours.get("bash-native").map((row) => row.id));
const upstreamIds = upstream.map((row) => row.id);

const missing = upstreamIds.filter((id) => !REPLACED_BY_DESIGN.has(id) && !ourIds.has(id));
assert.deepEqual(
  missing,
  [],
  `upstream preset rows missing from this preset: ${missing.join(", ")}. ` +
    "Update lib/preset-data.js (and its test) to mirror the shipped standard preset.",
);
pass("every upstream standard-preset row except the replaced shell tools is mirrored");

const extras = [...ourIds].filter((id) => !upstreamIds.includes(id));
assert.deepEqual(extras, ["bash-native-shell"], "the only extra row is this plugin's shell group");
pass("the only row this preset adds is the bash shell group");

const group = ours.get("bash-native").find((row) => row.id === "bash-native-shell");
assert.ok(
  upstreamIds.includes("tool-bash") && upstreamIds.includes("tool-pwsh"),
  "upstream still declares the two shell tool rows this preset replaces",
);
assert.equal(group.config.filter((row) => row.name === "@deepseek-ai/dsh-tool-bash").length, 1);
pass("the replaced shell tools are declared inside the shell group instead");

const standardDrift = configDrift(upstream, ours.get("bash-native"), REPLACED_BY_DESIGN);
assert.deepEqual(
  standardDrift,
  [],
  `upstream standard-preset rows whose configuration this preset does not mirror: ${standardDrift.join(", ")}. ` +
    "Copy the row from the shipped preset.",
);
pass("every mirrored standard-preset row carries the upstream configuration");

// The configuration alarm is only worth its line if it can fire, and the keys it compares are paths: a
// nested row that this preset stopped finding would be skipped silently, which is the failure a self-check
// has to rule out. The mutation is on copies, so the checks below still read the file's own rows.
const mutated = ours.get("bash-native").map((row) => {
  if (row.id !== "delegation") return row;
  const config = row.config.map((child) =>
    child.id !== "tool-subagent" ? child : { ...child, config: { ...child.config, toolFilter: undefined } },
  );
  return { ...row, config };
});
assert.ok(
  configDrift(upstream, mutated, REPLACED_BY_DESIGN).includes("delegation/tool-subagent (config)"),
  "a mirrored row whose configuration lost a field has to be reported",
);
pass("the configuration alarm fires on a nested row that lost a field");

// The lean preset mirrors the shipped `minimal` one. Its shell rows are replaced as a whole — upstream
// keeps them as separate top-level rows, this preset owns one realm group — so the alarm compares the
// rows *outside* that group, and then checks the replacement itself.
const minimalPath = join(upstreamDir, "minimal.patch.yml");
if (!existsSync(minimalPath)) {
  console.log("SKIP  the upstream minimal preset is not next to the located standard one");
} else {
  const upstreamMinimalIds = load(minimalPath)[0].insert[0].config.plugins.map((row) => row.id);
  const ourMinimalIds = new Set(ours.get("bash-native-minimal").map((row) => row.id));
  const REPLACED_IN_MINIMAL = new Set([
    "persistent-shell",
    "pty",
    "terminal-bash",
    "persistent-bash",
    "terminal-pwsh",
    "persistent-pwsh",
  ]);
  const missingMinimal = upstreamMinimalIds.filter((id) => !REPLACED_IN_MINIMAL.has(id) && !ourMinimalIds.has(id));
  assert.deepEqual(
    missingMinimal,
    [],
    `upstream minimal-preset rows missing from the lean preset: ${missingMinimal.join(", ")}. ` +
      "Update lib/preset-data.js (and its test) to mirror the shipped minimal preset.",
  );
  pass("every upstream minimal-preset row except the replaced shell rows is mirrored");

  const extrasMinimal = [...ourMinimalIds].filter((id) => !upstreamMinimalIds.includes(id));
  assert.deepEqual(
    extrasMinimal,
    ["bash-native-shell-minimal"],
    "the only row the lean preset adds is its own realm group",
  );
  pass("the only row the lean preset adds is its own shell group");

  const minimalGroup = ours.get("bash-native-minimal").find((row) => row.id === "bash-native-shell-minimal");
  // Upstream keeps its shell rows inside a group too, so the replacement is checked against the rows in
  // that whole subtree: whichever shape upstream uses, the row this preset replaces has to be there.
  const upstreamMinimalAll = load(minimalPath)[0]
    .insert[0].config.plugins.flatMap((row) => (row.group && Array.isArray(row.config) ? [row, ...row.config] : [row]))
    .map((row) => row.id);
  assert.ok(
    upstreamMinimalAll.includes("persistent-bash") && upstreamMinimalAll.includes("terminal-bash"),
    "upstream's minimal preset still declares the persistent shell rows this preset replaces",
  );
  assert.deepEqual(
    minimalGroup.config.filter((row) => row.name === "@deepseek-ai/dsh-tool-bash-persistent").map((row) => row.disabled ?? false),
    [false],
    "the replaced persistent shell is mounted and enabled inside the lean group",
  );
  pass("the replaced persistent shell is declared inside the lean shell group instead");

  const minimalDrift = configDrift(load(minimalPath)[0].insert[0].config.plugins, ours.get("bash-native-minimal"), REPLACED_IN_MINIMAL);
  assert.deepEqual(
    minimalDrift,
    [],
    `upstream minimal-preset rows whose configuration this lean preset does not mirror: ${minimalDrift.join(", ")}. ` +
      "Copy the row from the shipped preset.",
  );
  pass("every mirrored minimal-preset row carries the upstream configuration");
}

console.log(`\nupstream preset: ${upstreamPath}`);
console.log(`${passed} 项通过`);
