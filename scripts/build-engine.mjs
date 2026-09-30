// Builds the bash engine this plugin runs, from source, so its behaviour can be measured and patched.
//
// Why build rather than `cargo install`: the published engine cannot be patched, and several
// behaviours that matter here (the PID behind `$!`, how `/tmp` resolves, whether descriptor paths
// work) live in the engine rather than in a separate tool. A source build with a pinned commit and a
// patch directory is the only way to change them deliberately.
//
// Usage:
//   node scripts/build-engine.mjs                 build the pinned ref and install the shipped artifact
//   node scripts/build-engine.mjs --refresh       re-fetch the pinned ref first
//   node scripts/build-engine.mjs --cache=DIR     use another build cache
//   node scripts/build-engine.mjs --keep          build but do not replace the shipped artifact
//
// A checkout that already carries this exact patch set is reused as it is (the script records which set
// it applied); one that matches the pin but has never been patched is patched from scratch; anything else
// fails and names the `--refresh` command that replays from the pin, because a half-applied tree cannot
// be completed and guessing is how a build ends up with an artifact nobody can reproduce.
//
// One dependency is patched as well: the engine compiles about ninety uutils crates into itself for its
// bundled tools, and every one of them words a refused file effect through `uucore`, which strips the OS
// error code. `scripts/uucore-override.mjs` vendors the resolved version, applies
// `patches/uucore/0001-keep-the-os-error-code.patch` to that copy and points `[patch.crates-io]` at it,
// so the refusal keeps the one part of its message that does not depend on the host's language. The
// check runs before the build and names the file it verified, because a silently unpatched engine is
// exactly the failure this exists to prevent.
//
// The artifact inside this package is the product: this script installs there and rewrites the artifact
// record in `engine.lock.json` (path, sha256, bytes). The executor refuses any artifact that does not
// hash to what the lock says, and copies it to a per-user cache outside the DSH workspace before running
// it. The previous artifact is backed up to the per-user directory before it is replaced.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyUucoreOverride, assertUucoreGuard } from "./uucore-override.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(REPO_ROOT, "engine.lock.json"), "utf8"));

const cacheArg = process.argv.find((arg) => arg.startsWith("--cache="));
const refresh = process.argv.includes("--refresh");
const keep = process.argv.includes("--keep");

const localAppData = process.env.LOCALAPPDATA ?? "";
if (localAppData.length === 0) {
  console.error("LOCALAPPDATA must name the per-user directory the engine lives in");
  process.exit(2);
}
const engineDir = join(localAppData, "dsh-bash-native");
const enginePath = join(engineDir, `${lock.bin}.exe`);
const cacheRoot = cacheArg !== undefined ? cacheArg.slice("--cache=".length) : join(engineDir, "build");
const checkout = join(cacheRoot, "brush");
const patchDir = join(REPO_ROOT, "patches", "brush");

/** Run a command with inherited stdio. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

/** Capture a command's stdout through a file.
 *
 * A confined DSH session cannot open named pipes, so the obvious shape — `execFileSync(..., { encoding:
 * "utf8" })`, which is a pipe — fails with EPERM before the command runs, and this build would only work
 * in an unconfined shell. Redirecting stdout to a file is the shape `src/verify.ts` and the test harness
 * already use for the same reason, so the build runs wherever the plugin does.
 */
function capture(command, args, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dsh-bash-native-build-"));
  const stdoutPath = join(directory, "stdout.txt");
  const descriptor = openSync(stdoutPath, "w");
  try {
    const result = spawnSync(command, args, { ...options, stdio: ["ignore", descriptor, "ignore"], windowsHide: true });
    if (result.error !== undefined) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
    return readFileSync(stdoutPath, "utf8");
  } finally {
    closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** {@link capture}, treating a command that cannot run or exits non-zero as "no output". */
function captureOrNull(command, args, options = {}) {
  try {
    return capture(command, args, options);
  } catch {
    // A toolchain this probe cannot run is exactly what the caller is asking about, so "no output" is
    // the answer here rather than a failure this script should stop for.
    return null;
  }
}

/** Whether the command accepted its arguments; the answer is the status, so nothing is captured. */
function succeeds(command, args, options = {}) {
  return spawnSync(command, args, { ...options, stdio: "ignore", windowsHide: true }).status === 0;
}

/** Block for a moment; Node allows `Atomics.wait` on the main thread. */
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

/** Run a network command, retrying a refused connection. */
function runNetwork(command, args, options = {}, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(command, args, options);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`retry  ${command} ${args.join(" ")} (attempt ${attempt + 1} of ${attempts})`);
      sleepSync(5000 * attempt);
    }
  }
}

/** Whether this checkout already holds a git object, which is what makes an offline rebuild possible. */
function hasGitObject(ref) {
  return succeeds("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: checkout });
}

/** The installed toolchain that satisfies the workspace pin, resolved once per run. */
let resolvedToolchain;
function toolchain() {
  resolvedToolchain ??= installedPinnedToolchain();
  return resolvedToolchain;
}

/**
 * The environment a `cargo` call needs.
 *
 * The checkout pins a channel in `rust-toolchain.toml`, and a plain `cargo` invocation makes rustup try
 * to install that channel from `static.rust-lang.org` — which this machine cannot reach, so the call
 * fails before cargo runs. Naming an installed toolchain is what the build already does; the dependency
 * override has to do the same, or vendoring succeeds and the lock update that makes it count does not.
 * @param extra - additional environment entries for this call.
 * @returns the environment to run with.
 */
function rustEnv(extra = {}) {
  const name = toolchain();
  return { ...process.env, ...(name.length === 0 ? {} : { RUSTUP_TOOLCHAIN: name }), ...extra };
}

/** The seam `scripts/uucore-override.mjs` runs its own commands and logging through. */
const io = {
  run: (command, args, options = {}) => run(command, args, { ...options, env: options.env ?? rustEnv() }),
  log: (message) => console.log(message),
};

/** Check out the pinned ref, fetching it only when this checkout does not already have it. */
function syncSource() {
  const looksLikeCommit = /^[0-9a-f]{40}$/.test(lock.ref);
  if (!existsSync(join(checkout, ".git"))) {
    if (existsSync(checkout)) rmSync(checkout, { recursive: true, force: true });
    mkdirSync(checkout, { recursive: true });
    console.log(`clone  ${lock.repo} @ ${lock.ref}`);
    runNetwork("git", ["-c", "core.longpaths=true", "init", "--quiet"], { cwd: checkout });
    runNetwork("git", ["remote", "add", "origin", lock.repo], { cwd: checkout });
  } else if (!refresh) {
    console.log(`reuse  brush @ ${capture("git", ["rev-parse", "HEAD"], { cwd: checkout }).trim()}`);
    return;
  }
  if (looksLikeCommit && hasGitObject(lock.ref)) {
    // The pin is a commit id and this checkout already holds it, so a rebuild needs no network: the id
    // is the verification, and a machine that cannot reach GitHub must still be able to apply a patch
    // and build. The forced checkout below is what keeps the tree clean either way.
    console.log(`local  ${lock.repo} @ ${lock.ref} (already present; not fetching)`);
    run("git", ["checkout", "--force", lock.ref], { cwd: checkout });
  } else if (looksLikeCommit) {
    // GitHub serves a fetch of a reachable commit; a full clone is the fallback when it does not.
    try {
      runNetwork("git", ["fetch", "--depth", "1", "origin", lock.ref], { cwd: checkout });
    } catch {
      console.log("note: fetching the pinned commit directly failed, cloning the full history instead");
      runNetwork("git", ["fetch", "--tags", "origin"], { cwd: checkout });
    }
    runNetwork("git", ["checkout", "--force", lock.ref], { cwd: checkout });
  } else {
    runNetwork("git", ["fetch", "--depth", "1", "origin", lock.ref], { cwd: checkout });
    runNetwork("git", ["checkout", "--force", "FETCH_HEAD"], { cwd: checkout });
  }
  console.log(`at     ${capture("git", ["rev-parse", "HEAD"], { cwd: checkout }).trim()}`);
  // A forced checkout restores tracked files but leaves untracked ones behind, and a patch that adds a
  // file (0010's `disown.rs`) would then refuse to apply on the second run. Ignored paths such as
  // `target/` are kept, which is what makes the rebuild incremental.
  const cleaned = capture("git", ["clean", "-fd"], { cwd: checkout }).trim();
  if (cleaned.length > 0) console.log(`clean  ${cleaned.split("\n").length} untracked path(s) removed`);
}

/**
 * The record saying which patch set this checkout already carries.
 *
 * The reverse check on its own cannot answer "is this tree fully patched": a later patch moves the
 * context an earlier one matches (`0002` and `0009` both edit `patterns.rs` and `sys/fs.rs`), so on a
 * fully patched tree only some of the patches reverse-check — measured here, 8 of 11. Inferring from
 * that number is wrong in both directions: it reports a complete checkout as incomplete, and after a
 * failed half-apply it can report the opposite. This file is written only once every patch has been
 * applied, and names the pin and each patch's digest, so the next run can reuse the checkout without
 * touching it.
 */
const stateFile = join(checkout, ".dsh-bash-native-patches.json");

/** The patch names this build would apply, in the order it applies them. */
function patchNames() {
  return existsSync(patchDir) ? readdirSync(patchDir).filter((name) => name.endsWith(".patch")).sort() : [];
}

/** The record a fully patched checkout would carry for the current patch set and pin. */
function patchState(names) {
  return {
    ref: lock.ref,
    patches: names.map((name) => ({ name, sha256: createHash("sha256").update(readFileSync(join(patchDir, name))).digest("hex") })),
  };
}

/** The record this checkout carries, or null when it has none (a fresh clone, or a checkout never built). */
function recordedState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    // A missing or unreadable record means "not built here yet", which the caller handles by looking at
    // the working tree instead of failing.
    return null;
  }
}

/**
 * Apply every patch in `patches/brush` in name order, or reuse a checkout that already carries them.
 *
 * Three states are distinguishable, and the script only ever acts on the third: a checkout that carries
 * this exact patch set for this pin is reused as it is; a checkout with no record whose working tree
 * matches the pin is patched from scratch (a fresh clone, or the state right after `--refresh`); anything
 * else is reported, because a half-applied tree cannot be completed by applying what is left — the
 * earlier patch no longer matches the context the later one replaced — and finishing it by guesswork is
 * how a build ends up with an artifact nobody can reproduce. `--refresh` is the caller's decision, since
 * it discards uncommitted edits in the checkout.
 */
function applyPatches() {
  const names = patchNames();
  if (names.length === 0) return;
  const expected = patchState(names);
  const recorded = recordedState();
  if (recorded !== null && JSON.stringify(recorded) === JSON.stringify(expected)) {
    for (const name of names) console.log(`patch  ${name} already applied`);
    return;
  }
  if (recorded !== null) {
    throw new Error(
      `the checkout records a different patch set than ${patchDir} carries (recorded ${recorded.patches?.length ?? 0} patch(es) for ${recorded.ref}, expected ${names.length} for ${lock.ref}); ` +
        `run \`node scripts/build-engine.mjs --refresh\` to check out the pinned commit and replay all ${names.length} patches, which discards uncommitted edits in ${checkout}`,
    );
  }
  const dirty = capture("git", ["status", "--porcelain"], { cwd: checkout }).trim();
  if (dirty.length > 0) {
    const count = dirty.split("\n").length;
    throw new Error(
      `the checkout carries no record of applied patches and has ${count} modified path(s), so its state cannot be trusted; ` +
        `run \`node scripts/build-engine.mjs --refresh\` to check out the pinned commit and replay all ${names.length} patches, which discards uncommitted edits in ${checkout}`,
    );
  }
  for (const name of names) {
    console.log(`patch  ${name}`);
    // The checkout has to be `git`'s working directory: without one the patch is applied to whichever
    // repository the script was invoked from, which fails on the first file only the checkout has
    // (`brush-core/src/interp.rs`) instead of replaying anything.
    run("git", ["apply", join(patchDir, name)], { cwd: checkout });
  }
  writeFileSync(stateFile, `${JSON.stringify(expected, null, 2)}\n`);
  console.log(`record ${stateFile}`);
}

/**
 * The toolchain to build with: an installed one whose version satisfies the workspace pin.
 *
 * A `rust-toolchain.toml` makes rustup install the pinned channel *and its components* on first use.
 * That install is both large (the default profile pulls ~900 MB of `rust-docs`) and, on this machine,
 * fails with `detected conflict: 'share\doc\rust\html'` while leaving the named toolchain without a
 * manifest — so the pin is resolved to whatever installed toolchain actually satisfies it, which on
 * this machine is `stable` at the same version. Each candidate is probed rather than trusted, because
 * an interrupted installation is indistinguishable from a healthy one by name alone.
 * @returns the toolchain name, or an empty string to let rustup decide.
 */
function installedPinnedToolchain() {
  const file = join(checkout, "rust-toolchain.toml")
  const channel = existsSync(file) ? (/^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(file, "utf8"))?.[1] ?? "") : "";
  const installed = capture("rustup", ["toolchain", "list"])
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name !== undefined && name.length > 0);
  const preferred = installed.filter((name) => channel.length > 0 && (name === channel || name.startsWith(`${channel}-`)));
  const candidates = [...preferred, ...installed.filter((name) => !preferred.includes(name))];
  const needsVersion = /^\d/.test(channel);

  for (const name of candidates) {
    const probe = captureOrNull("rustup", ["run", name, "rustc", "--version"]);
    if (probe === null) {
      console.log(`skip   ${name}: not usable (the version probe did not run)`);
      continue;
    }
    const version = probe.trim();
    if (needsVersion && !version.includes(channel)) {
      console.log(`skip   ${name}: ${version} does not satisfy the pin ${channel}`);
      continue;
    }
    console.log(`toolchain ${name} (${version}${needsVersion ? `, satisfies the pin ${channel}` : ""})`);
    return name;
  }
  console.log(`note: no installed toolchain satisfies ${channel || "the workspace"}; rustup will fetch one`);
  return "";
}

/**
 * Rewrites the build directory out of the artifact this script installs.
 *
 * rustc records the file a panic came from, so without this the shipped engine carries
 * `C:\Users\<name>\AppData\Local\…` and publishes whoever built it. It has to happen at compile time:
 * those strings come from `file!()`, not from debug info, so stripping would not have removed them.
 */
const REMAP_BUILD_PATHS = `--remap-path-prefix=${homedir()}=/build`;

function build() {
  console.log(`build  ${lock.package} (release)`);
  const features = lock.features ?? [];
  const args = ["build", "--release", "--package", lock.package];
  if (features.length > 0) {
    args.push("--features", features.join(","));
    console.log(`features ${features.join(",")}`);
  }
  run("cargo", args, {
    cwd: checkout,
    env: rustEnv({
      // The workspace ships `lto = "fat"` and a single codegen unit; that is worth many minutes and
      // buys nothing for an engine we exercise through tests rather than benchmarks.
      CARGO_PROFILE_RELEASE_LTO: "off",
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16",
      RUSTFLAGS: REMAP_BUILD_PATHS,
    }),
  });
}

syncSource();
applyPatches();

// The vendored `uucore` has to be in place before cargo resolves, and the guard is verified against the
// copy the build compiles, so an unpatched engine fails here rather than shipping a quietly wrong message.
const uucore = applyUucoreOverride({ checkout, repoRoot: REPO_ROOT, cacheRoot, io });
assertUucoreGuard({ checkout, vendorDir: uucore.vendorDir, io });

build();

const built = join(checkout, "target", "release", `${lock.bin}.exe`);
if (!existsSync(built)) throw new Error(`${built} was not produced; check the package's [[bin]] name`);

const version = capture(built, ["--version"]).trim();
console.log(`built  ${built}`);
console.log(`version ${version}`);

if (keep) {
  console.log("--keep: the shipped artifact was left untouched");
  process.exit(0);
}

// The artifact inside the package is what ships, so this script installs there and records its hash in
// the lock: the executor refuses any artifact that does not hash to what the lock says, and it copies
// the artifact to a per-user cache outside the DSH workspace before running it.
const artifactDir = join(REPO_ROOT, "engine", "win32-x64");
const artifact = join(artifactDir, `${lock.bin}.exe`);
mkdirSync(artifactDir, { recursive: true });
if (existsSync(artifact)) {
  const backupDir = join(engineDir, "engine-backup");
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const previous = capture(artifact, ["--version"]).trim().split(/\s+/).slice(0, 2).join("-");
  copyFileSync(artifact, join(backupDir, `${lock.bin}-${previous}-${stamp}.exe`));
}
copyFileSync(built, artifact);

const installed = capture(artifact, ["--version"]).trim();
if (!/^brush\b/i.test(installed)) throw new Error(`${artifact} does not report brush: "${installed}"`);
const digest = createHash("sha256").update(readFileSync(artifact)).digest("hex");
lock.artifact = { path: "engine/win32-x64/brush.exe", sha256: digest, bytes: statSync(artifact).size };
writeFileSync(join(REPO_ROOT, "engine.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
console.log(`artifact ${artifact}`);
console.log(`sha256   ${digest}`);
console.log(`verify   ${installed}`);

// The old per-user copy is no longer a probe; say so rather than leaving a stale engine to be mistaken
// for the one in use.
console.log(`note     the per-user copy at ${enginePath} is no longer probed; the executor caches the artifact instead`);
