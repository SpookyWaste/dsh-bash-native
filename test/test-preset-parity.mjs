// Drift alarm for the copied preset body. The plugin mirrors the shipped `standard` preset's
// tool list because a bundle patch cannot address rows inside an agent preset; when upstream
// adds or removes a tool, this check says so instead of leaving our preset quietly stale.
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
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const JS_TAG = { tag: "tag:yaml.org,2002:js", resolve: (value) => ({ __js: value }) };
const load = (path) => parse(readFileSync(path, "utf8"), { customTags: [JS_TAG] });

/** Rows a bundle cannot address inside an agent preset, so this preset deliberately replaces them. */
const REPLACED_BY_DESIGN = new Set(["tool-bash", "tool-pwsh"]);

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

/** The shipped preset rows this bundle mirrors, keyed by the preset id they register. */
const ours = new Map(
  load(`${root}cordis.patch.yml`)[0].insert.map((row) => [row.config?.id, row.config.plugins]),
);

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
    "Update cordis.patch.yml (and its test) to mirror the shipped standard preset.",
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
      "Update cordis.patch.yml (and its test) to mirror the shipped minimal preset.",
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
}

console.log(`\nupstream preset: ${upstreamPath}`);
console.log(`${passed} 项通过`);
