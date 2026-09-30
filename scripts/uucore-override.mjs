// Points a checkout's `uucore` dependency at a vendored, patched copy of the same version.
//
// The rule the patch carries is documented in `patches/uucore/README.md`: a refused file effect has to
// keep the OS error code in its message, because the code is the only part of that message which does
// not depend on the host's language, and the plugin that runs these programs classifies a refusal by
// matching stderr. `uucore` is the single place every uutils program formats those messages, so it is
// also the single place the code has to survive.
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
// path something to walk.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, relative as relativeTo } from "node:path";

/** The tracked patch every vendored copy receives, relative to the repository root. */
export const UUCORE_PATCH = join("patches", "uucore", "0001-keep-the-os-error-code.patch");

/** A line only the patched `strip_errno` carries, used to verify an application that reported success. */
const GUARD = "if err.kind() == std::io::ErrorKind::PermissionDenied {";

/** The record inside a vendored copy naming the version and patch digest it was built from. */
const MARKER_FILE = ".dsh-uucore-patch.json";

/** The path of the patched file inside a `uucore` crate. */
const ERROR_MODULE = join("src", "lib", "mods", "error.rs");

/** Split a `Cargo.lock` into its `[[package]]` blocks. */
function lockBlocks(lockText) {
  return lockText.split("[[package]]").slice(1);
}

/**
 * The `uucore` packages a checkout's lock resolves.
 *
 * A lock that resolves two versions cannot be served by one `[patch.crates-io]` entry, and half-applying
 * this rule silently is the failure mode worth refusing: the caller gets the list so it can say so.
 * @param checkout - the checkout whose `Cargo.lock` to read.
 * @returns one entry per resolved `uucore`: its version and whether it already resolves from a path.
 */
export function resolvedUucore(checkout) {
  const blocks = lockBlocks(readFileSync(join(checkout, "Cargo.lock"), "utf8")).filter((block) => /^\s*name = "uucore"\s*$/m.test(block));
  return blocks.map((block) => ({
    version: /^\s*version = "([^"]+)"/m.exec(block)?.[1] ?? "",
    fromPath: !/^\s*source = /m.test(block),
  }));
}

/** The directory a checkout declares for its in-repo `uucore`, or an empty string. */
function declaredUucorePath(checkout) {
  const manifest = readFileSync(join(checkout, "Cargo.toml"), "utf8");
  return /^uucore\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/m.exec(manifest)?.[1] ?? "";
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

/** The `uucore` path a checkout's own `[patch.crates-io]` entry names, or an empty string. */
function declaredUucoreOverride(checkout) {
  const section = cratesIoPatchSection(readFileSync(join(checkout, "Cargo.toml"), "utf8"));
  if (section === null) return "";
  return /^uucore\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"/m.exec(section.body)?.[1] ?? "";
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
 * @param options - the checkout, the vendored directory, and whether this helper owns the current entry.
 * @returns whether the manifest was rewritten.
 */
function pointAtUucore({ checkout, vendorDir, replace, io }) {
  const manifest = join(checkout, "Cargo.toml");
  const text = readFileSync(manifest, "utf8");
  const wanted = `uucore = { path = "${vendorDir.replace(/\\/g, "/")}" }`;
  const section = cratesIoPatchSection(text);
  const declared = section === null ? undefined : /^uucore\s*=[ \t]*\{[^}]*\}[ \t]*$/m.exec(section.body)?.[0];
  if (declared !== undefined) {
    if (declared.trim() === wanted) return false;
    if (replace !== true) {
      throw new Error(`${manifest} already points uucore at ${declared.trim()}; replacing that override is a decision, so it is refused rather than overwritten`);
    }
    writeFileSync(manifest, `${text.slice(0, section.start)}${text.slice(section.start, section.end).replace(declared, wanted)}${text.slice(section.end)}`);
  } else if (section === null) {
    writeFileSync(manifest, `${text.trimEnd()}\n\n[patch.crates-io]\n${wanted}\n`);
  } else {
    writeFileSync(manifest, `${text.slice(0, section.end).trimEnd()}\n${wanted}\n${text.slice(section.end)}`);
  }
  io.log(`patch  ${checkout}: uucore -> ${vendorDir}`);
  return true;
}

/** Where a `uucore` source of this version sits in the cargo source cache, or an empty string. */
function cachedUucoreSource(version, cargoHome) {
  const root = join(cargoHome, "registry", "src");
  if (!existsSync(root)) return "";
  for (const index of readdirSync(root)) {
    const candidate = join(root, index, `uucore-${version}`);
    if (existsSync(join(candidate, "Cargo.toml"))) return candidate;
  }
  return "";
}

/**
 * Copy one registry `uucore` into the build cache and apply the tracked patch to the copy.
 *
 * The copy is rebuilt whenever the recorded version or patch digest differs, so editing the patch takes
 * effect on the next build and a stale copy cannot be mistaken for the patched one.
 * @param options - the version to vendor, the build cache, the repository root and the run/log seam.
 * @returns the vendored directory (the `uucore` crate itself, inside the monorepo-shaped root).
 */
function vendorUucore({ version, checkout, cacheRoot, repoRoot, io }) {
  const patchFile = join(repoRoot, UUCORE_PATCH);
  const digest = createHash("sha256").update(readFileSync(patchFile)).digest("hex");
  const vendorRoot = join(cacheRoot, "vendor", `uucore-${version}`);
  const vendorDir = join(vendorRoot, "src", "uucore");
  const marker = join(vendorRoot, MARKER_FILE);
  const patched = join(vendorDir, ERROR_MODULE);
  if (existsSync(marker)) {
    const recorded = JSON.parse(readFileSync(marker, "utf8"));
    if (recorded.version === version && recorded.patch === digest) {
      if (existsSync(patched) && readFileSync(patched, "utf8").includes(GUARD)) {
        io.log(`reuse  uucore ${version} (patched, ${vendorDir})`);
        return vendorDir;
      }
      io.log(`rebuild uucore ${version}: the recorded copy is incomplete or unpatched`);
    } else {
      io.log(`rebuild uucore ${version}: the record does not match the patch`);
    }
  }
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  let source = cachedUucoreSource(version, cargoHome);
  if (source.length === 0) {
    // A clean machine has the index but not the crate source; `cargo fetch` is what puts it there.
    io.log(`fetch  uucore ${version} is absent from ${join(cargoHome, "registry", "src")}; running cargo fetch`);
    io.run("cargo", ["fetch"], { cwd: checkout });
    source = cachedUucoreSource(version, cargoHome);
  }
  if (source.length === 0) {
    throw new Error(`uucore ${version} is not in the cargo source cache under ${cargoHome} and \`cargo fetch\` did not put it there`);
  }
  rmSync(vendorRoot, { recursive: true, force: true });
  mkdirSync(dirname(vendorDir), { recursive: true });
  cpSync(source, vendorDir, { recursive: true });
  // The utility bundles `uucore`'s build script expects to find beside itself, copied from the same
  // registry directory the crate came from. Not filtered by version: the crates.io fallback embeds every
  // `uu_*` crate it finds there, so this reproduces that set exactly instead of a narrower one.
  let utilities = 0;
  for (const sibling of readdirSync(dirname(source))) {
    const name = /^uu_(.+)-(\d[^-]*)$/.exec(sibling)?.[1];
    if (name === undefined) continue;
    const locales = join(dirname(source), sibling, "locales");
    if (!existsSync(locales)) continue;
    cpSync(locales, join(vendorRoot, "src", "uu", name, "locales"), { recursive: true });
    utilities += 1;
  }
  // The vendored copy is outside any repository, and the patch's own line endings are LF while a checkout
  // may hold CRLF, so the apply must not go through the machine's autocrlf conversion. `--directory`
  // re-roots the patch's paths at the crate's place inside the monorepo-shaped tree.
  io.run("git", ["-c", "core.autocrlf=false", "apply", "--directory=src/uucore", patchFile], { cwd: vendorRoot });
  if (!readFileSync(patched, "utf8").includes(GUARD)) {
    throw new Error(`${vendorDir}: \`git apply\` reported success but ${ERROR_MODULE} does not carry the guard`);
  }
  writeFileSync(marker, `${JSON.stringify({ version, patch: digest, patchFile: UUCORE_PATCH, source, utilities }, null, 2)}\n`);
  io.log(`vendor uucore ${version} -> ${vendorDir} (${UUCORE_PATCH}, ${utilities} utility locale set(s))`);
  return vendorDir;
}

/**
 * Point a checkout at a vendored `uucore`, rebuild the lock entry, and prove it took.
 *
 * An in-repo `uucore` (coreutils carries one) needs nothing: its own patch in `patches/toolchain` edits
 * that copy, and the guard check below still runs against it.
 * @param options - the checkout, the repository root, the build cache, and the run/log seam.
 * @returns the resolved version and the vendored directory (empty for an in-repo `uucore`).
 */
export function applyUucoreOverride({ checkout, repoRoot, cacheRoot, io }) {
  const resolved = resolvedUucore(checkout);
  if (resolved.length === 0) throw new Error(`${checkout}: Cargo.lock resolves no uucore package, so the override has no target`);
  if (resolved.length > 1) {
    throw new Error(
      `${checkout}: Cargo.lock resolves ${resolved.length} uucore versions (${resolved.map((entry) => entry.version).join(", ")}), and one [patch.crates-io] entry cannot serve them all; pin the dependency before building`,
    );
  }
  const entry = resolved[0];
  if (entry.fromPath) {
    const override = declaredUucoreOverride(checkout);
    if (override.length === 0) {
      io.log(`in-repo uucore ${entry.version} in ${checkout} (patched by patches/toolchain)`);
      return { version: entry.version, vendorDir: "" };
    }
    const declared = normalize(override);
    if (!isInside(declared, join(cacheRoot, "vendor"))) {
      // An override that is not this project's own is a decision; its guard is checked below like any other.
      io.log(`reuse  uucore ${entry.version} (patched elsewhere, ${declared})`);
      return { version: entry.version, vendorDir: declared };
    }
    // This project's own copy: re-vendoring is what proves the layout and the patch digest are current, so
    // a cache written by an older layout is rebuilt instead of being trusted because a path exists.
    const vendorDir = vendorUucore({ version: entry.version, checkout, cacheRoot, repoRoot, io });
    if (declared !== vendorDir) {
      // A path dependency carries no path in `Cargo.lock`, so following a layout change needs no lock update.
      pointAtUucore({ checkout, vendorDir, replace: true, io });
    }
    io.log(`verify ${checkout}: uucore ${entry.version} resolves from ${vendorDir}`);
    return { version: entry.version, vendorDir };
  }
  const vendorDir = vendorUucore({ version: entry.version, checkout, cacheRoot, repoRoot, io });
  pointAtUucore({ checkout, vendorDir, replace: false, io });
  // A lock that still names the registry copy means cargo ignored the patch (it only warns), and the
  // build would then produce an engine whose messages are unpatched while everything looks fine.
  const current = resolvedUucore(checkout)[0];
  if (current.fromPath !== true) {
    io.run("cargo", ["update", "-p", "uucore"], { cwd: checkout });
  }
  const settled = resolvedUucore(checkout);
  if (settled.length !== 1 || settled[0].fromPath !== true || settled[0].version !== entry.version) {
    throw new Error(`${checkout}: uucore still resolves as ${settled.map((item) => `${item.version}${item.fromPath ? " (path)" : " (registry)"}`).join(", ")}; the [patch.crates-io] entry was not adopted`);
  }
  io.log(`verify ${checkout}: uucore ${entry.version} resolves from ${vendorDir}`);
  return { version: entry.version, vendorDir };
}

/**
 * Prove the guard is really in the `uucore` this checkout builds against.
 *
 * `applyUucoreOverride` checks the vendored copy it just wrote; this check reads the file the build will
 * compile either way, so the in-repo `coreutils` shape — whose patch comes from `patches/toolchain` — is
 * covered by the same statement.
 * @param options - the checkout, the vendored directory from {@link applyUucoreOverride}, and the log seam.
 * @returns the patched file's path.
 */
export function assertUucoreGuard({ checkout, vendorDir, io }) {
  const inRepo = declaredUucorePath(checkout);
  const file = vendorDir.length > 0 ? join(normalize(vendorDir), ERROR_MODULE) : join(checkout, inRepo, ERROR_MODULE);
  if (!existsSync(file)) throw new Error(`${file} does not exist, so the guard cannot be verified`);
  if (!readFileSync(file, "utf8").includes(GUARD)) {
    throw new Error(`${file} does not keep the OS error code on a refusal; apply ${UUCORE_PATCH} before building`);
  }
  io.log(`guard  ${file}`);
  return file;
}