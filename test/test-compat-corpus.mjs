// Scores the compatibility corpus against a real engine, and ratchets against a recorded baseline.
//
// Why this exists: the plugin's promise is that an agent's ordinary bash knowledge works on the
// first try. That promise is only testable as a body of real snippets with their POSIX-correct
// expectations, and three outcomes matter differently:
//   * `fail`          — the snippet behaved differently from POSIX;
//   * `silent-wrong`  — it exited with the expected status but produced the wrong output, which is
//                       the dangerous class (an agent cannot notice it) and is never acceptable
//                       unless the corpus itself declares the gap with a `knownGap` pointer;
//   * `collision`     — the name resolves to an unrelated Windows program (`find`, `timeout`),
//                       which the toolchain directory is expected to shadow.
//
// Usage:
//   node test-compat-corpus.mjs                    ratchet against corpus/baseline.json
//   node test-compat-corpus.mjs --update-baseline  record the current result as the baseline
//   node test-compat-corpus.mjs --with-tools       prepend the local toolchain directory to PATH
//   node test-compat-corpus.mjs --tools-dir=DIR    score an arbitrary toolchain
//   DSH_BASH_NATIVE_COMPAT_FULL=1                  print the distance to all-green (a diagnostic, not a gate)
//
// Skipped unless an engine is available: `DSH_BASH_NATIVE_ENGINE`, or a `brush` on PATH.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRunner,
  engineVersion,
  findEngine,
  matchesOutput,
  normalizeOutput,
  pathWithToolchain,
  probeNeeds,
  toolsDirectory,
  violatesGuards,
} from "../scripts/engine-harness.mjs";

const BASELINE_ENGINE_PATH = new URL("../corpus/baseline.json", import.meta.url);
const BASELINE_TOOLS_PATH = new URL("../corpus/baseline-tools.json", import.meta.url);
const REPORT_PATH = new URL("../corpus/report.md", import.meta.url);
const FULL = process.env.DSH_BASH_NATIVE_COMPAT_FULL === "1";
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const toolsDir = toolsDirectory(process.argv, process.env);
const withTools = process.argv.includes("--with-tools") || process.argv.some((arg) => arg.startsWith("--tools-dir="));
// The engine alone and the engine plus the toolchain are two different environments with two
// different records, so each keeps its own baseline.
const BASELINE_PATH = withTools ? BASELINE_TOOLS_PATH : BASELINE_ENGINE_PATH;

if (toolsDir.length === 0) {
  console.error("no toolchain directory configured (pass --tools-dir=DIR or set DSH_BASH_NATIVE_TOOLS)");
  process.exit(2);
}

const engine = findEngine();
if (engine === null) {
  console.log(
    "SKIP  test-compat-corpus.mjs: no engine available (set DSH_BASH_NATIVE_ENGINE to a bash-compatible engine path, or put brush on PATH)",
  );
  process.exit(0);
}

const corpus = JSON.parse(readFileSync(new URL("../corpus/compat.json", import.meta.url), "utf8"));

/**
 * How long one snippet may run before it is recorded as a failure.
 *
 * The corpus is the only gate that runs real snippets, so a snippet that never returns would hang it: the
 * blocking shapes this project has fixed (a pipeline stage waiting for a reader that was never started)
 * are exactly of that kind, and they have to be pinned rather than avoided. Generous on purpose: the
 * slowest declared case sleeps half a second, and a machine under load must not turn that into a failure.
 */
const CASE_TIMEOUT_MS = 20000;
const FIXTURE = mkdtempSync(join(tmpdir(), "dsh-bash-native-corpus-"));
const run = createRunner(engine, FIXTURE);
const env = { ...process.env, PATH: pathWithToolchain({ withTools, toolsDir, engine, basePath: process.env.PATH ?? "" }) };
const normalize = normalizeOutput;

/**
 * Replaces the machine-specific directories a recorded value may carry with placeholders.
 *
 * A baseline is committed, so anything recorded into it is published. Two kinds of string have to go:
 * the profile directory, which is personal, and this checkout's own location, which is not but is still
 * nobody else's business — and which a confined session has to redirect `TMP` into, so it reaches the
 * baseline through the ordinary gate run rather than through anything unusual.
 *
 * The profile is matched on its shape rather than on this machine's own paths, because it arrives in two
 * spellings: the engine reports the long name, while a value the host handed it may still be the 8.3 form
 * (`C:\Users\EXAMPL~1`). The checkout is matched on the prefix it actually has — and with both separator
 * styles, since a recorded path may have been normalized either way.
 * @param text - the text about to be recorded.
 * @returns the text with each directory replaced by its placeholder.
 */
function redactMachinePaths(text) {
  const checkout = dirname(dirname(fileURLToPath(import.meta.url)));
  // Longest prefix first: the checkout sits inside the workspace, so replacing the workspace first would
  // consume the checkout's own path and leave `<WORKSPACE>\dsh-bash-native` looking like a workspace.
  const prefixes = [
    [checkout, "<CHECKOUT>"],
    [dirname(checkout), "<WORKSPACE>"],
  ];
  let redacted = text.replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/g, "<HOME>");
  for (const [from, to] of prefixes) {
    for (const spelling of [from, from.replace(/\\/g, "/")]) {
      redacted = redacted.split(spelling).join(to);
    }
  }
  return redacted;
}

/** Resolve each declared need to a path, separating absent commands from Windows impostors. */
function needsOf(entry, cwd) {
  return probeNeeds(run, entry.needs ?? [], { cwd, env });
}

const results = [];
for (const entry of corpus.cases) {
  const cwd = join(FIXTURE, entry.id);
  mkdirSync(cwd, { recursive: true });
  for (const name of entry.files ?? []) writeFileSync(join(cwd, name), corpus.fixtures[name]);

  const { missing, collisions, foreign } = needsOf(entry, cwd);
  if (collisions.length > 0) {
    results.push({ entry, outcome: "collision", reason: collisions.join(", ") });
    continue;
  }
  if (foreign.length > 0) {
    // An MSYS build from a Git for Windows installation answers the name. It is not the implementation this
    // project ships and it expands globs inside its own argv, so the case skips here exactly as it does on a
    // machine that has no toolchain at all.
    results.push({ entry, outcome: "skip", reason: `foreign implementation ${foreign.join(", ")}`, host: entry.host === true });
    continue;
  }
  if (missing.length > 0) {
    results.push({ entry, outcome: "skip", reason: `missing ${missing.join(", ")}`, host: entry.host === true });
    continue;
  }

  const budget = entry.timeoutMs ?? CASE_TIMEOUT_MS;
  const captured = run(entry.snippet, { cwd, env, timeout: budget });
  if (captured.status === null) {
    // Outliving the budget is the one failure a snippet cannot report about itself: a pipeline stage that
    // waits for a reader which was never started used to hang the whole run right here. It is a failure
    // rather than a skip, because every case that reaches this point has its declared needs satisfied.
    results.push({ entry, outcome: "fail", detail: `timed out after ${budget} ms`, timedOut: true });
    continue;
  }
  if (entry.severity === "platform-difference") {
    // The raw text is recorded for the report but never ratcheted: it legitimately contains
    // timestamps and machine-specific strings. Only a declared shape can gate a run. The one thing it
    // must not record is whose machine this is, so the profile directory is replaced before the text
    // reaches the baseline — a baseline is committed, and an absolute `C:\Users\<name>\…` in it is a
    // name and a directory layout nobody asked to publish.
    const observed = { status: captured.status, stdout: redactMachinePaths(normalize(captured.stdout)) };
    const shape = entry.expect.stdout ?? {};
    if ((shape.matches !== undefined || shape.contains !== undefined) && !matchesOutput(captured.stdout, shape)) {
      results.push({
        entry,
        outcome: "fail",
        detail: `platform shape not met: status ${captured.status}, stdout ${JSON.stringify(observed.stdout.trim())}`,
      });
      continue;
    }
    results.push({ entry, outcome: "platform", observed });
    continue;
  }

  const expectation = entry.expect.stdout ?? {};
  const outputOk = matchesOutput(captured.stdout, expectation) && !violatesGuards(captured.stdout, expectation);
  const expectedStatus = entry.expect.status ?? 0;
  const statusOk = captured.status === expectedStatus;
  if (outputOk && statusOk) {
    results.push({ entry, outcome: "pass" });
    continue;
  }
  const detail = `status ${captured.status} (want ${expectedStatus}), stdout ${JSON.stringify(captured.stdout.trim())}${captured.stderr.trim().length > 0 ? `, stderr ${JSON.stringify(captured.stderr.trim().split(/\r?\n/)[0])}` : ""}`;
  // "Silent" means there was nothing to notice: the expected status came back with the wrong output
  // *and* an empty stderr. A tool that complains loudly is a plain failure, which an agent can act on.
  const silent = !outputOk && captured.status === expectedStatus && captured.stderr.trim().length === 0;
  if (entry.knownGap !== undefined) {
    results.push({ entry, outcome: "known-gap", detail, silent, pointer: entry.knownGap });
    continue;
  }
  results.push({ entry, outcome: "fail", detail, silentWrong: silent });
}

const pick = (outcome) => results.filter((result) => result.outcome === outcome);
const failures = pick("fail");
const knownGaps = pick("known-gap");
const silentWrong = failures.filter((result) => result.silentWrong === true);
const collisions = pick("collision");
const skips = pick("skip");
const platform = pick("platform");
const passes = pick("pass");
const counts = {
  total: corpus.cases.length,
  pass: passes.length,
  fail: failures.length,
  skip: skips.length,
  collision: collisions.length,
  knownGap: knownGaps.length,
  platform: platform.length,
  silentWrong: silentWrong.length,
};

const byCategory = new Map();
for (const result of results) {
  const bucket = byCategory.get(result.entry.category) ?? { pass: 0, fail: 0, skip: 0, collision: 0, knownGap: 0, platform: 0, silentWrong: 0 };
  bucket[result.outcome === "known-gap" ? "knownGap" : result.outcome] += 1;
  if (result.silentWrong === true) bucket.silentWrong += 1;
  byCategory.set(result.entry.category, bucket);
}

const current = {
  generated: new Date().toISOString(),
  engine: engineVersion(engine),
  toolchain: withTools && toolsDir.length > 0 ? redactMachinePaths(toolsDir) : "engine-only",
  counts,
  skips: Object.fromEntries(skips.map((result) => [result.entry.id, result.reason])),
  collisions: Object.fromEntries(collisions.map((result) => [result.entry.id, result.reason])),
  knownGaps: Object.fromEntries(knownGaps.map((result) => [result.entry.id, `${result.pointer}: ${result.detail}`])),
  failures: Object.fromEntries(failures.map((result) => [result.entry.id, result.detail])),
  platform: Object.fromEntries(platform.map((result) => [result.entry.id, result.observed])),
};

/** Write the human-readable report next to the baseline. */
function writeReport(notes) {
  const lines = [
    "# Compatibility corpus report",
    "",
    `Engine: \`${engine}\` (${current.engine || "version unknown"})`,
    `Toolchain: \`${current.toolchain}\``,
    `Generated: ${current.generated}`,
    "",
    `Pass ${counts.pass}/${counts.total} · fail ${counts.fail} · known-gap ${counts.knownGap} · collision ${counts.collision} · skip ${counts.skip} · platform-difference ${counts.platform} · **silent-wrong ${counts.silentWrong}**`,
    "",
    "| category | pass | fail | known-gap | collision | skip | platform | silent-wrong |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [category, bucket] of [...byCategory].sort((left, right) => left[0].localeCompare(right[0]))) {
    lines.push(
      `| ${category} | ${bucket.pass} | ${bucket.fail} | ${bucket.knownGap} | ${bucket.collision} | ${bucket.skip} | ${bucket.platform} | ${bucket.silentWrong} |`,
    );
  }
  if (notes.length > 0) lines.push("", "## Notes", "", ...notes.map((note) => `- ${note}`));
  if (failures.length > 0) {
    lines.push("", "## Failures", "");
    for (const result of failures) lines.push(`- **${result.entry.id}**${result.silentWrong === true ? " (silent-wrong)" : ""}: ${result.detail}`);
  }
  if (knownGaps.length > 0) {
    lines.push("", "## Known engine gaps (rationed, documented)", "");
    for (const result of knownGaps) lines.push(`- **${result.entry.id}** (${result.pointer}): ${result.detail}`);
  }
  if (collisions.length > 0) {
    lines.push("", "## Name collisions with Windows programs", "");
    for (const result of collisions) lines.push(`- ${result.entry.id}: ${result.reason}`);
  }
  if (skips.length > 0) {
    lines.push("", "## Skipped (toolchain does not provide the command yet)", "");
    for (const result of skips) lines.push(`- ${result.entry.id}: ${result.reason}`);
  }
  lines.push("", "## Recorded platform differences", "");
  for (const result of platform) {
    lines.push(`- ${result.entry.id}: status ${result.observed.status}, stdout ${JSON.stringify(result.observed.stdout.trim())}`);
  }
  writeFileSync(REPORT_PATH, lines.join("\n") + "\n");
}

console.log(`engine: ${engine}${current.engine.length > 0 ? ` (${current.engine})` : ""}`);
console.log(`toolchain: ${current.toolchain}`);
for (const result of failures) console.log(`FAIL  ${result.silentWrong === true ? "[silent-wrong] " : ""}${result.entry.id}: ${result.detail}`);
for (const result of knownGaps) console.log(`GAP   ${result.entry.id} (${result.pointer})`);
for (const result of collisions) console.log(`COLLIDE  ${result.entry.id}: ${result.reason}`);
console.log(
  `---- pass ${counts.pass}/${counts.total}, fail ${counts.fail}, known-gap ${counts.knownGap}, collision ${counts.collision}, skip ${counts.skip}, silent-wrong ${counts.silentWrong}`,
);

// A baseline may only contain gaps the corpus declares and documents; an undeclared silent wrong
// answer must never be recorded as acceptable.
if (UPDATE_BASELINE) {
  assert.equal(
    counts.silentWrong,
    0,
    `refusing to record a baseline with ${counts.silentWrong} undeclared silent-wrong case(s); fix them or declare a knownGap with a documentation pointer`,
  );
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + "\n");
  writeReport([`Baseline rewritten by \`--update-baseline\` at ${current.generated}.`]);
  console.log(`baseline written: ${withTools ? "corpus/baseline-tools.json" : "corpus/baseline.json"}`);
  rmSync(FIXTURE, { recursive: true, force: true });
  process.exit(0);
}

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  baseline = null;
}

const notes = [];
if (baseline !== null) {
  const regressed = (list, recorded) => list.map((result) => result.entry.id).filter((id) => recorded?.[id] === undefined);
  const newFailures = regressed(failures, baseline.failures);
  const newGaps = regressed(knownGaps, baseline.knownGaps);
  const newCollisions = regressed(collisions, baseline.collisions);
  const resolved = Object.keys(baseline.failures ?? {}).filter((id) => !results.some((result) => result.entry.id === id && result.outcome === "fail"));
  // Raw platform text is informational: it contains timestamps, so a change is reported, not gated.
  const driftText = platform.filter((result) => {
    const recorded = baseline.platform?.[result.entry.id];
    return recorded !== undefined && (recorded.status !== result.observed.status || recorded.stdout !== result.observed.stdout);
  });
  const incomplete = skips.filter((result) => result.host !== true);

  if (resolved.length > 0) notes.push(`Resolved since the baseline: ${resolved.join(", ")}. Refresh with \`--update-baseline\`.`);
  if (driftText.length > 0) notes.push(`Platform recordings differ from the baseline (informational): ${driftText.map((result) => result.entry.id).join(", ")}.`);
  writeReport(notes);

  for (const id of newFailures) console.log(`REGRESSION  ${id}`);
  for (const id of newGaps) console.log(`NEW GAP  ${id}`);
  for (const id of newCollisions) console.log(`NEW COLLISION  ${id}`);

  assert.equal(counts.silentWrong, 0, "an undeclared silent wrong answer is never acceptable");
  assert.deepEqual(newFailures, [], "no must-match case may fail that the baseline did not record");
  assert.deepEqual(newGaps, [], "a documented engine gap may only shrink, never appear");
  assert.deepEqual(newCollisions, [], "a name must not start resolving to an unrelated Windows program");
  if (FULL) {
    // A diagnostic, not a gate. Three cases in this corpus cannot pass without a fork — a builtin
    // background job has no child to report a PID for, a bundled pipeline stage runs to completion
    // before its reader starts, and `echo hi > >(cat)` can lose its output — so demanding zero would
    // leave the mode permanently red and therefore ignored. What it does instead is print the distance
    // to all-green, which is what a reader actually wants from it.
    const distance = [
      `${counts.fail} failing cases`,
      `${counts.knownGap} declared engine gaps`,
      `${counts.collision} Windows impostors not shadowed`,
      `${incomplete.length} cases skipped for a missing need`,
      `${counts.platform} platform recordings`,
    ];
    console.log(`\nFULL (diagnostic): distance to all-green: ${distance.join(", ")}`);
    for (const result of failures) console.log(`  failing: ${result.entry.id}`);
    for (const result of knownGaps) console.log(`  gap: ${result.entry.id}`);
    for (const result of collisions) console.log(`  unshadowed: ${result.entry.id}`);
    for (const result of incomplete) console.log(`  skipped: ${result.entry.id} (${result.reason})`);
    notes.push(`FULL diagnostic: ${distance.join(", ")}.`);
  }
} else {
  notes.push("No baseline recorded yet; review the failures, then run with `--update-baseline`.");
  writeReport(notes);
  console.log("note: no corpus/baseline.json yet, so this run only reports");
}

rmSync(FIXTURE, { recursive: true, force: true });
console.log(`\n报告已写入 corpus/report.md`);
