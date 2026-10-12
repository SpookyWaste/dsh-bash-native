// The vendored-crate table: which registry crates the engine build replaces, and what makes that a fact.
//
// `scripts/vendored-crates.mjs` names every crate whose source has to differ from crates.io for the engine
// to behave correctly here. What these cases pin is that the mechanism carries a crate that is *not*
// `uucore`: a crate with `build = false` is copied as the crate itself (no monorepo layout, no locale
// bundles), its tracked patch is applied to that copy, its lock entry is adopted, and its guard is checked
// against the file the build will compile. Two things the table cannot get away with are checked here as
// well: an entry whose guard is not in its own patch would verify nothing, and a second
// `[patch.crates-io]` section would make the manifest unreadable by cargo.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VENDORED_CRATES, applyVendorOverrides, assertVendorGuards } from "../scripts/vendored-crates.mjs";
import { UU_TAIL_CRATE } from "../scripts/vendored-crates.mjs";
import { UUCORE_CRATE, applyCrateOverride, assertCrateGuard, resolvedCrate } from "../scripts/uucore-override.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The machinery shells out to `git apply`, so a machine without git on PATH cannot exercise it: report that
// instead of crashing with ENOENT.
if (spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }).error !== undefined) {
  console.log("SKIP  test-vendored-crates.mjs: git is not on PATH, and the patch machinery needs it");
  process.exit(0);
}

const SCRATCH = mkdtempSync(join(tmpdir(), "dsh-vendored-test-"));
const realCargoHome = process.env.CARGO_HOME;

/** The unpatched `ReverseChunks::next` body the tracked `uu_tail` patch was generated against. */
const CHUNKS_BODY = `        // The chunk size is \`BLOCK_SIZE\` for all but the last chunk
        // (that is, the chunk closest to the beginning of the file),
        // which contains the remainder of the bytes.
        let block_size = if self.block_idx == self.max_blocks_to_read - 1 {
            self.size % BLOCK_SIZE
        } else {
            BLOCK_SIZE
        };
`;

/** The unpatched `strip_errno` body the tracked `uucore` patch was generated against. */
const ERROR_MODULE = `/// Strip the trailing " (os error XX)" from io error strings.
pub fn strip_errno(err: &std::io::Error) -> String {
    let mut msg = err.to_string();
    if let Some(pos) = msg.find(" (os error ") {
        msg.truncate(pos);
    }
    msg
}
`;

/** A `Cargo.lock` whose `uu_tail` entry is a registry copy, the shape a fresh engine build resolves. */
function registryLock(name, version) {
  return `version = 3

[[package]]
name = "${name}"
version = "${version}"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"0".repeat(64)}"
`;
}

/**
 * A scenario: a fake checkout, a fake cargo source cache, and an `io` seam that answers for cargo.
 *
 * `git` is forwarded to the real binary, so "the patch applies to this copy" is a measurement rather than
 * a claim; `cargo` is simulated because the cases are about the helper's decisions, and the two calls it
 * makes (`fetch`, `update -p <name>`) are exactly the ones a test should not need a toolchain for.
 * @param options - the manifest, whether the source cache holds the crates, whether cargo adopts the patch,
 * and whether the lock also resolves `uucore` (the table's other entry).
 */
function scenario({ manifest = '[package]\nname = "victim"\nversion = "0.0.0"\n', cache = true, adopt = true, uucore = false } = {}) {
  const root = mkdtempSync(join(SCRATCH, "case-"));
  const checkout = join(root, "checkout");
  const cargoHome = join(root, "cargo-home");
  const cacheRoot = join(root, "build");
  mkdirSync(checkout, { recursive: true });
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(join(checkout, "Cargo.toml"), manifest);
  writeFileSync(join(checkout, "Cargo.lock"), registryLock("uu_tail", "0.12.0") + (uucore ? `\n${registryLock("uucore", "0.12.0")}` : ""));
  // The registry layout of a crate that carries a build script: `src/chunks.rs` sits beside `locales`, and
  // there is no `src/uu` above it, so nothing about the copy may depend on one existing.
  const source = join(cargoHome, "registry", "src", "fake-index", "uu_tail-0.12.0");
  if (cache) {
    mkdirSync(join(source, "src"), { recursive: true });
    mkdirSync(join(source, "locales"), { recursive: true });
    writeFileSync(join(source, "Cargo.toml"), '[package]\nname = "uu_tail"\nversion = "0.12.0"\nbuild = false\n');
    writeFileSync(join(source, "src", "chunks.rs"), `${"// padding\n".repeat(74)}${CHUNKS_BODY}`);
    writeFileSync(join(source, "locales", "en-US.ftl"), "unused = no build script reads this\n");
    if (uucore) {
      const uucoreSource = join(cargoHome, "registry", "src", "fake-index", "uucore-0.12.0");
      mkdirSync(join(uucoreSource, "src", "lib", "mods"), { recursive: true });
      writeFileSync(join(uucoreSource, "Cargo.toml"), '[package]\nname = "uucore"\nversion = "0.12.0"\n');
      writeFileSync(join(uucoreSource, "src", "lib", "mods", "error.rs"), ERROR_MODULE);
      mkdirSync(join(cargoHome, "registry", "src", "fake-index", "uu_mkdir-0.12.0", "locales"), { recursive: true });
      writeFileSync(join(cargoHome, "registry", "src", "fake-index", "uu_mkdir-0.12.0", "locales", "en-US.ftl"), "mkdir-error-cannot-create-directory = cannot create directory '{ $path }': { $error }\n");
    }
  }
  process.env.CARGO_HOME = cargoHome;
  const calls = [];
  const logs = [];
  const lockPath = join(checkout, "Cargo.lock");
  const run = (command, args, options = {}) => {
    calls.push(`${command} ${args.join(" ")}`);
    if (command === "cargo") {
      if (args[0] === "fetch") return;
      if (!adopt) return;
      const name = args[2];
      // What `cargo update -p <name>` does to the lock: the patched package resolves from a path, so its
      // registry source and checksum go away.
      const text = readFileSync(lockPath, "utf8");
      writeFileSync(
        lockPath,
        text
          .split("[[package]]")
          .map((block) =>
            new RegExp(`^\\s*name = "${name}"\\s*$`, "m").test(block)
              ? block
                  .split("\n")
                  .filter((line) => !/^\s*(source|checksum) = /.test(line))
                  .join("\n")
              : block,
          )
          .join("[[package]]"),
      );
      return;
    }
    const result = spawnSync(command, args, { ...options, stdio: "ignore", windowsHide: true });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  };
  return {
    checkout,
    cacheRoot,
    cargoHome,
    source,
    calls,
    logs,
    io: { run, log: (message) => logs.push(message) },
    manifest: () => readFileSync(join(checkout, "Cargo.toml"), "utf8"),
    lock: () => readFileSync(lockPath, "utf8"),
  };
}

// 1. A crate without a build script is vendored as itself, patched, pointed at, and verified.
{
  const test = scenario();
  const vendored = applyCrateOverride({ crate: UU_TAIL_CRATE, checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  assert.equal(vendored.version, "0.12.0");
  assert.equal(vendored.vendorDir, join(test.cacheRoot, "vendor", "uu_tail-0.12.0"), "a crate with no build script is its own root");
  const patched = readFileSync(join(vendored.vendorDir, "src", "chunks.rs"), "utf8");
  assert.match(patched, /self\.size - \(self\.max_blocks_to_read as u64 - 1\) \* BLOCK_SIZE/, "the vendored copy carries the fix");
  assert.doesNotMatch(patched, /self\.size % BLOCK_SIZE/, "the remainder the bug came from is gone");
  assert.match(test.manifest(), /^\[patch\.crates-io\]\nuu_tail = \{ path = "[^"]+\/vendor\/uu_tail-0\.12\.0" \}$/m, "the manifest points at the vendored copy");
  assert.equal(test.calls.filter((call) => call.startsWith("cargo")).join(" | "), "cargo update -p uu_tail", "the lock is updated once, for this crate");
  assert.equal(resolvedCrate(test.checkout, "uu_tail")[0].fromPath, true, "the lock now resolves uu_tail from a path");
  const file = assertCrateGuard({ crate: UU_TAIL_CRATE, checkout: test.checkout, vendorDir: vendored.vendorDir, io: test.io });
  assert.equal(file, join(vendored.vendorDir, "src", "chunks.rs"), "the guard is read from the vendored copy");
  assert.equal(test.logs.some((line) => line.startsWith("guard  ")), true, "the guard is logged with the file it verified");
  pass("a registry crate without a build script is vendored, patched, pointed at, and verified");
}

// 2. The copy is the crate, not a monorepo layout: nothing walks a tree that does not exist here.
{
  const test = scenario();
  applyCrateOverride({ crate: UU_TAIL_CRATE, checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  const root = join(test.cacheRoot, "vendor", "uu_tail-0.12.0");
  assert.equal(existsSync(join(root, "Cargo.toml")), true, "the crate sits at the root of its vendored directory");
  assert.equal(existsSync(join(root, "src", "uu")), false, "no locale layout is invented for a crate that has no build script");
  assert.equal(readFileSync(join(root, ".dsh-uu_tail-patch.json"), "utf8").includes('"utilities": 0'), true, "the record says no locale set was carried");
  pass("a crate with no build script is copied as the crate itself");
}

// 3. A second run is a no-op: the recorded copy and the adopted lock are enough.
{
  const test = scenario();
  const args = { crate: UU_TAIL_CRATE, checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io };
  const first = applyCrateOverride(args);
  const manifest = test.manifest();
  const before = test.calls.length;
  const second = applyCrateOverride(args);
  assert.equal(second.vendorDir, first.vendorDir);
  assert.equal(test.manifest(), manifest, "the manifest is not rewritten");
  assert.deepEqual(test.calls.slice(before), [], "nothing is run again");
  assert.equal(test.logs.at(-1).includes("verify"), true, "the second run re-verifies instead of rebuilding");
  pass("a second run reuses the vendored copy and runs nothing");
}

// 4. A vendored copy whose record does not match the patch is rebuilt rather than trusted.
{
  const test = scenario();
  const args = { crate: UU_TAIL_CRATE, checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io };
  const vendored = applyCrateOverride(args);
  writeFileSync(join(test.checkout, "Cargo.lock"), registryLock("uu_tail", "0.12.0"));
  writeFileSync(join(vendored.vendorDir, "src", "chunks.rs"), CHUNKS_BODY);
  writeFileSync(join(test.cacheRoot, "vendor", "uu_tail-0.12.0", ".dsh-uu_tail-patch.json"), '{"version":"0.12.0","patch":"stale","source":""}\n');
  applyCrateOverride(args);
  const patched = readFileSync(join(test.cacheRoot, "vendor", "uu_tail-0.12.0", "src", "chunks.rs"), "utf8");
  assert.match(patched, /self\.size - \(self\.max_blocks_to_read as u64 - 1\)/, "the fix is back");
  assert.equal(test.logs.some((line) => line.includes("rebuild uu_tail 0.12.0")), true, "the stale copy is named as the reason");
  pass("a vendored copy whose record does not match the patch is rebuilt");
}

// 5. The whole table runs against one checkout — the shape the engine build uses — and every entry is
//    verified: `uucore` keeps the monorepo layout it needs, `uu_tail` does not get one, and the two
//    overrides share the single `[patch.crates-io]` section cargo allows.
{
  const test = scenario({ uucore: true });
  const applied = applyVendorOverrides({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  assert.deepEqual([...applied.keys()], VENDORED_CRATES.map((crate) => crate.name), "every entry in the table was applied");
  assert.equal(applied.get("uucore").vendorDir, join(test.cacheRoot, "vendor", "uucore-0.12.0", "src", "uucore"), "uucore keeps the layout its build script walks");
  assert.equal(applied.get("uu_tail").vendorDir, join(test.cacheRoot, "vendor", "uu_tail-0.12.0"), "the crate without a build script is its own root");
  const manifest = test.manifest();
  assert.equal(manifest.match(/^\[patch\.crates-io\]$/gm).length, 1, "the section is not duplicated");
  assert.match(manifest, /^uucore = \{ path = "[^"]+" \}$/m, "uucore is pointed at its copy");
  assert.match(manifest, /^uu_tail = \{ path = "[^"]+" \}$/m, "uu_tail is pointed at its copy");
  assert.deepEqual(test.calls.filter((call) => call.startsWith("cargo")), ["cargo update -p uucore", "cargo update -p uu_tail"], "each lock entry is adopted once");
  const files = assertVendorGuards({ checkout: test.checkout, applied, io: test.io });
  assert.equal(files.get("uucore"), join(applied.get("uucore").vendorDir, "src", "lib", "mods", "error.rs"), "the uucore guard is read from its vendored copy");
  assert.equal(files.get("uu_tail"), join(applied.get("uu_tail").vendorDir, "src", "chunks.rs"), "the tail guard is read from its vendored copy");
  assert.equal(resolvedCrate(test.checkout, "uucore")[0].fromPath, true, "the uucore lock entry resolves from a path");
  assert.equal(resolvedCrate(test.checkout, "uu_tail")[0].fromPath, true, "the tail lock entry resolves from a path");
  pass("the whole table runs against one checkout and every entry is verified");
}

// 6. A guarded override cannot be verified without the run's own copy: a directory this run never wrote
//    would be a statement about the wrong tree.
{
  const test = scenario();
  assert.throws(
    () => assertVendorGuards({ checkout: test.checkout, applied: new Map(), io: test.io }),
    /has no applied override/,
  );
  pass("a guard verified without this run's vendored copy is refused");
}

// 7. An override this table did not write is left alone, and the new entry joins its section rather than
//    starting a second one — which cargo would refuse to read.
{
  const test = scenario();
  writeFileSync(
    join(test.checkout, "Cargo.toml"),
    '[package]\nname = "victim"\nversion = "0.0.0"\n\n[patch.crates-io]\nuucore = { path = "C:/build/vendor/uucore-0.12.0/src/uucore" }\n',
  );
  applyCrateOverride({ crate: UU_TAIL_CRATE, checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  const manifest = test.manifest();
  assert.equal(manifest.match(/^\[patch\.crates-io\]$/gm).length, 1, "the section is not duplicated");
  assert.match(manifest, /^uucore = \{ path = "C:\/build\/vendor\/uucore-0\.12\.0\/src\/uucore" \}$/m, "the entry that was already there is left alone");
  assert.match(manifest, /^uu_tail = \{ path = "[^"]+" \}$/m, "the new entry joins the same section");
  pass("an existing override is left alone and the new entry joins its section");
}

// 8. Every entry names a patch, a module and a guard that its own patch adds — a guard the patch does not
//    add would verify the file is unchanged rather than changed.
{
  for (const crate of VENDORED_CRATES) {
    const patch = readFileSync(join(REPO_ROOT, crate.patch), "utf8");
    assert.equal(typeof crate.name, "string");
    assert.equal(crate.module.length > 0, true, `${crate.name} names the file its patch edits`);
    assert.equal(crate.guard.length > 0, true, `${crate.name} names a guard line`);
    assert.equal(crate.guardFailure.length > 0, true, `${crate.name} says what a missing guard means`);
    assert.equal(
      patch.split("\n").some((line) => line.startsWith("+") && line.includes(crate.guard)),
      true,
      `${crate.name}: the guard is a line the patch adds`,
    );
  }
  assert.equal(VENDORED_CRATES.includes(UU_TAIL_CRATE), true, "the tail fix is one of the table's entries");
  pass("every vendored crate names a patch, a module, and a guard its own patch adds");
}

process.env.CARGO_HOME = realCargoHome;
rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);