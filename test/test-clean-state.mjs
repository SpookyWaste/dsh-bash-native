// Covers the cleanup utility's classification and deletion rules.
//
// The per-user directory is shared by every installed version, so the interesting question is not "does it
// delete" but "does it delete only what this package can regenerate, and does it count a hundred hard-linked
// applet names as one binary". Both are decided by pure functions over an injected filesystem, and the tree
// here is a fixture: this suite never touches the machine's real state directory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentDigests, formatBytes, inspectState, removable, removeEntries } from "../bin/clean-state.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const ROOT = mkdtempSync(join(tmpdir(), "dsh-bash-native-clean-state-"));
const CURRENT_ENGINE = "a".repeat(64);
const PREVIOUS_ENGINE = "b".repeat(64);
const CURRENT_TOOLCHAIN = "c".repeat(64);
const PREVIOUS_TOOLCHAIN = "d".repeat(64);

/** Write `bytes` bytes of filler at `path`, creating every parent directory. */
function file(path, bytes) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "x".repeat(bytes));
  return path;
}

// 1. A tree with one current and one superseded cache of each kind, plus the leftovers of the two scripts.
{
  const state = join(ROOT, "state");
  file(join(state, "shim", CURRENT_ENGINE, "bash.exe"), 100);
  file(join(state, "shim", PREVIOUS_ENGINE, "bash.exe"), 200);
  file(join(state, "toolchain", CURRENT_TOOLCHAIN, "bin", "grep.exe"), 300);
  file(join(state, "toolchain", PREVIOUS_TOOLCHAIN, "bin", "grep.exe"), 400);
  file(join(state, "tools", "bin", "grep.exe"), 500);
  file(join(state, "build", "target", "x"), 600);
  file(join(state, "engine-backup", "a.exe"), 700);
  file(join(state, "rubash.exe"), 800);
  file(join(state, "verified", "engine.json"), 10);
  file(join(state, "bash-native-rc.sh"), 20);

  const report = inspectState({ root: state, engine: CURRENT_ENGINE, toolchain: CURRENT_TOOLCHAIN });
  const byName = (kind, name) => report.entries.find((entry) => entry.kind === kind && entry.name === name);
  assert.equal(report.present, true);
  assert.equal(byName("shim", CURRENT_ENGINE).current, true, "the engine this package uses is current");
  assert.equal(byName("shim", CURRENT_ENGINE).removable, null, "a current cache is never removable");
  assert.equal(byName("shim", PREVIOUS_ENGINE).removable, "superseded");
  assert.equal(byName("toolchain", CURRENT_TOOLCHAIN).current, true);
  assert.equal(byName("toolchain", PREVIOUS_TOOLCHAIN).removable, "superseded");
  assert.equal(byName("tools", "tools").removable, "tools", "a source-built toolchain needs its own flag");
  assert.deepEqual(
    report.entries.filter((entry) => entry.kind === "dev").map((entry) => entry.name).sort(),
    ["build", "engine-backup", "rubash.exe"],
  );
  assert.equal(byName("other", "verified").removable, null, "stamps are kept: they only save hashing");
  assert.equal(byName("other", "bash-native-rc.sh").removable, null);
  assert.equal(report.bytes, 100 + 200 + 300 + 400 + 500 + 600 + 700 + 800 + 10 + 20);
  assert.equal(report.removableBytes, 200 + 400, "only the superseded caches are counted as reclaimable");
  pass("a current cache is kept, a superseded one is removable, and the totals add up");

  // The default pass takes exactly the superseded caches and nothing else.
  const doomed = removable(report.entries, { superseded: true });
  assert.deepEqual(doomed.map((entry) => entry.name).sort(), [PREVIOUS_ENGINE, PREVIOUS_TOOLCHAIN]);
  const { removed, bytes } = removeEntries(doomed);
  assert.equal(removed, 2);
  assert.equal(bytes, 600);
  assert.equal(existsSync(join(state, "shim", PREVIOUS_ENGINE)), false, "the superseded shim directory is gone");
  assert.equal(existsSync(join(state, "toolchain", PREVIOUS_TOOLCHAIN)), false, "the superseded toolchain cache is gone");
  for (const kept of [
    join(state, "shim", CURRENT_ENGINE),
    join(state, "toolchain", CURRENT_TOOLCHAIN),
    join(state, "tools"),
    join(state, "build"),
    join(state, "verified"),
    join(state, "bash-native-rc.sh"),
  ]) {
    assert.equal(existsSync(kept), true, `${kept} survives the default pass`);
  }
  pass("the default pass deletes only the superseded caches");
  rmSync(state, { recursive: true, force: true });
}

// 2. The flags that widen the pass, and the one that changes nothing by itself.
{
  const state = join(ROOT, "wide");
  file(join(state, "shim", PREVIOUS_ENGINE, "bash.exe"), 10);
  file(join(state, "tools", "bin", "grep.exe"), 20);
  file(join(state, "build", "x"), 30);
  file(join(state, "engine-backup", "y.exe"), 40);
  file(join(state, "rubash.exe"), 50);
  file(join(state, "verified", "stamp.json"), 1);

  const report = inspectState({ root: state, engine: CURRENT_ENGINE, toolchain: CURRENT_TOOLCHAIN });
  assert.deepEqual(removable(report.entries, { superseded: true }).length, 1, "the default pass leaves tools and dev behind");
  assert.deepEqual(removable(report.entries, { superseded: false }).length, 0, "no class means nothing to delete");
  assert.deepEqual(
    removable(report.entries, { superseded: true, tools: true, dev: true }).map((entry) => entry.name).sort(),
    [PREVIOUS_ENGINE, "build", "engine-backup", "rubash.exe", "tools"].sort(),
  );
  pass("--tools and --dev widen the pass, and the stamps still stay");
  rmSync(state, { recursive: true, force: true });
}

// 3. Hard-linked names are counted once, and a link outside the tree is not reclaimable.
{
  const state = join(ROOT, "links");
  const engine = file(join(state, "shim", PREVIOUS_ENGINE, "bash.exe"), 1000);
  linkSync(engine, join(state, "shim", PREVIOUS_ENGINE, "sh.exe"));
  linkSync(engine, join(state, "shim", PREVIOUS_ENGINE, "cat.exe"));
  let report = inspectState({ root: state, engine: CURRENT_ENGINE, toolchain: CURRENT_TOOLCHAIN });
  const own = report.entries.find((entry) => entry.kind === "shim");
  assert.equal(own.bytes, 1000, "three names, one file, one size");
  assert.equal(own.shared, 0, "every name of the file is in this entry, so deleting it frees the bytes");
  assert.equal(report.removableBytes, 1000);

  // One more name outside the state tree — an installed package holding the same inode — keeps the file
  // alive, so the report must stop promising those bytes.
  const outside = join(ROOT, "outside-link.exe");
  linkSync(engine, outside);
  report = inspectState({ root: state, engine: CURRENT_ENGINE, toolchain: CURRENT_TOOLCHAIN });
  const borrowed = report.entries.find((entry) => entry.kind === "shim");
  assert.equal(borrowed.bytes, 1000);
  assert.equal(borrowed.shared, 1000, "a name outside the tree keeps the file alive");
  assert.equal(report.removableBytes, 0, "so the pass frees nothing and does not claim to");
  rmSync(outside, { force: true });
  pass("hard-linked names are counted once, and links outside the tree are reported as unreclaimable");
  rmSync(state, { recursive: true, force: true });
}

// 4. An unknown digest means an unknown current cache, so nothing is called superseded.
{
  const state = join(ROOT, "unknown");
  file(join(state, "shim", PREVIOUS_ENGINE, "bash.exe"), 10);
  file(join(state, "toolchain", PREVIOUS_TOOLCHAIN, "bin", "grep.exe"), 20);
  const report = inspectState({ root: state, engine: null, toolchain: null });
  assert.equal(report.entries.every((entry) => entry.removable === null || entry.kind === "dev" || entry.kind === "tools"), true);
  assert.equal(report.removableBytes, 0, "with no known current cache, nothing is reclaimable");
  assert.equal(removable(report.entries, { superseded: true }).length, 0);
  pass("an unknown current digest marks nothing superseded");
  rmSync(state, { recursive: true, force: true });
}

// 5. The two digests come from the shipped files, and the toolchain one is the manifest's own sha256.
{
  const pkg = join(ROOT, "package");
  const manifest = '{"version":1,"target":"x","files":[]}\n';
  mkdirSync(join(pkg, "toolchain", "win32-x64"), { recursive: true });
  writeFileSync(join(pkg, "toolchain", "win32-x64", "manifest.json"), manifest);
  writeFileSync(join(pkg, "engine.lock.json"), JSON.stringify({ version: 1, artifact: { sha256: CURRENT_ENGINE } }));
  assert.deepEqual(currentDigests(pkg), {
    engine: CURRENT_ENGINE,
    toolchain: createHash("sha256").update(manifest, "utf8").digest("hex"),
  });
  rmSync(join(pkg, "engine.lock.json"), { force: true });
  assert.equal(currentDigests(pkg).engine, null, "a missing lock leaves the engine digest unknown");
  pass("the current digests are read from engine.lock.json and the shipped manifest");
  rmSync(pkg, { recursive: true, force: true });
}

// 6. The report renders the units a reader expects.
{
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(36 * 1024 ** 2), "36 MB");
  assert.equal(formatBytes(1.5 * 1024 ** 3), "1.5 GB");
  pass("sizes render in the unit a reader cares about");
}

rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);