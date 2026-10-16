// Drift alarm for the shell surface this bundle replaces. A bundle patch cannot address rows inside an
// agent preset, so each of this bundle's presets is the host's own shipped `standard`/`minimal`
// composition — read from the installation at boot and carried verbatim — with the shipped shell rows
// replaced by this bundle's realm group. Every other row follows upstream for free; what can break on an
// upstream release is the shape of the surface the replacement is anchored to, and this check runs the
// production rule against the real shipped files so that a reshape is reported on the release that first
// sees it instead of failing a mount on a user's machine.
//
// Upstream's preset is not a dependency, so the check needs a path to it, in this order:
// `DSH_WEB_APP_PRESET`; an installed `@deepseek-ai/dsh-web-app` this package can resolve; and — the case
// that makes the check run on a machine that installed the harness globally — that harness's own copy of
// the preset. A CI runner has none of the three, so the workflow fetches the one tarball the preset lives
// in with `scripts/fetch-upstream-preset.mjs` and exports the path (that script mirrors the newest published
// version, which keeps the reference moving without letting a dist-tag that lags decide what "newest" means;
// it also writes the lean preset beside the standard one, so the minimal half is no longer skipped). Without
// any of them the check skips and says what to run.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { SHELL_GROUP_IDS, SHIPPED_SOURCES, composePreset } from "../lib/preset-data.js";
import { readPresetFile } from "../lib/preset-source.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

/**
 * The shipped top-level rows the surface occupies, per preset.
 *
 * `standard` spells its shells as two rows; `minimal` spells them as the children of one group. The
 * production rule replaces the declared child ids wherever they sit, so it does not need the group's name —
 * but the position of the replacement does, and pinning that name here is what makes a de-grouped or
 * renamed surface a reported drift instead of a preset whose group lands somewhere else.
 */
const SURFACE_ROWS = {
  "bash-native": ["tool-bash", "tool-pwsh"],
  "bash-native-minimal": ["persistent-shell"],
};

/**
 * The one row inside each group that registers the `bash` tool name enabled.
 *
 * On Windows the shipped `standard` preset means its one-shot bash tool to be the enabled shell, so the
 * full preset mounts that row on this engine; the shipped `minimal` preset carries no one-shot tool at all,
 * so the lean preset's one persistent shell is the enabled one.
 */
const ENABLED_BASH_ROWS = {
  "bash-native": ["tool-bash"],
  "bash-native-minimal": ["bash-native-persistent"],
};

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

/** Every `!!js` expression node in a value tree, as its object path. */
function jsExprPaths(value, path = "", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => jsExprPaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (value === null || typeof value !== "object") return found;
  for (const [key, item] of Object.entries(value)) {
    const next = path === "" ? key : `${path}.${key}`;
    if (key === "__jsExpr") found.push(next);
    jsExprPaths(item, next, found);
  }
  return found;
}

/** Every row of a composition, keyed by path so a group's children keep their group in the key. */
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

/** Locate the installed shipped preset, or null when this environment does not have it. */
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

/**
 * Assert one shipped file is carried whole, with exactly its shell surface replaced.
 *
 * Nothing here re-implements the replacement: the production reader parses the file and the production
 * rule composes it, so a green run means the shipped file still has the shape this bundle anchors to. What
 * the checks add is the other half of the contract — that every row beside the surface arrives verbatim,
 * that the shipped platform branches are exactly the rows being replaced, and that the realm group mounts
 * one bash tool and no pwsh tool.
 * @param id - which of this bundle's presets to check.
 * @param path - the shipped file to read.
 * @returns the row count and the carried count, for the closing summary.
 */
async function checkShipped(id, path) {
  const source = SHIPPED_SOURCES[id];
  const groupId = SHELL_GROUP_IDS[id];
  const shipped = await readPresetFile(path, source);
  const definition = composePreset(id, shipped);

  const shippedIds = shipped.rows.map((row) => row.id);
  const surface = SURFACE_ROWS[id];
  const at = shippedIds.indexOf(surface[0]);
  assert.notEqual(at, -1, `${path} no longer carries ${surface[0]} at the top level`);
  const expectedIds = shippedIds.filter((rowId) => !surface.includes(rowId));
  expectedIds.splice(at, 0, groupId);
  assert.deepEqual(
    definition.plugins.map((row) => row.id),
    expectedIds,
    `the composed ${id} has to be ${path} with ${surface.join(", ")} replaced by ${groupId}, in place`,
  );
  pass(`${id}: the realm group stands exactly where ${path} spelled its shell surface`);

  const composed = rowIndex(definition.plugins);
  const upstream = rowIndex(shipped.rows);
  const drift = [];
  for (const [key, row] of composed) {
    // The realm group and everything it mounts are this bundle's own rows, not the shipped file's.
    if (key === groupId || key.startsWith(`${groupId}/`)) continue;
    const mine = upstream.get(key);
    if (mine === undefined) {
      drift.push(`${key} (not in ${path})`);
      continue;
    }
    if (JSON.stringify(canonical(row)) !== JSON.stringify(canonical(mine))) drift.push(`${key} (fields)`);
  }
  for (const key of upstream.keys()) {
    if (composed.has(key) || surface.some((rowId) => key === rowId || key.startsWith(`${rowId}/`))) continue;
    drift.push(`${key} (dropped)`);
  }
  assert.deepEqual(drift, [], `shipped rows whose composition this preset does not carry verbatim: ${drift.join(", ")}. Fix lib/preset-data.js or the read in lib/preset-source.js.`);
  pass(`${id}: every shipped row beside the shell surface is carried verbatim`);

  // Only what is carried matters: the deferred expressions inside this bundle's own group (the PTY row
  // reading the realm's executor) are its own contract and belong there.
  const expressions = jsExprPaths(definition.plugins.filter((row) => row.id !== groupId));
  assert.deepEqual(
    expressions,
    [],
    `the composed ${id} carries a shipped \`!!js\` at ${expressions.join(", ")}; the shipped platform branches live on the rows this bundle replaces, so a new expression has to be reviewed before it runs in this bundle's realm`,
  );
  pass(`${id}: no shipped expression is carried into this bundle's realm`);

  const group = definition.plugins.find((row) => row.id === groupId);
  assert.deepEqual(group.isolate, { shell: true, terminals: true }, "the executor and its terminal registry are realm-scoped");
  const bashTools = group.config.filter((row) => String(row.name).startsWith("@deepseek-ai/dsh-tool-bash"));
  assert.deepEqual(
    bashTools.filter((row) => row.disabled !== true).map((row) => row.id),
    ENABLED_BASH_ROWS[id],
    "exactly one enabled row registers the tool name bash",
  );
  const pwsh = rowIndex(definition.plugins);
  assert.equal([...pwsh.keys()].some((key) => key.endsWith("pwsh") || key.includes("pwsh/")), false, "no pwsh row or tool is carried");
  assert.equal(rowIndex(group.config).size > 0, true, "the group mounts rows of its own");
  pass(`${id}: the realm group mounts one bash tool on this bundle's engine and no pwsh tool`);

  if (id === "bash-native-minimal") {
    const persistent = group.config.find((row) => row.name === "@deepseek-ai/dsh-tool-bash-persistent");
    assert.equal(persistent.disabled, undefined, "the lean preset's shell is the mounted one");
    pass(`${id}: the persistent shell is mounted, as the shipped minimal preset means it on Windows`);
  }
  return { rows: definition.plugins.length, carried: definition.plugins.length - 1, shipped: shipped.rows.length };
}

const standard = await checkShipped("bash-native", upstreamPath);
console.log(`\nupstream preset: ${upstreamPath} (${standard.shipped} rows, ${standard.carried} carried)`);

// The alarm is only worth its line if it can fire. The mutation is on copies of the parsed file, so the
// checks above still read the file's own rows: renaming the row the surface is anchored to has to be
// refused, which is what an upstream reshape looks like from here.
{
  const shipped = await readPresetFile(upstreamPath, SHIPPED_SOURCES["bash-native"]);
  const renamed = shipped.rows.map((row) => (row.id === "tool-pwsh" ? { ...row, id: "tool-fish" } : row));
  assert.throws(
    () => composePreset("bash-native", { path: upstreamPath, rows: renamed }),
    /no longer declares tool-pwsh/,
    "a renamed shell row has to be reported, not mounted beside this bundle's own shell",
  );
  pass("the alarm fires on a reshaped shell surface");
}

// The lean preset follows the shipped `minimal` file that sits beside the located standard one; a CI
// runner that fetched only one of them reports that instead of passing silently.
{
  const minimalPath = join(dirname(upstreamPath), "minimal.patch.yml");
  if (!existsSync(minimalPath)) {
    console.log("SKIP  the upstream minimal preset is not next to the located standard one");
  } else {
    const minimal = await checkShipped("bash-native-minimal", minimalPath);
    console.log(`upstream preset: ${minimalPath} (${minimal.shipped} rows, ${minimal.carried} carried)`);
  }
}

console.log(`\n${passed} 项通过`);