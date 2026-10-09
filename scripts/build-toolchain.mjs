// Builds the patched POSIX toolchain this plugin puts ahead of the Windows PATH.
//
// Per source in `toolchain.lock.json`: clone the pinned tag into a build cache, inject a
// `[patch.crates-io]` entry that redirects `wild` to `patches/wild-stub`, build in release mode, and
// install the produced executables into the tools directory. A multi-call binary is installed as hard
// links named after the functions this install publishes, which costs no extra disk space and is what
// makes `grep`, `sed`, `find` and the rest resolvable by name.
//
// A source marked `uucoreErrno` is patched one step further, and its guard is checked before the build:
// `uucore` strips the OS error code out of a refused file effect, and that code is the only part of the
// message the plugin can classify a refusal by on a non-English host. `coreutils` carries `uucore`
// in-repo and is patched with the rest of its patches; the others resolve it from the registry and get a
// vendored copy from `scripts/uucore-override.mjs`. `patches/uucore/README.md` owns the rule.
//
// Every name a component provides is published *except* the two filtered sets below, because a program the
// shell can call is not the same thing as one another program can start: `find -exec`, `xargs` and `timeout`
// spawn a file, so a name has to exist somewhere on `PATH`. The engine's own bundled utilities satisfy that
// through the plugin's shim directory (patch `0016` makes the engine dispatch on its file name), so this farm
// publishes only what the engine does not carry; a withheld name cannot work in this build at all. Which
// names are *advertised* is decided in `src/toolchain.ts`, and a name no component provides is removed.
//
// Usage:
//   node scripts/build-toolchain.mjs                 build everything not already installed
//   node scripts/build-toolchain.mjs --only=grep,sed build a subset
//   node scripts/build-toolchain.mjs --refresh       re-fetch the pinned tags
//   node scripts/build-toolchain.mjs --clean         remove the build cache first
//
// The tools directory defaults to `%LOCALAPPDATA%\dsh-bash-native\tools\bin`, which is the same
// per-user location the engine resolver probes; override with `--dir=` or `DSH_BASH_NATIVE_TOOLS`.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILT_IN_UTILITIES, NOTABLE_ADDITIONS, TOOLCHAIN_COMMANDS } from "../lib/toolchain.js";
import { applyUucoreOverride, assertUucoreGuard } from "./uucore-override.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(REPO_ROOT, "toolchain.lock.json"), "utf8"));

const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const dirArg = process.argv.find((arg) => arg.startsWith("--dir="));
const cacheArg = process.argv.find((arg) => arg.startsWith("--cache="));
const refresh = process.argv.includes("--refresh");
const clean = process.argv.includes("--clean");

const localAppData = process.env.LOCALAPPDATA ?? "";
const toolsDir = dirArg !== undefined ? dirArg.slice("--dir=".length) : (process.env.DSH_BASH_NATIVE_TOOLS ?? join(localAppData, "dsh-bash-native", "tools", "bin"));
const cacheRoot = cacheArg !== undefined ? cacheArg.slice("--cache=".length) : join(localAppData, "dsh-bash-native", "build");
const only = onlyArg === undefined ? null : new Set(onlyArg.slice("--only=".length).split(","));

if (toolsDir.length === 0) {
  console.error("--dir= (or LOCALAPPDATA / DSH_BASH_NATIVE_TOOLS) must name a directory");
  process.exit(2);
}
if (clean) rmSync(cacheRoot, { recursive: true, force: true });
mkdirSync(toolsDir, { recursive: true });
mkdirSync(cacheRoot, { recursive: true });

/** The absolute path of the stub that replaces `wild`. */
const wildStub = join(REPO_ROOT, lock.wildStub).replace(/\\/g, "/");

/** Run a command, capturing its stdout through a file.
 *
 * A confined DSH session cannot open named pipes, so `execFileSync(..., { encoding: "utf8" })` — which is
 * a pipe — fails with EPERM before the command runs. `scripts/build-engine.mjs` and `src/verify.ts`
 * already capture through a file for that reason, and a build script that only works in an unconfined
 * shell is a build script that cannot be run where the plugin runs.
 */
function capture(command, args, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "dsh-bash-native-toolchain-"));
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

/** Run a command with inherited stdio so build progress reaches the terminal. */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
}

/** The seam `scripts/uucore-override.mjs` runs its own commands and logging through. */
const io = { run, log: (message) => console.log(message) };

/** Block the build for a moment; Node allows `Atomics.wait` on the main thread. */
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Run a `git` command that talks to the network, retrying a refused connection.
 *
 * A multi-minute build should not die because one `git clone` was refused, which is what happened on
 * the first run of this script.
 *
 * GitHub over HTTPS is not reachable from this network (`curl 28` on `github.com:443`), while SSH is, so
 * the `https://github.com/` prefix is rewritten to `git@github.com:` for these calls and the system's
 * native OpenSSH is named explicitly: Git for Windows' own ssh cannot start under a restricted token
 * (it fails to create a signal pipe), and naming the executable avoids that path entirely. Both are
 * per-invocation `-c` flags, so nothing global is changed. The rewrite is skipped when the system ssh is
 * absent, which leaves a machine that has HTTPS working on the URLs the lock records.
 */
function remoteArgs(args) {
  // Forward slashes: git hands the value to a shell, which eats backslashes and leaves a path that
  // cannot be found.
  const systemSsh = "C:/Windows/System32/OpenSSH/ssh.exe";
  if (!existsSync(systemSsh)) return args;
  const firstGitArg = args.indexOf("git") + 1;
  return [
    ...args.slice(0, firstGitArg),
    "-c",
    "url.git@github.com:.insteadOf=https://github.com/",
    "-c",
    `core.sshCommand=${systemSsh}`,
    ...args.slice(firstGitArg),
  ];
}

function runNetwork(command, args, options = {}, attempts = 3) {
  const invocation = command === "git" ? remoteArgs(args) : args;
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(command, invocation, options);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`retry  ${command} ${args.join(" ")} (attempt ${attempt + 1} of ${attempts})`);
      sleepSync(5000 * attempt);
    }
  }
}

/** Check out the pinned tag, refreshing it when asked.
 *
 * A checkout that already exists is reused as it is — the lock's tag is not consulted — so a lock re-pinned
 * to another version needs `--refresh`, which is also what clears the stale patch record.
 */
function syncSource(source) {
  const dir = join(cacheRoot, source.name);
  // A component with no version tags is pinned by commit instead: `uutils/awk` publishes only a rolling
  // `latest-commit` tag, which would make every build a different program.
  const pinned = /^[0-9a-f]{40}$/.test(source.tag);
  // The checkout directory is keyed by component name, so a lock entry pointed at a different repository
  // than the one already there would otherwise be built silently — which is exactly what happened when two
  // candidates shared the name `rawk`. The remote has to match, or the directory is replaced.
  if (existsSync(join(dir, ".git"))) {
    const origin = capture("git", ["remote", "get-url", "origin"], { cwd: dir }).trim();
    if (origin !== source.repo) {
      console.log(`replace ${source.name}: checkout is ${origin}, the lock names ${source.repo}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (!existsSync(join(dir, ".git"))) {
    // A checkout can fail halfway (Windows' 260-character path limit bit findutils' test data), and
    // a retry then refuses to clone into the directory it left behind.
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    console.log(`clone  ${source.name} @ ${source.tag}`);
    runNetwork("git", ["-c", "core.longpaths=true", "clone", "--depth", "1", ...(pinned ? [] : ["--branch", source.tag]), source.repo, dir]);
    if (pinned) {
      runNetwork("git", ["fetch", "--depth", "1", "origin", source.tag], { cwd: dir });
      runNetwork("git", ["checkout", "--force", source.tag], { cwd: dir });
    }
    return dir;
  }
  if (refresh) {
    console.log(`fetch  ${source.name} @ ${source.tag}`);
    if (pinned) {
      runNetwork("git", ["fetch", "--depth", "1", "origin", source.tag], { cwd: dir });
    } else {
      runNetwork("git", ["fetch", "--depth", "1", "origin", `refs/tags/${source.tag}:refs/tags/${source.tag}`, "--force"], { cwd: dir });
    }
    runNetwork("git", ["checkout", "--force", source.tag], { cwd: dir });
    // A `checkout --force` to the pin leaves the record of applied patches behind, and a record that
    // outlives the tree it describes is worse than none: the next run would skip every patch.
    rmSync(join(dir, PATCH_RECORD_FILE), { force: true });
  } else {
    console.log(`reuse  ${source.name} @ ${capture("git", ["describe", "--tags", "--always"], { cwd: dir }).trim()}`);
  }
  return dir;
}

/**
 * Copy the shared alias module into a checkout whose patch declares it.
 *
 * The rule for `/tmp` and `/<letter>` lives in the engine too (`patches/brush/0004-*.patch`,
 * `0009-*.patch`), and none of the three can share code: the engine's copy is inside `brush-core`, which
 * these binaries do not link, and the Go component cannot link the Rust module the others share. The
 * copies are tracked in `patches/toolchain/path-alias/` and the corpus pins both paths, so drift shows
 * up as a failing case rather than as a silent difference.
 */
function injectPathAlias(dir, language) {
  const files = language === "go" ? ["dsh_path_alias.go", "dsh_path_alias_test.go"] : ["dsh_path_alias.rs"];
  for (const file of files) {
    copyFileSync(join(REPO_ROOT, "patches", "toolchain", "path-alias", file), join(dir, file));
    console.log(`inject ${dir}: ${file}`);
  }
}

/** Redirect `wild` to the stub, idempotently, in a checkout's root manifest. */
function injectWildStub(dir) {
  const manifest = join(dir, "Cargo.toml");
  const text = readFileSync(manifest, "utf8");
  if (!text.includes("[patch.crates-io]")) {
    writeFileSync(manifest, `${text.trimEnd()}\n\n[patch.crates-io]\nwild = { path = "${wildStub}" }\n`);
    console.log(`patch  ${dir}: wild -> ${lock.wildStub}`);
  }
  // A checkout that ships a Cargo.lock has already resolved the real `wild`; a patch is only
  // adopted once the lock is updated, and cargo merely warns when it is ignored.
  run("cargo", ["update", "-p", "wild"], { cwd: dir });
}

/**
 * Apply the patches this project carries for one component, in name order and idempotently.
 *
 * "Already applied" cannot be answered by `git apply --reverse --check` alone, and that is measured rather
 * than assumed: `sed`'s `0002` rewrites the very call `0001` introduces, so once both are applied neither
 * the forward nor the reverse form of `0001` applies any more. Two mechanisms answer it instead. A record
 * of the applied patch set (the component, and each patch's name and digest) is written into the checkout, so
 * the normal re-run skips everything without touching git. Without a record — a checkout from before the record
 * existed, or one patched by hand — each patch is tried in order: a clean reverse apply means applied, a
 * clean forward apply means it was not, and when neither works the patch's own added lines are looked for
 * in the working tree. A patch whose lines are absent neither applies nor is present, which is a checkout
 * this script will not guess about: it says so and names the remedy.
 */
function applyPatches(dir, component) {
  const patchDir = join(REPO_ROOT, "patches", "toolchain", component);
  if (!existsSync(patchDir)) return;
  const names = readdirSync(patchDir).filter((entry) => entry.endsWith(".patch")).sort();
  if (names.length === 0) return;
  const patchSet = names.map((name) => ({ name, sha256: sha256File(join(patchDir, name)) }));
  if (matchesRecord(dir, component, patchSet)) {
    console.log(`patch  ${component}: ${names.length} patch(es) already applied (recorded)`);
    return;
  }
  for (const name of names) {
    const patch = join(patchDir, name);
    const applied = spawnSync("git", ["apply", "--reverse", "--check", patch], { cwd: dir, windowsHide: true });
    if (applied.status === 0) {
      console.log(`patch  ${component}: ${name} already applied`);
      continue;
    }
    const forward = spawnSync("git", ["apply", patch], { cwd: dir, windowsHide: true });
    if (forward.status === 0) {
      console.log(`patch  ${component}: ${name}`);
      continue;
    }
    if (patchAddsArePresent(dir, patch)) {
      console.log(`patch  ${component}: ${name} already applied (a later patch rewrote the same lines)`);
      continue;
    }
    throw new Error(
      `patch  ${component}: ${name} neither applies nor is present in ${dir} (${(forward.stderr ?? "").toString().trim().split("\n")[0] ?? "git apply failed"}); ` +
        `the checkout carries a different patch set — remove ${dir} and rebuild, or run with --clean`,
    );
  }
  writeRecord(dir, component, patchSet);
}

/** The record of the patch set applied to one checkout, whose absence means "never recorded". */
const PATCH_RECORD_FILE = ".dsh-toolchain-patches.json";

/** The SHA-256 hex digest of one patch file, so an edited patch cannot pass the record. */
function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Whether this checkout records exactly this patch set. */
function matchesRecord(dir, component, patchSet) {
  let record;
  try {
    record = JSON.parse(readFileSync(join(dir, PATCH_RECORD_FILE), "utf8"));
  } catch {
    // No record, an unreadable one, or an unparsable one all mean the same thing: apply and record.
    return false;
  }
  if (record?.component !== component || !Array.isArray(record.patches)) return false;
  if (record.patches.length !== patchSet.length) return false;
  return patchSet.every((patch, index) => record.patches[index]?.name === patch.name && record.patches[index]?.sha256 === patch.sha256);
}

/** Record the patch set, so the next run does not have to ask git. */
function writeRecord(dir, component, patchSet) {
  writeFileSync(join(dir, PATCH_RECORD_FILE), `${JSON.stringify({ component, patches: patchSet }, null, 2)}\n`);
}

/**
 * Whether every line a patch adds is already in the working tree.
 *
 * The verdict of last resort, used only when the patch neither applies nor reverses: it is what tells
 * "applied and then rewritten by a later patch" apart from "this checkout is not the tree the patch was
 * generated from". One missing line is enough to answer false, and the caller then refuses instead of
 * guessing. Line endings are normalized because a Windows checkout may hold CRLF where the patch has LF.
 */
function patchAddsArePresent(dir, patchPath) {
  const added = new Map();
  let file = null;
  for (const line of readFileSync(patchPath, "utf8").split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "").trim();
      added.set(file, []);
      continue;
    }
    if (file === null || line.startsWith("+")) {
      if (file !== null && line.startsWith("+")) added.get(file).push(line.slice(1));
      continue;
    }
  }
  for (const [target, lines] of added) {
    if (lines.length === 0) continue;
    const path = join(dir, target);
    if (!existsSync(path)) return false;
    const present = new Set(readFileSync(path, "utf8").replace(/\r\n/g, "\n").split("\n"));
    if (!lines.every((line) => present.has(line))) return false;
  }
  return added.size > 0;
}

/**
 * Fail when the checkout still builds against the real `wild`.
 *
 * A silently unpatched toolchain is the one outcome that would make every measurement meaningless,
 * so this is checked rather than assumed: the patched dependency has no registry source.
 */
function assertWildPatched(dir) {
  const lockText = readFileSync(join(dir, "Cargo.lock"), "utf8");
  const blocks = lockText.split("[[package]]").filter((block) => /^\s*name = "wild"\s*$/m.test(block));
  if (blocks.length === 0) throw new Error(`${dir}: Cargo.lock has no wild entry, so the patch cannot have applied`);
  if (!blocks.some((block) => !/^\s*source = /m.test(block))) {
    throw new Error(`${dir}: wild still resolves from the registry; the ${lock.wildStub} patch was ignored`);
  }
}

/**
 * Rewrites the build directory out of every artifact this script produces.
 *
 * rustc records the file a panic came from, so without this each shipped binary carries
 * `C:\Users\<name>\AppData\Local\…` and publishes whoever compiled it. It has to happen at compile time:
 * those strings come from `file!()`, not from debug info, so stripping would not have removed them.
 */
const REMAP_BUILD_PATHS = `--remap-path-prefix=${homedir()}=/build`;

/** Build one source in release mode with the profile overrides that keep the build reasonable. */
function build(dir, features) {
  const args = ["build", "--release"];
  if (features.length > 0) args.push("--features", features.join(","));
  console.log(`build  ${dir} (${args.join(" ")})`);
  run("cargo", args, {
    cwd: dir,
    env: {
      ...process.env,
      // uutils ships `lto = "fat"` and a single codegen unit for release; that is worth hours on a
      // multi-crate workspace and buys nothing for a toolchain we do not benchmark here.
      CARGO_PROFILE_RELEASE_LTO: "off",
      CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16",
      RUSTFLAGS: REMAP_BUILD_PATHS,
    },
  });
}

/** Every executable directly inside `target/release`, minus the component's declared non-commands. */
function builtExecutables(dir, skip) {
  const releaseDir = join(dir, "target", "release");
  if (!existsSync(releaseDir)) return [];
  return readdirSync(releaseDir)
    .filter((name) => name.endsWith(".exe"))
    .map((name) => ({ name, stem: name.replace(/\.exe$/i, "") }))
    .filter((entry) => !skip.includes(entry.stem))
    .map((entry) => join(releaseDir, entry.name));
}

/** The function names a multi-call binary reports, or null when it is an ordinary program. */
function multiCallNames(path) {
  const result = spawnSync(path, ["--list"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  const names = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_.+-]+$/.test(line));
  return names.length > 1 ? names : null;
}

/**
 * Install one executable, publishing every name a multi-call binary answers to.
 *
 * The published names are the return value rather than a count, because they are the fact the packaged
 * toolchain needs: `scripts/pack-toolchain.mjs` groups the shipped binaries by component from exactly this
 * list, so the package cannot disagree with what a build installs.
 * @param path - the built executable.
 * @param as - the single name to publish instead of the binary's own names, for a renamed component.
 * @returns the names published.
 */
function install(path, as = null) {
  const stem = path.slice(path.lastIndexOf("\\") + 1).replace(/\.exe$/i, "");
  const names = multiCallNames(path);
  // A component whose binary name differs from the command it provides (`jaq` → `jq`) renames here; a
  // multi-call binary is never renamed, because its name is what selects the applet.
  const published = as !== null ? [as] : (names ?? [stem]).filter((name) => !WITHHELD.has(name) && !SERVED_BY_ENGINE.has(name));
  let linked = 0;
  for (const name of published) {
    const target = join(toolsDir, `${name}.exe`);
    rmSync(target, { force: true });
    try {
      linkSync(path, target);
    } catch {
      copyFileSync(path, target);
    }
    PUBLISHED.add(name);
    linked += 1;
  }
  const withheld = (names ?? []).filter((name) => WITHHELD.has(name));
  const served = (names ?? []).filter((name) => SERVED_BY_ENGINE.has(name));
  console.log(
    `install ${path.slice(path.lastIndexOf("\\") + 1)} as ${linked} name(s)${names === null ? "" : ` (multi-call${withheld.length > 0 ? `, ${withheld.join(", ")} withheld` : ""}${served.length > 0 ? `, ${served.length} served by the engine` : ""})`}`,
  );
  return published;
}

/**
 * Programs this install must never publish, because the copy cannot work here.
 *
 * `stdbuf` is the only one: uutils' implementation loads a companion `libstdbuf` library at run time and
 * this build produces none, so the name fails with `External libstdbuf not found` — measured, which is
 * why it is neither installed nor advertised.
 */
const WITHHELD = new Set(["stdbuf"]);

/**
 * Programs this install must not publish, because the engine answers them by name.
 *
 * A bundled utility is a shell builtin, and a builtin cannot be exec'd, so `find -exec rm` and `xargs rm`
 * reach the utility only through `PATH`. The plugin's shim directory publishes the bundled names as hard
 * links to the engine, and patch `0016` makes the engine dispatch on its own file name — so the file exists
 * and it *is* the engine. Publishing a copy here would mean two implementations of one utility, each needing
 * its own patch; the list is `BUILT_IN_UTILITIES` from `src/toolchain.ts` (compiled to `lib/`), not a second
 * copy of it.
 */
const SERVED_BY_ENGINE = new Set(BUILT_IN_UTILITIES);

/**
 * The names the contract advertises: every one of them has to be installed, or the contract is wrong.
 *
 * Everything a child process may exec has to exist as a file on `PATH`, which is why this farm used to carry
 * a copy of every utility the engine bundles; with `0016` and the shim directory it no longer does, and the
 * engine's own copy answers those names. What is left is filtered only by {@link WITHHELD} and
 * {@link SERVED_BY_ENGINE}. Which of the remaining names are ever *advertised* is `src/toolchain.ts`'s
 * decision, not this script's.
 */
const ADVERTISED = [...TOOLCHAIN_COMMANDS, ...NOTABLE_ADDITIONS];

/** Every name this run published, which is all the directory is allowed to hold. */
const PUBLISHED = new Set();

/** Refuse a component that would publish a name a copy of which cannot work in this install. */
function assertPublishable(name, owner) {
  if (WITHHELD.has(name)) {
    throw new Error(`${owner} installs \`${name}\`, which cannot work in this build (a companion library this build does not produce); drop it from toolchain.lock.json or stop withholding it`);
  }
}

/**
 * The Go toolchain a `goSources` component needs.
 *
 * Found the way the build finds ssh: on `PATH` first, then where winget's package puts it, because a shell
 * started before the install does not see the updated `PATH`. A missing Go toolchain is a refusal with the
 * command to fix it, not a silent skip — the component is advertised, so it has to be built.
 */
function goExecutable() {
  for (const candidate of ["go", "C:/Program Files/Go/bin/go.exe"]) {
    const probe = spawnSync(candidate, ["version"], { stdio: "ignore", windowsHide: true });
    if (probe.status === 0) return candidate;
  }
  throw new Error("the Go toolchain is required by the components in `goSources` and was not found; install it with `winget install GoLang.Go` and re-run");
}

/** Remove executables no component provides, so a stale name from an older install cannot linger. */
function pruneForeign() {
  let removed = 0;
  for (const entry of readdirSync(toolsDir)) {
    if (!entry.toLowerCase().endsWith(".exe")) continue;
    if (PUBLISHED.has(entry.replace(/\.exe$/i, ""))) continue;
    rmSync(join(toolsDir, entry), { force: true });
    console.log(`remove ${entry} (no component provides it)`);
    removed += 1;
  }
  return removed;
}

/** Fail when an advertised program, or any name this run published, is not on disk. */
function assertPublished() {
  const missing = [...ADVERTISED, ...PUBLISHED].filter((name) => !existsSync(join(toolsDir, `${name}.exe`)));
  if (missing.length > 0) {
    throw new Error(`the install is missing ${missing.join(", ")}; the contract advertises the first ${ADVERTISED.length} programs and \`find -exec\`/\`xargs\` need the rest, so every one of them has to be carried`);
  }
  const withheld = [...WITHHELD].filter((name) => existsSync(join(toolsDir, `${name}.exe`)));
  if (withheld.length > 0) {
    throw new Error(`${withheld.join(", ")} is on disk but cannot work in this build; withholding a program means it must not be installed either`);
  }
  const duplicated = [...SERVED_BY_ENGINE].filter((name) => existsSync(join(toolsDir, `${name}.exe`)));
  if (duplicated.length > 0) {
    throw new Error(
      `${duplicated.length} name(s) the engine serves are on disk (${duplicated.slice(0, 8).join(", ")}${duplicated.length > 8 ? ", …" : ""}); the farm must not carry a second implementation of a bundled utility`,
    );
  }
}

const built = [];
for (const source of lock.sources) {
  if (only !== null && !only.has(source.name)) continue;
  console.log(`\n=== ${source.name} (${source.tag}) ===`);
  const dir = syncSource(source);
  // Only the components that read their arguments through `uucore` need the stub: it replaces the `wild`
  // crate those builds depend on. `uutils/awk` and `jaq` share no code with them, so the injection is
  // skipped and the check that the lock resolved it is skipped with it.
  if (source.wildStub !== false) {
    injectWildStub(dir);
  }
  if (source.pathAlias === true) {
    injectPathAlias(dir, "rs");
  }
  applyPatches(dir, source.name);
  // A component whose messages have to name the OS error code on a refusal: the ones built from a
  // registry `uucore` get a vendored, patched copy (see `patches/uucore/README.md`), while `coreutils`
  // carries `uucore` in-repo and is covered by its own patch in `patches/toolchain`. Either way the guard
  // is verified against the source the build compiles, and the build stops if it is not there.
  const uucore = source.uucoreErrno === true ? applyUucoreOverride({ checkout: dir, repoRoot: REPO_ROOT, cacheRoot, io }) : { vendorDir: "" };
  if (source.uucoreErrno === true) {
    assertUucoreGuard({ checkout: dir, vendorDir: uucore.vendorDir, io });
  }
  build(dir, source.features ?? []);
  if (source.wildStub !== false) {
    assertWildPatched(dir);
  }
  const executables = builtExecutables(dir, source.skip ?? []);
  if (executables.length === 0) throw new Error(`${source.name}: no executables were produced`);
  const names = [];
  for (const executable of executables) {
    const stem = executable.slice(executable.lastIndexOf("\\") + 1).replace(/\.exe$/i, "");
    names.push(...install(executable, source.rename?.[stem] ?? null));
  }
  built.push({ name: source.name, tag: source.tag, names, executables: executables.length, uucore: source.uucoreErrno === true ? uucore.version : "" });
}

/** Fetch a URL, retrying the connection failures this network produces intermittently. */
async function fetchWithRetry(url, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return response;
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.log(`retry  GET ${url} (attempt ${attempt + 1} of ${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    }
  }
}

/**
 * Download one prebuilt archive or executable, verifying it against the lock.
 *
 * When the lock has no digest for an entry, the computed one is written back: the lock is the
 * authority for what was built, and filling it in on the first build is what pins it.
 */
async function fetchPrebuilt(entry) {
  const downloadDir = join(cacheRoot, "downloads");
  mkdirSync(downloadDir, { recursive: true });
  const file = join(downloadDir, basename(entry.url));
  if (!existsSync(file)) {
    console.log(`download  ${entry.name} ${entry.version}`);
    writeFileSync(file, Buffer.from(await (await fetchWithRetry(entry.url)).arrayBuffer()));
  }
  const digest = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (entry.sha256 === undefined) {
    entry.sha256 = digest;
    writeFileSync(join(REPO_ROOT, "toolchain.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`pin  ${entry.name} sha256=${digest}`);
  } else if (entry.sha256 !== digest) {
    throw new Error(`${entry.name}: ${file} has sha256 ${digest}, the lock records ${entry.sha256}`);
  }
  return file;
}

/** Install one prebuilt entry under the name the corpus expects, with its license text. */
async function installPrebuilt(entry) {
  assertPublishable(entry.as, `the prebuilt ${entry.name}`);
  const file = await fetchPrebuilt(entry);
  const target = join(toolsDir, `${entry.as}.exe`);
  if (entry.member === null || entry.member === undefined) {
    copyFileSync(file, target);
  } else {
    const extractDir = join(cacheRoot, "extract", entry.name);
    rmSync(extractDir, { recursive: true, force: true });
    mkdirSync(extractDir, { recursive: true });
    // Windows ships bsdtar, which reads zip archives and avoids a dependency on an unzip tool.
    run("tar", ["-xf", file, "-C", extractDir, entry.member]);
    copyFileSync(join(extractDir, entry.member), target);
  }
  const licenseDir = join(dirname(toolsDir), "LICENSES");
  mkdirSync(licenseDir, { recursive: true });
  try {
    writeFileSync(join(licenseDir, `${entry.name}.txt`), await (await fetchWithRetry(entry.licenseUrl, 5)).text());
  } catch (error) {
    // The licence identifier and source URL are recorded in the manifest either way, so a flaky
    // download of the text must not fail a build that already produced working binaries.
    console.log(`warn   ${entry.name}: licence text unavailable (${error.message})`);
  }
  PUBLISHED.add(entry.as);
  console.log(`install ${entry.name} as ${entry.as}.exe (${entry.license})`);
  return { name: entry.name, version: entry.version, license: entry.license, source: entry.url, sha256: entry.sha256, installed: `${entry.as}.exe`, names: [entry.as] };
}

const prebuiltEntries = [];
const prebuilts = lock.prebuilt ?? [];
for (const entry of prebuilts) {
  if (only !== null && !only.has(entry.name)) continue;
  console.log(`\n=== ${entry.name} (${entry.version}) ===`);
  prebuiltEntries.push(await installPrebuilt(entry));
}

/** Build a component whose source is Go, which is what a prebuilt-only component needs once it is patched. */
const goEntries = [];
for (const entry of lock.goSources ?? []) {
  if (only !== null && !only.has(entry.name)) continue;
  console.log(`\n=== ${entry.name} (${entry.tag}, go) ===`);
  const dir = syncSource(entry);
  if (entry.pathAlias === true) {
    injectPathAlias(dir, "go");
  }
  applyPatches(dir, entry.name);
  const go = goExecutable();
  const built = join(dir, `${entry.name}.exe`);
  // `-trimpath` keeps the build reproducible: the binary must not carry this machine's checkout path.
  run(go, ["build", "-trimpath", "-o", built, "."], { cwd: dir });
  const installed = install(built, entry.rename?.[entry.name] ?? null);
  goEntries.push({ name: entry.name, version: entry.tag, license: entry.license ?? "MIT", source: entry.repo, installed: installed.join(", "), names: installed, executables: 1 });
}

/** Build a crate that lives in this repository, which is where the residual commands come from. */
const localEntries = [];
for (const entry of lock.local ?? []) {
  if (only !== null && !only.has(entry.name)) continue;
  const dir = join(REPO_ROOT, entry.dir);
  console.log(`\n=== ${entry.name} (in-repo) ===`);
  run("cargo", ["build", "--release"], { cwd: dir, env: { ...process.env, CARGO_PROFILE_RELEASE_LTO: "off", RUSTFLAGS: REMAP_BUILD_PATHS } });
  const installed = [];
  for (const bin of entry.bins) {
    assertPublishable(bin, `the in-repo component ${entry.name}`);
    const built = join(dir, "target", "release", `${bin}.exe`);
    if (!existsSync(built)) throw new Error(`${entry.name}: ${built} was not produced`);
    const target = join(toolsDir, `${bin}.exe`);
    rmSync(target, { force: true });
    try {
      linkSync(built, target);
    } catch {
      copyFileSync(built, target);
    }
    installed.push(`${bin}.exe`);
    PUBLISHED.add(bin);
    console.log(`install ${bin}.exe`);
  }
  localEntries.push({
    name: entry.name,
    version: "0.1.0",
    license: entry.license,
    source: `in-repo (${entry.dir})`,
    installed: installed.join(", "),
    names: entry.bins,
  });
}

/** Remove what no component provides, then check that every advertised program is on disk. */
if (only === null) {
  const pruned = pruneForeign();
  if (pruned > 0) console.log(`removed ${pruned} executable name(s) no component provides from ${toolsDir}`);
  assertPublished();
} else {
  console.log(`--only=${[...only].join(",")}: a subset build, so the rest of ${toolsDir} is left alone`);
}

/**
 * Put every component's licence text next to the binaries.
 *
 * The packaged toolchain ships those texts and refuses to exist without them, so a component the build
 * cannot cover is reported rather than skipped: the spellings differ per upstream (`LICENSE`, `LICENSE-MIT`,
 * `LICENSE.txt`), and a component built from this repository is covered by this repository's own LICENSE.
 * A file that is already there is left alone, which is also what keeps a prebuilt's downloaded text.
 * @returns the components no text could be found for.
 */
function collectLicenses() {
  const licenseDir = join(dirname(toolsDir), "LICENSES");
  mkdirSync(licenseDir, { recursive: true });
  const missing = [];
  const take = (name, candidates) => {
    const target = join(licenseDir, `${name}.txt`);
    if (existsSync(target)) return;
    const found = candidates.find((candidate) => existsSync(candidate));
    if (found === undefined) {
      missing.push(name);
      return;
    }
    copyFileSync(found, target);
  };
  for (const source of lock.sources) take(source.name, LICENSE_SPELLINGS.map((file) => join(cacheRoot, source.name, file)));
  for (const source of lock.goSources ?? []) take(source.name, LICENSE_SPELLINGS.map((file) => join(cacheRoot, source.name, file)));
  for (const component of lock.local ?? []) take(component.name, [join(REPO_ROOT, "LICENSE")]);
  return missing;
}

/** The file names upstreams use for the licence text this project redistributes. */
const LICENSE_SPELLINGS = ["LICENSE", "LICENSE.txt", "LICENSE-MIT", "LICENSE.md", "COPYING"];

const missingLicenses = collectLicenses();
if (missingLicenses.length > 0) {
  // A missing text is not fatal for a local build, but it must be visible: the packaged toolchain cannot
  // ship a component whose licence nobody recorded, and `pack-toolchain.mjs` refuses on exactly that.
  console.log(`warn   no licence text was found for ${missingLicenses.join(", ")}; the packaged toolchain cannot be built until they are`);
}
// The inventory accumulates across runs: `--only=<subset>` must not shrink the record of what is
// already installed.
const statePath = join(dirname(toolsDir), "build-state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : { components: {} };
for (const entry of built) {
  state.components[entry.name] = {
    name: entry.name,
    version: entry.tag,
    license: "MIT",
    source: lock.sources.find((source) => source.name === entry.name).repo,
    patch: lock.wildStub,
    installed: `${entry.names.length} executable name(s)`,
    // The names this component published, which is what the packaged toolchain is grouped by.
    names: entry.names,
  };
}
for (const entry of prebuiltEntries) state.components[entry.name] = entry;
for (const entry of goEntries) state.components[entry.name] = entry;
for (const entry of localEntries) state.components[entry.name] = entry;
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
const manifestPath = join(dirname(toolsDir), "manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      generated: new Date().toISOString(),
      target: lock.target,
      toolsDir,
      components: Object.values(state.components).sort((left, right) => left.name.localeCompare(right.name)),
    },
    null,
    2,
  )}\n`,
);

const installedNames = readdirSync(toolsDir).filter((name) => name.endsWith(".exe")).length;
console.log(`\ntools: ${toolsDir}`);
console.log(`built this run: ${built.map((entry) => `${entry.name}@${entry.tag} (${entry.names.length} names)`).join(", ") || "nothing"}`);
console.log(`go this run: ${goEntries.map((entry) => `${entry.name}@${entry.version}`).join(", ") || "nothing"}`);
console.log(`prebuilt this run: ${prebuiltEntries.map((entry) => `${entry.name}@${entry.version}`).join(", ") || "nothing"}`);
console.log(`manifest: ${join(dirname(toolsDir), "manifest.json")}`);
console.log(`programs published this run: ${PUBLISHED.size}; advertised in the contract: ${ADVERTISED.length}; executable names in the directory: ${installedNames}`);
