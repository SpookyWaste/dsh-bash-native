// Behaviour checks for the preset registration entry: the composition it builds from the shipped preset
// file of the host's own harness line, the shell surface it replaces there, and what it does when that
// file is missing, reshaped, or belongs to another preset.
//
// The composition is pure and reads one file, so every claim here is a claim about a host tree: a fixture
// package that carries the two preset files, reached through the launcher-owned package service and,
// without that service, through a module resolve from the same base. `test-preset-parity.mjs` runs the
// same rule against the real shipped files; `test-patch.mjs` owns the bundle patch that mounts this entry.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Config, apply, inject, name, registerPresets } from "../lib/presets.js";
import { PRESET_IDS, SHELL_GROUP_IDS, SHIPPED_SOURCES, composePreset } from "../lib/preset-data.js";
import {
  SHIPPED_PRESET_PACKAGE,
  SUPPORTED_PLATFORM,
  isSupportedPlatform,
  parseShippedPreset,
  presetRowsOf,
  readPresetFile,
  readShippedPreset,
} from "../lib/preset-source.js";

let passed = 0;
function pass(label) {
  passed += 1;
  console.log("PASS  " + label);
}

/** The shipped `standard` shape: two platform-conditional shell rows and rows this bundle only carries. */
const STANDARD = `- insert:
    - id: preset-standard
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: standard
        order: 1
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a coding agent powered by the {{model}} model.
          - id: tool-bash
            name: '@deepseek-ai/dsh-tool-bash'
            disabled: !!js process.platform === 'win32'
          - id: tool-pwsh
            name: '@deepseek-ai/dsh-tool-pwsh'
            disabled: !!js process.platform !== 'win32'
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
          - id: tool-jobs
            name: '@deepseek-ai/dsh-tool-jobs'
            disabled: !!js ctx.get('jobs') === undefined
`;

/** The shipped `minimal` shape: the shell rows live inside one group. */
const MINIMAL = `- insert:
    - id: preset-minimal
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: minimal
        order: 3
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You are a helpful software engineer assistant.
              complete: true
          - id: persistent-shell
            name: cordis:group
            group: true
            isolate:
              terminals: true
            config:
              - id: pty
                name: '@deepseek-ai/dsh-terminal'
              - id: terminal-bash
                name: '@deepseek-ai/dsh-terminal-bash'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 300000
              - id: persistent-bash
                name: '@deepseek-ai/dsh-tool-bash-persistent'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 300000
              - id: terminal-pwsh
                name: '@deepseek-ai/dsh-terminal-bash'
                disabled: !!js process.platform !== 'win32'
                config:
                  shellDialect: pwsh
              - id: persistent-pwsh
                name: '@deepseek-ai/dsh-tool-pwsh-persistent'
                disabled: !!js process.platform !== 'win32'
`;

/**
 * A throwaway host tree: one package carrying the shipped preset files, and the file base URL a registry
 * row would expose. The fixture's export map mirrors the real package's, so a resolve of its manifest is
 * the same question the shipped package answers.
 */
function fixtureHost({ standard = STANDARD, minimal = MINIMAL } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "preset-host-"));
  const pkg = join(dir, "node_modules", "@deepseek-ai", "dsh-web-app");
  mkdirSync(join(pkg, "presets"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: SHIPPED_PRESET_PACKAGE, version: "0.0.0-fixture", exports: { ".": "./lib/index.js", "./package.json": "./package.json" } }),
  );
  writeFileSync(join(pkg, "presets", "standard.patch.yml"), standard);
  writeFileSync(join(pkg, "presets", "minimal.patch.yml"), minimal);
  writeFileSync(join(dir, "cordis.patch.yml"), "[]\n");
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  process.on("exit", cleanup);
  return { dir, pkg, baseUrl: pathToFileURL(join(dir, "cordis.patch.yml")).href };
}

/**
 * A fake `agentPresets` service and context.
 *
 * `lookup` is what the launcher-owned package service does: `undefined` for a host that mounts no such
 * service, otherwise the answer it gives for the package this bundle reads — a directory, only a manifest
 * path, nothing, or a throw.
 */
function fakeHost({ baseUrl, lookup, register } = {}) {
  const effects = [];
  const logs = [];
  const warnings = [];
  const calls = { lookups: [], registered: [], unregistered: [] };
  const ctx = {
    get: (service) =>
      service !== "pluginPackages" || lookup === undefined
        ? undefined
        : {
            packageOf(specifier, parentURL) {
              calls.lookups.push({ specifier, parentURL });
              if (lookup === "throw") throw new Error("the lookup is broken");
              if (lookup === "miss") return undefined;
              if (lookup === "manifest") return { manifestPath: join(specifier === SHIPPED_PRESET_PACKAGE ? host.pkg : "", "package.json") };
              if (lookup === "no-directory") return { version: "0.0.0-fake" };
              return { dir: lookup };
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

/** The rows one shipped fixture declares, as the production reader would see them. */
const rowsOfText = (text, id) => presetRowsOf(parseShippedPreset(text, "fixture.patch.yml"), SHIPPED_SOURCES[id], "fixture.patch.yml");

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

const rowsOf = (definition) => definition.plugins;
const rowOf = (definition, id) => rowsOf(definition).find((row) => row.id === id);
/** True when a row anywhere in a composition carries the id, groups included. */
function hasRow(definition, id, prefix = "") {
  for (const row of rowsOf(definition)) {
    if (`${prefix}${row.id}` === id) return true;
    if (Array.isArray(row.config) && hasRow({ plugins: row.config }, id, `${prefix}${row.id}/`)) return true;
  }
  return false;
}

const host = fixtureHost();

// 1. The ids are the pinned ones, the entry declares the registry dependency it needs, and the platform
// contract is the shipped engine's: one platform, asked as a parameter.
{
  assert.deepEqual([...PRESET_IDS], ["bash-native", "bash-native-minimal"]);
  assert.equal(name, "bash-native-presets");
  assert.deepEqual(inject, ["agentPresets"]);
  assert.equal(isSupportedPlatform(SUPPORTED_PLATFORM), true, "the platform the engine exists on is served");
  for (const other of ["linux", "darwin", "aix"]) assert.equal(isSupportedPlatform(other), false, `${other} is not served`);
  pass("the ids, the registry dependency and the one-platform contract are the pinned ones");
}

// 2. The row's own configuration validates the ids it registers.
{
  const configured = Config({});
  assert.deepEqual(configured.presets, ["bash-native", "bash-native-minimal"], "both presets register by default");
  assert.deepEqual(Config({ presets: ["bash-native"] }).presets, ["bash-native"], "a deployment can register one");
  assert.deepEqual(Config({ presets: [] }).presets, [], "and can register none");
  assert.throws(() => Config({ presets: ["native-bash"] }), /presets/, "a typo is rejected at load");
  pass("the row's own configuration validates the ids it registers");
}

// 3. The full preset carries the shipped composition and replaces exactly its shell surface: the realm
// group takes the place of `tool-bash`, the pwsh row is gone, and every other row is the shipped one.
{
  const shipped = rowsOfText(STANDARD, "bash-native");
  const definition = composePreset("bash-native", { path: "standard.patch.yml", rows: shipped });
  assert.equal(definition.id, "bash-native");
  assert.equal(definition.order, 5, "the ids, names and orders this bundle publishes do not move");
  assert.equal(definition.name, "Native Bash (Windows)");
  assert.deepEqual(
    rowsOf(definition).map((row) => row.id),
    ["persona", SHELL_GROUP_IDS["bash-native"], "tool-fs-search", "tool-jobs"],
    "the realm group sits where the shipped one-shot shell row was",
  );
  assert.equal(hasRow(definition, "tool-pwsh"), false, "the shipped pwsh row is not carried into this preset");
  for (const id of ["persona", "tool-fs-search", "tool-jobs"]) {
    assert.deepEqual(canonical(rowOf(definition, id)), canonical(shipped.find((row) => row.id === id)), `the shipped ${id} row is carried verbatim`);
  }
  pass("the full preset carries the shipped rows and replaces only the two shell rows with its realm group");
}

// 4. The realm group is this bundle's contract: one isolated realm holding the executor, the terminal
// pair over it, the shipped one-shot bash tool on this engine, and one persistent shell kept switched off.
{
  const group = rowOf(composePreset("bash-native", { path: "standard.patch.yml", rows: rowsOfText(STANDARD, "bash-native") }), SHELL_GROUP_IDS["bash-native"]);
  assert.equal(group.group, true);
  assert.deepEqual(group.isolate, { shell: true, terminals: true }, "the executor and its terminal registry are realm-scoped");
  assert.deepEqual(
    group.config.map((row) => row.id),
    ["bash-native", "bash-native-terminal", "bash-native-terminal-pty", "tool-bash", "bash-native-persistent"],
  );
  assert.equal(group.config[0].config.requireEngineOnLoad, true);
  // This realm is an agent scope, so the executor's environment section stays inside it — and it has to
  // stay: it is the only place a session running this bundle's bash is told what that shell is. The
  // component that mounts the same executor on the host plane sets `promptSection: false` instead, because
  // a root-plane registration lands in the global layer every preset's agent reads.
  assert.notEqual(group.config[0].config.promptSection, false, "the preset's executor keeps the environment section, scoped to its own sessions");
  assert.match(String(group.config[0].name), /^file:/, "the executor is reached by URL: no installation carries this package");
  const pty = group.config[2];
  assert.deepEqual(Object.keys(pty.config.shellPath), ["__jsExpr"], "the PTY row defers to the realm's executor");
  assert.match(pty.config.shellPath.__jsExpr, /ctx\.get\('shell'\)\?\.enginePath/);
  assert.match(pty.config.shellArgs.__jsExpr, /ctx\.get\('shell'\)\?\.engineArgs/);
  assert.equal(group.config[4].disabled, true, "the shipped standard preset has no persistent shell, so it ships switchable");
  const bashTools = group.config.filter((row) => String(row.name).startsWith("@deepseek-ai/dsh-tool-bash"));
  assert.deepEqual(
    bashTools.filter((row) => row.disabled !== true).map((row) => row.id),
    ["tool-bash"],
    "exactly one enabled row registers the tool name bash",
  );
  pass("the realm group isolates both services, defers the PTY to its own executor, and enables one bash tool");
}

// 5. The shipped one-shot bash row is carried into the group: its own configuration follows upstream, and
// the platform condition that decides which shipped shell is enabled does not.
{
  const withConfig = STANDARD.replace(
    "            disabled: !!js process.platform === 'win32'\n          - id: tool-pwsh",
    "            disabled: !!js process.platform === 'win32'\n            config:\n              timeoutMs: 60000\n          - id: tool-pwsh",
  );
  const definition = composePreset("bash-native", { path: "standard.patch.yml", rows: rowsOfText(withConfig, "bash-native") });
  const bash = rowOf(definition, SHELL_GROUP_IDS["bash-native"]).config.find((row) => row.id === "tool-bash");
  assert.deepEqual(bash.config, { timeoutMs: 60000 }, "a shipped option this bundle does not know about is not dropped");
  assert.equal(bash.disabled, undefined, "the shipped platform condition is dropped: inside the group the row runs on this engine");
  pass("the shipped bash row is carried with its configuration and without its platform condition");
}

// 6. A carried row's own `!!js` node is left for the Loader, exactly as the shipped file spells it.
{
  const definition = composePreset("bash-native", { path: "standard.patch.yml", rows: rowsOfText(STANDARD, "bash-native") });
  assert.deepEqual(rowOf(definition, "tool-jobs").disabled, { __jsExpr: "ctx.get('jobs') === undefined" }, "a shipped expression is carried unevaluated");
  pass("a carried row keeps the shipped `!!js` node for the Loader to evaluate");
}

// 7. The lean preset replaces the shipped shell group as a whole, and carries the rows beside it.
{
  const shipped = rowsOfText(MINIMAL, "bash-native-minimal");
  const definition = composePreset("bash-native-minimal", { path: "minimal.patch.yml", rows: shipped });
  assert.deepEqual(
    rowsOf(definition).map((row) => row.id),
    ["persona", SHELL_GROUP_IDS["bash-native-minimal"]],
    "the shipped shell group is replaced in place, and nothing else moves",
  );
  assert.deepEqual(canonical(rowOf(definition, "persona")), canonical(shipped.find((row) => row.id === "persona")));
  const group = rowOf(definition, SHELL_GROUP_IDS["bash-native-minimal"]);
  assert.deepEqual(group.isolate, { shell: true, terminals: true });
  assert.deepEqual(
    group.config.map((row) => row.id),
    ["bash-native", "bash-native-terminal", "bash-native-terminal-pty", "bash-native-persistent"],
    "the lean shell is the persistent one: the shipped minimal preset has no one-shot tool",
  );
  assert.notEqual(group.config[3].disabled, true, "and it is mounted, unlike the full preset's switchable extra");
  assert.equal(group.config.some((row) => row.name === "@deepseek-ai/dsh-tool-pwsh-persistent"), false, "no pwsh tool is carried");
  pass("the lean preset replaces the shipped shell group as a whole and mounts one persistent shell");
}

// 8. The shipped surface is declared by id, so a release that reshapes it is refused instead of mounted
// with two shells in it, a missing row, or a shell group that gained a row this bundle would leave beside
// its own.
{
  const missing = STANDARD.replace("          - id: tool-pwsh\n            name: '@deepseek-ai/dsh-tool-pwsh'\n            disabled: !!js process.platform !== 'win32'\n", "");
  assert.throws(
    () => composePreset("bash-native", { path: "standard.patch.yml", rows: rowsOfText(missing, "bash-native") }),
    /no longer declares tool-pwsh/,
    "a declared shell row that is gone has to be reported",
  );

  const gained = MINIMAL.replace(
    "              - id: persistent-pwsh\n                name: '@deepseek-ai/dsh-tool-pwsh-persistent'\n                disabled: !!js process.platform !== 'win32'\n",
    "              - id: persistent-pwsh\n                name: '@deepseek-ai/dsh-tool-pwsh-persistent'\n                disabled: !!js process.platform !== 'win32'\n              - id: terminal-fish\n                name: '@deepseek-ai/dsh-terminal-bash'\n",
  );
  assert.throws(
    () => composePreset("bash-native-minimal", { path: "minimal.patch.yml", rows: rowsOfText(gained, "bash-native-minimal") }),
    /keeps terminal-fish beside the shell rows/,
    "a shell row this bundle does not replace must not mount beside its own shell",
  );

  const split = STANDARD.replace(
    "          - id: tool-pwsh\n            name: '@deepseek-ai/dsh-tool-pwsh'\n            disabled: !!js process.platform !== 'win32'\n",
    "          - id: shells\n            name: cordis:group\n            group: true\n            config:\n              - id: tool-pwsh\n                name: '@deepseek-ai/dsh-tool-pwsh'\n",
  );
  assert.throws(
    () => composePreset("bash-native", { path: "standard.patch.yml", rows: rowsOfText(split, "bash-native") }),
    /both top-level and inside shells/,
    "one declared surface in two shapes is a reshape, not two surfaces",
  );
  pass("a reshaped shell surface is refused with the row it is missing or gained");
}

// 9. The file is checked as the preset it must be: another preset's body, a file with no declaration, a
// document that is not a patch list, text that is not YAML, and a declaration with no rows are all refused
// with the path and the reason.
{
  const cases = [
    [STANDARD.replace("id: standard", "id: ptc"), "bash-native", /declares the id "ptc", not "standard"/],
    ["- insert:\n    - id: unrelated\n      name: '@deepseek-ai/dsh-tool-jobs'\n", "bash-native", /inserts no @deepseek-ai\/dsh-agent-preset row/],
    ["[]\n", "bash-native", /inserts no row/],
    ["[1, 2\n", "bash-native", /not valid YAML/],
    ["- insert:\n    - id: preset-standard\n      name: '@deepseek-ai/dsh-agent-preset'\n      config:\n        id: standard\n        plugins: []\n", "bash-native", /declares no rows/],
  ];
  for (const [text, id, expected] of cases) {
    assert.throws(() => rowsOfText(text, id), expected);
  }
  pass("a file that is not this preset's composition is refused, naming the reason");
}

// 10. Locating the shipped file asks the launcher-owned package service first, and answers the same file
// from a module resolve when the service is missing, broken, or unable to name a directory.
{
  const path = join(host.pkg, "presets", "standard.patch.yml");
  const direct = await readPresetFile(path, SHIPPED_SOURCES["bash-native"]);
  assert.deepEqual(direct.rows.map((row) => row.id), ["persona", "tool-bash", "tool-pwsh", "tool-fs-search", "tool-jobs"]);
  assert.equal(direct.path, path);

  const byService = fakeHost({ baseUrl: host.baseUrl, lookup: host.pkg });
  assert.deepEqual(await readShippedPreset(byService.ctx, host.baseUrl, SHIPPED_SOURCES["bash-native"]), direct);
  assert.deepEqual(byService.calls.lookups, [{ specifier: SHIPPED_PRESET_PACKAGE, parentURL: host.baseUrl }], "the service was asked first");
  const byManifest = fakeHost({ baseUrl: host.baseUrl, lookup: "manifest" });
  assert.deepEqual(await readShippedPreset(byManifest.ctx, host.baseUrl, SHIPPED_SOURCES["bash-native"]), direct, "a manifest path answers the same directory");

  for (const lookup of [undefined, "miss", "throw", "no-directory"]) {
    const candidate = fakeHost({ baseUrl: host.baseUrl, lookup });
    assert.deepEqual(
      await readShippedPreset(candidate.ctx, host.baseUrl, SHIPPED_SOURCES["bash-native"]),
      direct,
      `the resolve fallback carries a host whose service answer is ${String(lookup)}`,
    );
  }
  pass("the shipped file is located through the package service, or a resolve from the same base");
}

// 11. A host that can answer neither question fails the entry with both answers, instead of composing a
// preset out of nothing.
{
  const empty = mkdtempSync(join(tmpdir(), "preset-empty-"));
  process.on("exit", () => rmSync(empty, { recursive: true, force: true }));
  writeFileSync(join(empty, "cordis.patch.yml"), "[]\n");
  const baseUrl = pathToFileURL(join(empty, "cordis.patch.yml")).href;
  await assert.rejects(
    () => readShippedPreset(fakeHost({ baseUrl }).ctx, baseUrl, SHIPPED_SOURCES["bash-native"]),
    (error) => {
      assert.match(error.message, /cannot locate @deepseek-ai\/dsh-web-app/);
      assert.match(error.message, /pluginPackages is not mounted/, "the first question's answer is reported");
      assert.match(error.message, /could not resolve @deepseek-ai\/dsh-web-app\/package\.json/, "and so is the second's");
      return true;
    },
  );
  pass("a host that cannot locate the shipped package fails the entry with both answers");
}

// 12. The entry registers what each shipped file composes, reports what it carried, and unregisters on
// disposal.
{
  const fixture = fixtureHost();
  const { ctx, calls, logs, dispose } = fakeHost({ baseUrl: fixture.baseUrl, lookup: fixture.pkg });
  await apply(ctx, { presets: [...PRESET_IDS] });
  assert.deepEqual(calls.registered.map((definition) => definition.id), [...PRESET_IDS]);
  assert.deepEqual(calls.registered[0].plugins.map((row) => row.id), ["persona", SHELL_GROUP_IDS["bash-native"], "tool-fs-search", "tool-jobs"]);
  assert.deepEqual(calls.registered[1].plugins.map((row) => row.id), ["persona", SHELL_GROUP_IDS["bash-native-minimal"]]);
  assert.equal(logs.length, 2, "each registration reports what it carried");
  assert.match(
    logs[0],
    new RegExp(
      `preset 'bash-native' registered \\(4 rows; 3 carried from standard\\.patch\\.yml; tool-bash \\+ tool-pwsh replaced by ${SHELL_GROUP_IDS["bash-native"]}; .*standard\\.patch\\.yml\\)$`,
    ),
  );
  assert.match(logs[1], /preset 'bash-native-minimal' registered \(2 rows; 1 carried from minimal\.patch\.yml/);
  dispose();
  assert.deepEqual(calls.unregistered, [...PRESET_IDS], "disposal unregisters both definitions");
  pass("the entry registers both compositions, reports what it carried, and unregisters on disposal");
}

// 13. Off Windows nothing is read and nothing is registered: the presets would advertise a shell this
// bundle cannot start, and the warning says which platform it saw.
{
  const { ctx, calls, warnings, logs } = fakeHost({ baseUrl: "file:///nonexistent/" });
  await registerPresets(ctx, { presets: [...PRESET_IDS] }, "linux");
  assert.deepEqual(calls.registered, []);
  assert.deepEqual(calls.lookups, [], "the shipped package is not even looked up");
  assert.deepEqual(logs, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /not registering the agent presets/);
  assert.match(warnings[0], /platform 'linux' is not supported/);
  pass("off Windows the entry reads nothing and reports the platform it refused");
}

// 14. An empty selection registers nothing and reads nothing.
{
  const quiet = fakeHost({ baseUrl: "file:///nonexistent/" });
  await apply(quiet.ctx, { presets: [] });
  assert.deepEqual(quiet.calls.registered, []);
  assert.deepEqual(quiet.calls.lookups, [], "with no preset selected there is nothing to read");
  assert.deepEqual(quiet.logs, []);
  pass("an empty selection registers nothing and reads nothing");
}

// 15. An upgrade in place reports the id it could not take, and still registers the other one.
//
// This is the shape a running app has when the previous version's declaration row is still mounted —
// bundle layers are read at process start, so removing the old package does not unmount them. The
// registry throws `Duplicate agent preset: <id>`; the entry has to survive it, because the alternative is
// "1 entry did not activate" on every upgrade, with the same restart as the only way forward.
{
  const fixture = fixtureHost();
  const taken = "Duplicate agent preset: bash-native";
  const upgraded = fakeHost({
    baseUrl: fixture.baseUrl,
    lookup: fixture.pkg,
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
    baseUrl: fixture.baseUrl,
    lookup: fixture.pkg,
    register: async () => {
      throw new Error("the composition must be a top-level list of plugin rows");
    },
  });
  await assert.rejects(() => apply(broken.ctx, { presets: ["bash-native"] }), /top-level list/);
  const otherId = fakeHost({
    baseUrl: fixture.baseUrl,
    lookup: fixture.pkg,
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