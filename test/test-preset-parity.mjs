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

/**
 * The shipped `!!js` nodes each composition carries on purpose, row id and property path to expression.
 *
 * A carried expression is not evaluated by this bundle and must not be: `@deepseek-ai/dsh-agent-preset`
 * hands the shipped definition to `ctx.agentPresets.register()`, this bundle hands its composed definition
 * to the same method, the registry activates both from one owner scope, and the Loader asks each entry's
 * own context for its `disabled` node. Carrying the node verbatim is therefore what keeps the row's meaning
 * equal to the shipped preset's; resolving it here would evaluate it against this package's plane instead.
 *
 * What this table pins is the review, not the carry. The shipped expressions used to be exactly the
 * platform branches on the shell surface this bundle replaces — rows that never reach a mount here — so a
 * new one anywhere else means a shipped row now enters this bundle's preset with a condition of its own,
 * and the run fails until someone decides it is right. Changed text fails the same way, and so does an
 * entry that upstream removed.
 *
 * `standard.patch.yml` at `@deepseek-ai/dsh-web-app` 0.2.2-alpha.2 (reviewed 2026-11-02): the model-facing
 * plugin-manager tools are disabled in a session that has no profile context. It reads a root service the
 * preset's mount context already sees, and it is the host's row — neither the shell surface nor anything
 * this bundle provides.
 */
const REVIEWED_SHIPPED_EXPRESSIONS = {
  "bash-native": new Map([["tool-plugin-manager.disabled", "!ctx.get('profileContext')"]]),
  "bash-native-minimal": new Map(),
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

/**
 * Every `!!js` expression a composition carries, keyed by row id and property path, with its text.
 *
 * The text is part of the identity: an upstream release that rewrites an expression in place has to land
 * as a change, not pass because the path is unchanged. Rows of the realm group are skipped — the deferred
 * expressions inside it are this bundle's own contract, not something the shipped file declares.
 * @param rows - the composed top-level rows.
 * @param groupId - the realm group this bundle mounts in place of the shipped shell surface.
 * @returns one `{ key, expression }` per carried node, e.g. `{ key: "tool-plugin-manager.disabled", … }`.
 */
function carriedExpressions(rows, groupId) {
  const found = [];
  const walk = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (typeof value.__jsExpr === "string") {
      found.push({ key: path, expression: value.__jsExpr });
      return;
    }
    for (const [key, item] of Object.entries(value)) walk(item, path === "" ? key : `${path}.${key}`);
  };
  for (const row of rows) {
    if (row.id === groupId || row.id.startsWith(`${groupId}/`)) continue;
    walk(row, row.id);
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

  // Carried expressions are handed to the Loader, so the alarm is over what upstream's file decides runs
  // under this bundle's preset ids: exactly the reviewed set, matched on text as well as on position.
  const carried = carriedExpressions(definition.plugins, groupId);
  const spelling = ({ key, expression }) => `${key} = ${JSON.stringify(expression)}`;
  assert.deepEqual(
    carried.map(spelling).sort(),
    [...REVIEWED_SHIPPED_EXPRESSIONS[id]].map(([key, expression]) => spelling({ key, expression })).sort(),
    `the shipped \`!!js\` nodes carried by ${id} are not the reviewed set (carried: ${carried.map(spelling).join("; ") || "none"}). A new or rewritten expression decides a shipped row's enablement under this bundle's preset id, so read it and record it in REVIEWED_SHIPPED_EXPRESSIONS`,
  );
  pass(`${id}: every shipped expression the preset carries is a reviewed one`);

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