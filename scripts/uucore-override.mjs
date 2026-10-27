// Points a checkout's registry dependencies at vendored, patched copies of the same version.
//
// The rule each patch carries is documented beside it — `patches/uucore/README.md` for the OS error code a
// refused file effect has to keep.
// This module owns the uucore override the toolchain build applies; the engine build vendors nothing.
// machinery and the `uucore` entry, whose copy needs the coreutils monorepo layout described below.
//
// A crate from the registry cannot be patched in place — the source cache is shared with every other
// build on the machine and cargo owns it — so the crate is copied into this project's build cache, the
// patch is applied to that copy, and `[patch.crates-io]` is pointed at it. The copy is never checked in:
// what is tracked is the patch, the resolved version and the digest that ties them together.
//
// The copy is laid out as the coreutils monorepo lays uucore out (`<root>/src/uucore` beside
// `<root>/src/uu/<utility>/locales`), and that is not cosmetic. `uucore`'s build script embeds the
// Fluent locale bundles by walking `project_root/src/uu` — `CARGO_MANIFEST_DIR/../..` — and always
// embeds `<project_root>/src/uucore/locales`. A copy dropped into a directory of its own therefore finds
// no `src/uu` at all, falls back to scanning whatever `uu_*` crates happen to sit beside the crate, finds
// none, and the engine then prints raw message ids: measured `brush.exe: mkdir-error-cannot-create-directory`
// instead of the sentence. So the vendored tree carries the utility bundles the registry has unpacked,
// which is exactly the set the crates.io fallback would have embedded, and the layout gives the primary
// path something to walk. A crate whose manifest says `build = false` — `uu_tail` — has no such script and
// is copied as it is.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative as relativeTo } from "node:path";

/**
 * A registry crate this build replaces with a patched copy of the resolved version.
 *
 * `guard` is the discipline the whole mechanism rests on: a line only the patched file carries, checked in
 * the copy the build will compile. Without it a `git apply` that silently did nothing looks exactly like a
 * successful apply, and the engine ships unpatched.
 * @typedef {object} VendoredCrate
 * @property {string} name - the crate's name, which is also its `[patch.crates-io]` key and lock entry.
 * @property {string} patch - the tracked patch, relative to the repository root.
 * @property {string} module - the patched file inside the crate copy, relative to the crate root.
 * @property {string} guard - a line only the patched `module` carries.
 * @property {string} guardFailure - what the guard check says when that line is missing.
 * @property {string} [layout] - `"monorepo"` when the copy has to sit at `<root>/src/<name>`.
 * @property {string} [patchDirectory] - the `git apply --directory` a monorepo-layout patch needs.
 * @property {string} [inRepoPatch] - the patch set that edits an in-repo copy of this crate instead.
 */

/** The `uucore` entry: its copy needs the monorepo layout for the locale bundles its build script walks. */
export const UUCORE_CRATE = {
  name: "uucore",
  patch: join("patches", "uucore", "0001-keep-the-os-error-code.patch"),
  module: join("src", "lib", "mods", "error.rs"),
  guard: "if err.kind() == std::io::ErrorKind::PermissionDenied {",
  guardFailure: "does not keep the OS error code on a refusal",
  layout: "monorepo",
  patchDirectory: "src/uucore",
  inRepoPatch: "patches/toolchain",
};

/** The tracked `uucore` patch every vendored copy receives, relative to the repository root. */
export const UUCORE_PATCH = UUCORE_CRATE.patch;

/** The record inside a vendored root naming the version and patch digest it was built from. */
function markerFile(name) {
  return `.dsh-${name}-patch.json`;
}

/** Split a `Cargo.lock` into its `[[package]]` blocks. */
function lockBlocks(lockText) {
  return lockText.split("[[package]]").slice(1);
}

/**
 * The packages a checkout's lock resolves under one name.
 *
 * A lock that resolves two versions cannot be served by one `[patch.crates-io]` entry, and half-applying
 * this rule silently is the failure mode worth refusing: the caller gets the list so it can say so.
 * @param checkout - the checkout whose `Cargo.lock` to read.
 * @param name - the crate name to look for.
 * @returns one entry per resolved package: its version and whether it already resolves from a path.
 */
export function resolvedCrate(checkout, name) {
  const blocks = lockBlocks(readFileSync(join(checkout, "Cargo.lock"), "utf8")).filter((block) =>
    new RegExp(`^\\s*name = "${name}"\\s*$`, "m").test(block),
  );
  return blocks.map((block) => ({
    version: /^\s*version = "([^"]+)"/m.exec(block)?.[1] ?? "",
    fromPath: !/^\s*source = /m.test(block),
  }));
}

/**
 * The `uucore` packages a checkout's lock resolves.
 * @param checkout - the checkout whose `Cargo.lock` to read.
 * @returns one entry per resolved `uucore`: its version and whether it already resolves from a path.
 */
export function resolvedUucore(checkout) {
  return resolvedCrate(checkout, UUCORE_CRATE.name);
}

/** The directory a checkout declares for one of its in-repo dependencies, or an empty string. */
function declaredCratePath(checkout, name) {
  const manifest = readFileSync(join(checkout, "Cargo.toml"), "utf8");
  return new RegExp(`^${name}\\s*=\\s*\\{[^}]*path\\s*=\\s*"([^"]+)"`, "m").exec(manifest)?.[1] ?? "";
}

/** The section body of `[patch.crates-io]`, including an empty body, or null when the section is absent. */
function cratesIoPatchSection(manifestText) {
  const header = /^\[patch\.crates-io\][ \t]*$/m.exec(manifestText);
  if (header === null) return null;
  const start = header.index + header[0].length;
  const rest = manifestText.slice(start);
  const next = /^\[/m.exec(rest);
  return { start, end: next === null ? manifestText.length : start + next.index, body: manifestText.slice(start, next === null ? manifestText.length : start + next.index) };
}

/** The path a checkout's own `[patch.crates-io]` entry names for one crate, or an empty string. */
function declaredCrateOverride(checkout, name) {
  const section = cratesIoPatchSection(readFileSync(join(checkout, "Cargo.toml"), "utf8"));
  if (section === null) return "";
  return new RegExp(`^${name}\\s*=\\s*\\{[^}]*path\\s*=\\s*"([^"]+)"`, "m").exec(section.body)?.[1] ?? "";
}

/** Whether a path is inside a directory, compared case-insensitively as Windows paths have to be. */
function isInside(path, directory) {
  const relative = relativeTo(directory, path);
  return relative.length > 0 && !relative.startsWith("..") && !isAbsolute(relative);
}

/**
 * Point a checkout's `[patch.crates-io]` entry at a vendored copy.
 *
 * Replacing an override that names a different directory is refused unless the caller says the entry is
 * this helper's own: someone else's override is a decision, while a stale path into this project's own
 * cache is a layout change that has to be followed.
 * @param options - the checkout, the crate name, the vendored directory, and whether this helper owns the current entry.
 * @returns whether the manifest was rewritten.
 */
function pointAtCrate({ checkout, name, vendorDir, replace, io }) {
  const manifest = join(checkout, "Cargo.toml");
  const text = readFileSync(manifest, "utf8");
  const wanted = `${name} = { path = "${vendorDir.replace(/\\/g, "/")}" }`;
  const section = cratesIoPatchSection(text);
  const declared = section === null ? undefined : new RegExp(`^${name}\\s*=[ \\t]*\\{[^}]*\\}[ \\t]*$`, "m").exec(section.body)?.[0];
  if (declared !== undefined) {
    if (declared.trim() === wanted) return false;
    if (replace !== true) {
      throw new Error(`${manifest} already points ${name} at ${declared.trim()}; replacing that override is a decision, so it is refused rather than overwritten`);
    }
    writeFileSync(manifest, `${text.slice(0, section.start)}${text.slice(section.start, section.end).replace(declared, wanted)}${text.slice(section.end)}`);
  } else if (section === null) {
    writeFileSync(manifest, `${text.trimEnd()}\n\n[patch.crates-io]\n${wanted}\n`);
  } else {
    writeFileSync(manifest, `${text.slice(0, section.end).trimEnd()}\n${wanted}\n${text.slice(section.end)}`);
  }
  io.log(`patch  ${checkout}: ${name} -> ${vendorDir}`);
  return true;
}

/** Where a crate source of this name and version sits in the cargo source cache, or an empty string. */
function cachedCrateSource(name, version, cargoHome) {
  const root = join(cargoHome, "registry", "src");
  if (!existsSync(root)) return "";
  for (const index of readdirSync(root)) {
    const candidate = join(root, index, `${name}-${version}`);
    if (existsSync(join(candidate, "Cargo.toml"))) return candidate;
  }
  return "";
}

/**
 * The directory one crate occupies inside its vendored root.
 *
 * A monorepo-layout copy lives where the coreutils monorepo keeps it, `<root>/src/<name>`, because that is
 * the path its build script walks for locale bundles; every other crate is its own root.
 */
function crateDir(vendorRoot, crate) {
  return crate.layout === "monorepo" ? join(vendorRoot, "src", crate.name) : vendorRoot;
}

/**
 * Copy one registry crate into the build cache and apply the tracked patch to the copy.
 *
 * The copy is rebuilt whenever the recorded version or patch digest differs, so editing the patch takes
 * effect on the next build and a stale copy cannot be mistaken for the patched one.
 * @param options - the crate, the version to vendor, the checkout, the build cache, the repository root and the run/log seam.
 * @returns the directory (the crate itself, inside its vendored root).
 */
export function vendorRegistryCrate({ crate, version, checkout, cacheRoot, repoRoot, io }) {
  const patchFile = join(repoRoot, crate.patch);
  const digest = createHash("sha256").update(readFileSync(patchFile)).digest("hex");
  const vendorRoot = join(cacheRoot, "vendor", `${crate.name}-${version}`);
  const vendorDir = crateDir(vendorRoot, crate);
  const marker = join(vendorRoot, markerFile(crate.name));
  const patched = join(vendorDir, crate.module);
  if (existsSync(marker)) {
    const recorded = JSON.parse(readFileSync(marker, "utf8"));
    if (recorded.version === version && recorded.patch === digest) {
      if (existsSync(patched) && readFileSync(patched, "utf8").includes(crate.guard)) {
        io.log(`reuse  ${crate.name} ${version} (patched, ${vendorDir})`);
        return vendorDir;
      }
      io.log(`rebuild ${crate.name} ${version}: the recorded copy is incomplete or unpatched`);
    } else {
      io.log(`rebuild ${crate.name} ${version}: the record does not match the patch`);
    }
  }
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  let source = cachedCrateSource(crate.name, version, cargoHome);
  if (source.length === 0) {
    // A clean machine has the index but not the crate source; `cargo fetch` is what puts it there.
    io.log(`fetch  ${crate.name} ${version} is absent from ${join(cargoHome, "registry", "src")}; running cargo fetch`);
    io.run("cargo", ["fetch"], { cwd: checkout });
    source = cachedCrateSource(crate.name, version, cargoHome);
  }
  if (source.length === 0) {
    throw new Error(`${crate.name} ${version} is not in the cargo source cache under ${cargoHome} and \`cargo fetch\` did not put it there`);
  }
  rmSync(vendorRoot, { recursive: true, force: true });
  mkdirSync(dirname(vendorDir), { recursive: true });
  cpSync(source, vendorDir, { recursive: true });
  // The utility bundles `uucore`'s build script expects to find beside itself, copied from the same
  // registry directory the crate came from. Not filtered by version: the crates.io fallback embeds every
  // `uu_*` crate it finds there, so this reproduces that set exactly instead of a narrower one. Only the
  // monorepo layout needs them; a crate with `build = false` has no script to walk them.
  let utilities = 0;
  if (crate.layout === "monorepo") {
    for (const sibling of readdirSync(dirname(source))) {
      const name = /^uu_(.+)-(\d[^-]*)$/.exec(sibling)?.[1];
      if (name === undefined) continue;
      const locales = join(dirname(source), sibling, "locales");
      if (!existsSync(locales)) continue;
      cpSync(locales, join(vendorRoot, "src", "uu", name, "locales"), { recursive: true });
      utilities += 1;
    }
  }
  // The vendored copy is outside any repository, and the patch's own line endings are LF while a checkout
  // may hold CRLF, so the apply must not go through the machine's autocrlf conversion. `--directory`
  // re-roots a monorepo-layout patch's paths at the crate's place inside that tree.
  const directory = crate.patchDirectory === undefined ? [] : [`--directory=${crate.patchDirectory}`];
  // The copy has to be outside any repository: inside one, `git apply` re-roots the patch at that
  // repository and reports success without touching the crate. The ceiling stops the upward search at the
  // copy's parent, which also covers a checkout whose temp directory sits inside it.
  io.run("git", ["-c", "core.autocrlf=false", "apply", ...directory, patchFile], {
    cwd: vendorRoot,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(vendorRoot) },
  });
  if (!readFileSync(patched, "utf8").includes(crate.guard)) {
    throw new Error(`${vendorDir}: \`git apply\` reported success but ${crate.module} does not carry the guard`);
  }
  writeFileSync(marker, `${JSON.stringify({ version, patch: digest, patchFile: crate.patch, source, utilities }, null, 2)}\n`);
  io.log(`vendor ${crate.name} ${version} -> ${vendorDir} (${crate.patch}, ${utilities} utility locale set(s))`);
  return vendorDir;
}

/**
 * Point a checkout at a vendored crate, rebuild the lock entry, and prove it took.
 *
 * An in-repo copy needs nothing: its own patch set edits that copy, and the guard check still runs against
 * it.
 * @param options - the crate, the checkout, the repository root, the build cache, and the run/log seam.
 * @returns the resolved version and the vendored directory (empty for an in-repo copy).
 */
export function applyCrateOverride({ crate, checkout, repoRoot, cacheRoot, io }) {
  const resolved = resolvedCrate(checkout, crate.name);
  if (resolved.length === 0) throw new Error(`${checkout}: Cargo.lock resolves no ${crate.name} package, so the override has no target`);
  if (resolved.length > 1) {
    throw new Error(
      `${checkout}: Cargo.lock resolves ${resolved.length} ${crate.name} versions (${resolved.map((entry) => entry.version).join(", ")}), and one [patch.crates-io] entry cannot serve them all; pin the dependency before building`,
    );
  }
  const entry = resolved[0];
  if (entry.fromPath) {
    const override = declaredCrateOverride(checkout, crate.name);
    if (override.length === 0) {
      const by = crate.inRepoPatch === undefined ? "its own patch set" : crate.inRepoPatch;
      io.log(`in-repo ${crate.name} ${entry.version} in ${checkout} (patched by ${by})`);
      return { version: entry.version, vendorDir: "" };
    }
    const declared = normalize(override);
    if (!isInside(declared, join(cacheRoot, "vendor"))) {
      // An override that is not this project's own is a decision; its guard is checked below like any other.
      io.log(`reuse  ${crate.name} ${entry.version} (patched elsewhere, ${declared})`);
      return { version: entry.version, vendorDir: declared };
    }
    // This project's own copy: re-vendoring is what proves the layout and the patch digest are current, so
    // a cache written by an older layout is rebuilt instead of being trusted because a path exists.
    const vendorDir = vendorRegistryCrate({ crate, version: entry.version, checkout, cacheRoot, repoRoot, io });
    if (declared !== vendorDir) {
      // A path dependency carries no path in `Cargo.lock`, so following a layout change needs no lock update.
      pointAtCrate({ checkout, name: crate.name, vendorDir, replace: true, io });
    }
    io.log(`verify ${checkout}: ${crate.name} ${entry.version} resolves from ${vendorDir}`);
    return { version: entry.version, vendorDir };
  }
  const vendorDir = vendorRegistryCrate({ crate, version: entry.version, checkout, cacheRoot, repoRoot, io });
  pointAtCrate({ checkout, name: crate.name, vendorDir, replace: false, io });
  // A lock that still names the registry copy means cargo ignored the patch (it only warns), and the
  // build would then produce an engine whose behaviour is unpatched while everything looks fine.
  const current = resolvedCrate(checkout, crate.name)[0];
  if (current.fromPath !== true) {
    io.run("cargo", ["update", "-p", crate.name], { cwd: checkout });
  }
  const settled = resolvedCrate(checkout, crate.name);
  if (settled.length !== 1 || settled[0].fromPath !== true || settled[0].version !== entry.version) {
    throw new Error(`${checkout}: ${crate.name} still resolves as ${settled.map((item) => `${item.version}${item.fromPath ? " (path)" : " (registry)"}`).join(", ")}; the [patch.crates-io] entry was not adopted`);
  }
  io.log(`verify ${checkout}: ${crate.name} ${entry.version} resolves from ${vendorDir}`);
  return { version: entry.version, vendorDir };
}

/**
 * Prove a vendored crate carries its patch, in the copy this checkout builds against.
 *
 * {@link applyCrateOverride} checks the copy it just wrote; this check reads the file the build will
 * compile either way, so the in-repo shape — whose patch comes from another patch set — is covered by the
 * same statement.
 * @param options - the crate, the checkout, the vendored directory, and the log seam.
 * @returns the patched file's path.
 */
export function assertCrateGuard({ crate, checkout, vendorDir, io }) {
  const inRepo = declaredCratePath(checkout, crate.name);
  const file = vendorDir.length > 0 ? join(normalize(vendorDir), crate.module) : join(checkout, inRepo, crate.module);
  if (!existsSync(file)) throw new Error(`${file} does not exist, so the guard cannot be verified`);
  if (!readFileSync(file, "utf8").includes(crate.guard)) {
    throw new Error(`${file} ${crate.guardFailure}; apply ${crate.patch} before building`);
  }
  io.log(`guard  ${file}`);
  return file;
}

/**
 * Point a checkout at a vendored `uucore`, rebuild the lock entry, and prove it took.
 * @param options - the checkout, the repository root, the build cache, and the run/log seam.
 * @returns the resolved version and the vendored directory (empty for an in-repo `uucore`).
 */
export function applyUucoreOverride({ checkout, repoRoot, cacheRoot, io }) {
  return applyCrateOverride({ crate: UUCORE_CRATE, checkout, repoRoot, cacheRoot, io });
}

/**
 * Prove the guard is really in the `uucore` this checkout builds against.
 * @param options - the checkout, the vendored directory from {@link applyUucoreOverride}, and the log seam.
 * @returns the patched file's path.
 */
export function assertUucoreGuard({ checkout, vendorDir, io }) {
  return assertCrateGuard({ crate: UUCORE_CRATE, checkout, vendorDir, io });
}