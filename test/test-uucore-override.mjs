// The dependency patch that keeps the OS error code on a refusal: what gets vendored, what is refused.
//
// `patches/uucore/README.md` owns the rule. What these cases pin is the machinery around it, because a
// build helper that quietly does nothing is how an engine ships with the old wording: the resolved version
// decides which copy is vendored, the patch has to actually apply to that copy, an existing override
// pointing somewhere else is a decision rather than something to overwrite, a lock that still names the
// registry copy after `cargo update` is a failure rather than a warning, and an in-repo `uucore` is
// verified against the checkout itself.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { UUCORE_PATCH, applyUucoreOverride, assertUucoreGuard, resolvedUucore } from "../scripts/uucore-override.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The machinery shells out to `git apply`, so a machine without git on PATH cannot exercise it: report that
// instead of crashing with ENOENT (measured with a PATH holding only the system directories).
if (spawnSync("git", ["--version"], { stdio: "ignore", windowsHide: true }).error !== undefined) {
  console.log("SKIP  test-uucore-override.mjs: git is not on PATH, and the patch machinery needs it");
  process.exit(0);
}

const SCRATCH = mkdtempSync(join(tmpdir(), "dsh-uucore-test-"));
const realCargoHome = process.env.CARGO_HOME;
const realLog = console.log;

/** The exact `strip_errno` body the tracked patch was generated against, plus a doc line above it. */
const ERROR_MODULE = `/// Strip the trailing " (os error XX)" from io error strings.
pub fn strip_errno(err: &std::io::Error) -> String {
    let mut msg = err.to_string();
    if let Some(pos) = msg.find(" (os error ") {
        msg.truncate(pos);
    }
    msg
}
`;

/** A `Cargo.lock` whose `uucore` entry is a registry copy, the shape a fresh component resolves. */
function registryLock(version, source = true) {
  return `version = 3

[[package]]
name = "uucore"
version = "${version}"${source ? `\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${"0".repeat(64)}"` : "\n"}
`;
}

/**
 * A scenario: a fake checkout, a fake cargo source cache, and an `io` seam that answers for cargo.
 *
 * `git` is forwarded to the real binary, so "the patch applies to this copy" is a measurement rather than
 * a claim; `cargo` is simulated because these cases are about the helper's decisions, and the two calls it
 * makes (`fetch`, `update -p uucore`) are exactly the ones a test should not need a toolchain for.
 */
function scenario({ lock = registryLock("0.12.0"), manifest = '[package]\nname = "victim"\nversion = "0.0.0"\n', cache = true, adopt = true } = {}) {
  const root = mkdtempSync(join(SCRATCH, "case-"));
  const checkout = join(root, "checkout");
  const cargoHome = join(root, "cargo-home");
  const cacheRoot = join(root, "build");
  mkdirSync(checkout, { recursive: true });
  mkdirSync(cacheRoot, { recursive: true });
  writeFileSync(join(checkout, "Cargo.toml"), manifest);
  writeFileSync(join(checkout, "Cargo.lock"), lock);
  const version = resolvedUucore(checkout)[0]?.version ?? "0.12.0";
  const source = join(cargoHome, "registry", "src", "fake-index", `uucore-${version}`);
  if (cache) {
    mkdirSync(join(source, "src", "lib", "mods"), { recursive: true });
    writeFileSync(join(source, "Cargo.toml"), `[package]\nname = "uucore"\nversion = "${version}"\n`);
    writeFileSync(join(source, "src", "lib.rs"), "pub mod mods;\n");
    writeFileSync(join(source, "src", "lib", "mods", "error.rs"), ERROR_MODULE);
    // The registry also holds the `uu_*` crates, which is where `uucore`'s build script gets the utility
    // locale bundles from; the vendored tree has to carry them forward.
    mkdirSync(join(cargoHome, "registry", "src", "fake-index", `uu_mkdir-${version}`, "locales"), { recursive: true });
    writeFileSync(join(cargoHome, "registry", "src", "fake-index", `uu_mkdir-${version}`, "locales", "en-US.ftl"), "mkdir-error-cannot-create-directory = cannot create directory '{ $path }': { $error }\n");
  }
  process.env.CARGO_HOME = cargoHome;
  const calls = [];
  const logs = [];
  const run = (command, args, options = {}) => {
    calls.push(`${command} ${args.join(" ")}`);
    if (command === "cargo") {
      const isFetch = args[0] === "fetch";
      if (!isFetch && !adopt) return;
      if (isFetch) return;
      const text = readFileSync(join(checkout, "Cargo.lock"), "utf8");
      writeFileSync(join(checkout, "Cargo.lock"), text.replace(/\nsource = "[^"]+"\nchecksum = "[^"]+"/, ""));
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
    lock: () => readFileSync(join(checkout, "Cargo.lock"), "utf8"),
  };
}

// 1. A registry `uucore` is vendored, patched, pointed at, and the lock's adoption is verified.
{
  const test = scenario();
  const result = applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  assert.equal(result.version, "0.12.0");
  assert.equal(result.vendorDir, join(test.cacheRoot, "vendor", "uucore-0.12.0", "src", "uucore"));
  const patched = readFileSync(join(result.vendorDir, "src", "lib", "mods", "error.rs"), "utf8");
  assert.match(patched, /if err\.kind\(\) == std::io::ErrorKind::PermissionDenied \{/, "the vendored copy carries the guard");
  assert.match(patched, /\n    if let Some\(pos\) = msg\.find\(" \(os error "\) \{/, "the strip is still there for every other error");
  assert.match(test.manifest(), /^\[patch\.crates-io\]\nuucore = \{ path = "[^"]+\/vendor\/uucore-0\.12\.0\/src\/uucore" \}$/m, "the manifest points at the vendored copy");
  assert.deepEqual(test.calls.filter((call) => call.startsWith("cargo")), ["cargo update -p uucore"], "the lock is updated once");
  assert.equal(resolvedUucore(test.checkout)[0].fromPath, true, "the lock now resolves uucore from a path");
  assertUucoreGuard({ checkout: test.checkout, vendorDir: result.vendorDir, io: test.io });
  pass("a registry uucore is vendored, patched, pointed at, and verified against the build");
}

// 2. The vendored tree mirrors the coreutils layout `uucore`'s build script walks for locale bundles.
{
  const test = scenario();
  const result = applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  const root = join(test.cacheRoot, "vendor", "uucore-0.12.0");
  assert.equal(existsSync(join(root, "src", "uucore", "Cargo.toml")), true, "the crate sits where the monorepo keeps it");
  const bundle = readFileSync(join(root, "src", "uu", "mkdir", "locales", "en-US.ftl"), "utf8");
  assert.match(bundle, /cannot create directory/, "the utility bundle is carried into the layout the build script walks");
  assert.equal(readFileSync(join(root, ".dsh-uucore-patch.json"), "utf8").includes('"utilities": 1'), true, "the record names how many locale sets were carried");
  assertUucoreGuard({ checkout: test.checkout, vendorDir: result.vendorDir, io: test.io });
  pass("the vendored tree carries the utility locale bundles the build script walks");
}

// 3. A second run is a no-op: the recorded copy and the adopted lock are enough.
{
  const test = scenario();
  const first = applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  const manifest = test.manifest();
  const before = test.calls.length;
  const second = applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  assert.equal(second.vendorDir, first.vendorDir);
  assert.equal(test.manifest(), manifest, "the manifest is not rewritten");
  assert.deepEqual(test.calls.slice(before), [], "nothing is run again");
  assert.equal(test.logs.at(-1).includes("verify"), true, "the second run re-verifies instead of rebuilding");
  pass("a second run reuses the vendored copy and runs nothing");
}

// 4. A vendored copy whose record does not match the patch is rebuilt rather than trusted.
{
  const test = scenario();
  const result = applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  // Back to a fresh checkout that still resolves the registry copy, with the cache left behind unpatched.
  writeFileSync(join(test.checkout, "Cargo.lock"), registryLock("0.12.0"));
  writeFileSync(join(result.vendorDir, "src", "lib", "mods", "error.rs"), ERROR_MODULE);
  writeFileSync(join(test.cacheRoot, "vendor", "uucore-0.12.0", ".dsh-uucore-patch.json"), '{"version":"0.12.0","patch":"stale","source":""}\n');
  const rebuilt = applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  assert.match(readFileSync(join(rebuilt.vendorDir, "src", "lib", "mods", "error.rs"), "utf8"), /PermissionDenied \{/, "the guard is back");
  assert.equal(test.logs.some((line) => line.includes("rebuild uucore 0.12.0")), true, "the stale copy is named as the reason");
  pass("a vendored copy whose record does not match the patch is rebuilt");
}

// 4. An in-repo `uucore` needs no vendoring, and its guard is checked in the checkout itself.
{
  const test = scenario({
    lock: registryLock("0.12.0", false),
    manifest: '[package]\nname = "coreutils"\nversion = "0.12.0"\n\n[dependencies]\nuucore = { version = "0.12.0", path = "src/uucore" }\n',
  });
  mkdirSync(join(test.checkout, "src", "uucore", "src", "lib", "mods"), { recursive: true });
  writeFileSync(join(test.checkout, "src", "uucore", "src", "lib", "mods", "error.rs"), ERROR_MODULE);
  const result = applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io });
  assert.equal(result.vendorDir, "", "an in-repo uucore is not vendored");
  assert.throws(() => assertUucoreGuard({ checkout: test.checkout, vendorDir: "", io: test.io }), /does not keep the OS error code/, "an unpatched in-repo copy is refused");
  writeFileSync(
    join(test.checkout, "src", "uucore", "src", "lib", "mods", "error.rs"),
    ERROR_MODULE.replace("    if let Some(pos)", "    if err.kind() == std::io::ErrorKind::PermissionDenied {\n        return msg;\n    }\n    if let Some(pos)"),
  );
  const file = assertUucoreGuard({ checkout: test.checkout, vendorDir: "", io: test.io });
  assert.equal(file.endsWith(join("src", "uucore", "src", "lib", "mods", "error.rs")), true, "the guard is read from the path the manifest declares");
  pass("an in-repo uucore is not vendored, and its guard is verified in the checkout");
}

// 5. A lock that resolves two uucore versions is refused instead of half-patched.
{
  const test = scenario({ lock: `${registryLock("0.12.0")}\n[[package]]\nname = "uucore"\nversion = "0.9.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "${"1".repeat(64)}"\n` });
  assert.throws(
    () => applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io }),
    /resolves 2 uucore versions \(0\.12\.0, 0\.9\.0\)/,
  );
  pass("a lock with two uucore versions is refused rather than half-patched");
}

// 6. An existing override that points elsewhere is a decision, not something to overwrite.
{
  const test = scenario({ manifest: '[package]\nname = "victim"\nversion = "0.0.0"\n\n[patch.crates-io]\nuucore = { path = "C:/elsewhere/uucore" }\n' });
  assert.throws(
    () => applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io }),
    /already points uucore at/,
  );
  pass("an existing uucore override that points elsewhere is refused");
}

// 7. A lock that still names the registry copy after the update fails the build instead of warning.
{
  const test = scenario({ adopt: false });
  assert.throws(
    () => applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io }),
    /still resolves as 0\.12\.0 \(registry\)/,
  );
  pass("a lock that keeps resolving uucore from the registry fails the build");
}

// 8. A missing source cache triggers `cargo fetch`, and when that does not help the version is named.
{
  const test = scenario({ cache: false });
  assert.throws(
    () => applyUucoreOverride({ checkout: test.checkout, repoRoot: REPO_ROOT, cacheRoot: test.cacheRoot, io: test.io }),
    /uucore 0\.12\.0 is not in the cargo source cache/,
  );
  assert.equal(test.calls.includes("cargo fetch"), true, "the helper asks cargo for the source first");
  pass("a missing source cache triggers cargo fetch, and its absence is reported with the version");
}

// 9. The tracked patch is the one this suite knows about, and it is where the rule's README says.
{
  const patch = readFileSync(join(REPO_ROOT, UUCORE_PATCH), "utf8");
  assert.match(patch, /^\+\s+if err\.kind\(\) == std::io::ErrorKind::PermissionDenied \{$/m, "the patch adds the guard");
  assert.match(patch, /^--- a\/src\/lib\/mods\/error\.rs$/m, "the patch is written for a vendored uucore tree");
  pass("the tracked patch adds the guard to the vendored uucore module");
}

process.env.CARGO_HOME = realCargoHome;
rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);