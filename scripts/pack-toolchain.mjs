// Packages the toolchain this repository builds, so an install works without Rust or Go.
//
// `scripts/build-toolchain.mjs` publishes 104 names out of 15 distinct binaries, because a multi-call
// binary answers to every name it is asked by. Copying that directory into the package would store the
// same bytes 104 times, so the packaged form keeps the files once and records the mapping in a manifest:
// `toolchain/win32-x64/<file>.exe` plus `manifest.json`, which names every command each file provides.
// `src/toolchain-artifact.ts` verifies the files against that manifest, copies them outside the DSH
// workspace and recreates the published names there as hard links.
//
// The component each file belongs to is read from the install's own `build-state.json`, because the
// applet list a multi-call binary answers to is the install's fact; this script groups by file identity
// (NTFS reports the same index for every hard link) and only decides the packaged file names.
//
// Usage:
//   node scripts/pack-toolchain.mjs                 package the installed toolchain into this repository
//   node scripts/pack-toolchain.mjs --dir=<bin>     package another install
//   node scripts/pack-toolchain.mjs --out=<dir>     write somewhere else (for a dry run)
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(join(REPO_ROOT, "toolchain.lock.json"), "utf8"));

const dirArg = process.argv.find((arg) => arg.startsWith("--dir="));
const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const localAppData = process.env.LOCALAPPDATA ?? "";
const toolsDir = dirArg !== undefined ? dirArg.slice("--dir=".length) : (process.env.DSH_BASH_NATIVE_TOOLS ?? join(localAppData, "dsh-bash-native", "tools", "bin"));
const outDir = outArg !== undefined ? outArg.slice("--out=".length) : join(REPO_ROOT, "toolchain", "win32-x64");

if (toolsDir.length === 0) {
  console.error("--dir= (or LOCALAPPDATA / DSH_BASH_NATIVE_TOOLS) must name the installed toolchain's bin directory");
  process.exit(2);
}
if (!existsSync(toolsDir)) {
  console.error(`${toolsDir} does not exist; run \`node scripts/build-toolchain.mjs\` first`);
  process.exit(2);
}

/** @param path - an existing file. @returns its lowercase SHA-256 hex digest. */
function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Which component published each name.
 *
 * A component that predates the recorded name list (a stale entry from an earlier run) is reported and
 * skipped: it cannot own a name in the install, and the coverage check below is what proves nothing is
 * missing.
 */
const statePath = join(dirname(toolsDir), "build-state.json");
if (!existsSync(statePath)) {
  console.error(`${statePath} is missing, so no install is recorded there; run \`node scripts/build-toolchain.mjs\` first`);
  process.exit(2);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));
const owner = new Map();
const stale = [];
for (const component of Object.values(state.components)) {
  if (!Array.isArray(component.names)) {
    stale.push(component.name);
    continue;
  }
  for (const name of component.names) owner.set(name, component);
}
if (stale.length > 0) console.log(`note   ignoring ${stale.length} component record(s) with no name list: ${stale.join(", ")}`);

const published = readdirSync(toolsDir)
  .filter((name) => name.toLowerCase().endsWith(".exe"))
  .map((name) => name.slice(0, -".exe".length))
  .sort();
if (published.length === 0) {
  console.error(`${toolsDir} holds no executables; run \`node scripts/build-toolchain.mjs\` first`);
  process.exit(2);
}
const uncovered = published.filter((name) => !owner.has(name));
if (uncovered.length > 0) {
  console.error(
    `${statePath} accounts for no component of ${uncovered.join(", ")}; the recorded install and the directory disagree, so run \`node scripts/build-toolchain.mjs\` to rebuild the record`,
  );
  process.exit(2);
}

/**
 * Group the published names by the file behind them.
 *
 * NTFS reports one file index for every hard link, so the index plus the size identifies a file across all
 * of its names, and the hash is computed once per file rather than once per name.
 */
const groups = new Map();
for (const name of published) {
  const path = join(toolsDir, `${name}.exe`);
  const stats = statSync(path);
  const key = `${stats.ino}:${stats.size}`;
  let group = groups.get(key);
  if (group === undefined) groups.set(key, (group = { sha256: sha256(path), bytes: stats.size, names: [] }));
  group.names.push(name);
}
for (const group of groups.values()) {
  const components = new Set(group.names.map((name) => owner.get(name).name));
  if (components.size !== 1) {
    throw new Error(`${group.names.join(", ")} come from several components (${[...components].join(", ")}), so the manifest cannot attribute their file`);
  }
  group.component = owner.get(group.names[0]);
  // One name means the file is that command; several mean it is a multi-call binary, named after the
  // component that builds it (`coreutils.exe` behind 90 names).
  group.file = group.names.length === 1 ? `${group.names[0]}.exe` : `${group.component.name}.exe`;
}
const files = [...groups.values()].sort((left, right) => left.file.localeCompare(right.file));
const used = new Set(files.map((entry) => entry.file));
if (used.size !== files.length) throw new Error("two packaged files want the same name");

console.log(`pack   ${published.length} name(s) in ${files.length} file(s) from ${toolsDir}`);

// The package holds the files once and the manifest that says what they provide. No timestamp: the
// manifest's digest names the runtime cache, so an unchanged toolchain must package identically.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const manifest = {
  version: 1,
  target: lock.target,
  files: files.map((entry) => ({
    file: entry.file,
    sha256: entry.sha256,
    bytes: entry.bytes,
    component: entry.component.name,
    version: entry.component.version,
    license: entry.component.license,
    source: entry.component.source,
    names: [...entry.names].sort(),
  })),
};
for (const entry of files) {
  copyFileSync(join(toolsDir, entry.names[0] + ".exe"), join(outDir, entry.file));
  if (sha256(join(outDir, entry.file)) !== entry.sha256) throw new Error(`${entry.file} did not copy intact into ${outDir}`);
  console.log(`file   ${entry.file} (${entry.bytes} bytes, ${entry.names.length} name(s): ${entry.component.name} ${entry.component.version})`);
}
writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// The licence texts travel with the binaries they cover, and `THIRD-PARTY.md` is the human-readable index.
const licenseSource = join(dirname(toolsDir), "LICENSES");
const licenseDir = join(REPO_ROOT, "toolchain", "LICENSES");
rmSync(licenseDir, { recursive: true, force: true });
mkdirSync(licenseDir, { recursive: true });
const components = [...new Map(files.map((entry) => [entry.component.name, entry.component])).values()].sort((left, right) =>
  left.name.localeCompare(right.name),
);
const missingLicenses = [];
for (const component of components) {
  const from = join(licenseSource, `${component.name}.txt`);
  if (!existsSync(from)) {
    missingLicenses.push(component.name);
    continue;
  }
  copyFileSync(from, join(licenseDir, `${component.name}.txt`));
}
if (missingLicenses.length > 0) {
  console.error(`no licence text was installed for ${missingLicenses.join(", ")} (looked in ${licenseSource}); run \`node scripts/build-toolchain.mjs\` to fetch them`);
  process.exit(2);
}
const thirdParty = [
  "# Third-party licences: the packaged POSIX toolchain",
  "",
  "`toolchain/win32-x64/` ships the toolchain this project builds, so an install needs neither Rust nor Go.",
  "Every file is unmodified from the component below, and `manifest.json` records each file's sha256, size",
  "and the command names it publishes; `src/toolchain-artifact.ts` verifies those hashes before the files run.",
  "",
  "| Component | Version | Licence | Source | Files | Names |",
  "| --- | --- | --- | --- | --- | --- |",
  ...components.map((component) => {
    const owned = files.filter((entry) => entry.component.name === component.name);
    const names = owned.reduce((total, entry) => total + entry.names.length, 0);
    return `| \`${component.name}\` | ${component.version} | ${component.license} | ${component.source} | ${owned.map((entry) => `\`${entry.file}\``).join(", ")} | ${names} |`;
  }),
  "",
  "GNU bash is **not** part of this package: it is GPLv3 and is only ever invoked as an external program.",
  "The engine this bundle ships has its own record in `engine/THIRD-PARTY.md` and `engine/LICENSE.brush`.",
  "",
  `Rebuild and repackage with \`node scripts/build-toolchain.mjs\` followed by \`node scripts/pack-toolchain.mjs\`.`,
  "",
].join("\n");
writeFileSync(join(REPO_ROOT, "toolchain", "THIRD-PARTY.md"), thirdParty);

// The lock records what was packaged, the way `engine.lock.json` records the engine: a reader can tell
// which install the shipped bytes came from without unpacking them.
const manifestPath = join(outDir, "manifest.json");
const manifestBytes = readFileSync(manifestPath);
lock.packaged = {
  path: "toolchain/win32-x64/manifest.json",
  sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  bytes: manifestBytes.length,
  files: files.length,
  names: published.length,
  bytesTotal: files.reduce((total, entry) => total + entry.bytes, 0),
};
writeFileSync(join(REPO_ROOT, "toolchain.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);

console.log(`\nmanifest ${manifestPath}`);
console.log(`sha256   ${lock.packaged.sha256}`);
console.log(`files    ${lock.packaged.files} (${lock.packaged.bytesTotal} bytes) publishing ${lock.packaged.names} names`);
console.log(`licences ${licenseDir} and ${join(REPO_ROOT, "toolchain", "THIRD-PARTY.md")}`);
console.log(`lock     toolchain.lock.json records the packaged manifest`);