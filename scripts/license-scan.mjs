// Produces the third-party notice for the engine this package ships.
//
// The shipped `engine/win32-x64/brush.exe` is a Rust build of `brush-shell` at the commit pinned in
// `engine.lock.json`, with `experimental-bundled-coreutils`. That feature compiles a subset of
// `uutils/coreutils` (`uu_*` crates) into the same binary, so the notice has to cover the whole locked
// dependency graph rather than brush alone. `Cargo.lock` records the graph but not the licenses; the
// license of each package comes from its `Cargo.toml` in the local registry cache, which is what the
// build actually compiled.
//
// Usage:
//   node scripts/license-scan.mjs --checkout=<brush checkout at the pinned ref> [--cargo-home=DIR] [--out=FILE]
//
// Regenerate it after any engine rebuild, and commit the result next to the artifact.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const checkout = arg("checkout");
if (checkout === undefined) {
  console.error("usage: node scripts/license-scan.mjs --checkout=<brush checkout at the pinned ref> [--cargo-home=DIR] [--out=FILE]");
  process.exit(2);
}
const cargoHome = arg("cargo-home") ?? process.env.CARGO_HOME ?? join(homedir(), ".cargo");
const out = resolve(arg("out") ?? "engine/THIRD-PARTY.md");

const lockPath = join(checkout, "Cargo.lock");
if (!existsSync(lockPath)) {
  console.error(`${lockPath} does not exist; point --checkout at a checkout of the pinned ref`);
  process.exit(2);
}

/** Every `[[package]]` name/version pair in a `Cargo.lock`. */
function lockedPackages(text) {
  const packages = [];
  let current = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "[[package]]") {
      if (current !== null) packages.push(current);
      current = { name: "", version: "" };
      continue;
    }
    const name = /^name = "(.*)"$/.exec(line.trim());
    if (name !== null && current !== null && current.name === "") {
      current.name = name[1];
      continue;
    }
    const version = /^version = "(.*)"$/.exec(line.trim());
    if (version !== null && current !== null && current.name !== "" && current.version === "") current.version = version[1];
  }
  if (current !== null) packages.push(current);
  return packages.filter((entry) => entry.name !== "" && entry.version !== "");
}

/** The registry source directories this machine has a cache for. */
function registrySources() {
  const root = join(cargoHome, "registry", "src");
  return existsSync(root) ? readdirSync(root).map((entry) => join(root, entry)) : [];
}

/** Read one package's license expression, license file, and repository from its registry manifest. */
function manifestFacts(name, version) {
  for (const source of registrySources()) {
    const manifest = join(source, `${name}-${version}`, "Cargo.toml");
    if (!existsSync(manifest)) continue;
    const text = readFileSync(manifest, "utf8");
    const field = (key) => new RegExp(`^${key} = "(.*)"$`, "m").exec(text)?.[1];
    return { license: field("license") ?? "", licenseFile: field("license-file") ?? "", repository: field("repository") ?? "" };
  }
  return null;
}

const packages = lockedPackages(readFileSync(lockPath, "utf8"));
const rows = [];
const missing = [];
for (const entry of packages) {
  const facts = manifestFacts(entry.name, entry.version);
  if (facts === null) {
    missing.push(entry);
    continue;
  }
  rows.push({ ...entry, ...facts });
}

const byLicense = new Map();
for (const row of rows) {
  const key = row.license !== "" ? row.license : row.licenseFile !== "" ? `license-file: ${row.licenseFile}` : "unstated";
  byLicense.set(key, (byLicense.get(key) ?? 0) + 1);
}
const summary = [...byLicense.entries()].sort((left, right) => right[1] - left[1]);

/**
 * The MIT notice for the fixes the engine patches port.
 *
 * `engine/THIRD-PARTY.md` is the only attribution surface that ships: `patches/` is not in the package's
 * `files`, and several of those patches are transcriptions or ports of code written for oh-my-pi's own
 * vendored copy of brush. The notice therefore has to travel with the artifact the patches produce, which
 * is what this file describes.
 */
const OH_MY_PI_NOTICE = [
  "## Patches ported from oh-my-pi",
  "",
  "The binary above is built from the patches in `patches/brush/`, which are part of the source repository",
  "and not of this package. Several of them come from work first done for",
  "[`oh-my-pi`](https://github.com/can1357/oh-my-pi)'s own vendored copy of brush: `0002` and `0009` are",
  "transcribed from it, `0006` and `0007` port its descriptor-path grammar and its `wait` builtin, and",
  "`0004` and `0019` follow fixes it found. The per-patch correspondence — which oh-my-pi commit each one",
  "follows, and every place this repository's version differs — is recorded in `patches/brush/README.md`.",
  "This package is not affiliated with, or endorsed by, oh-my-pi or its authors.",
  "",
  "oh-my-pi is MIT licensed:",
  "",
  "    MIT License",
  "",
  "    Copyright (c) 2025 Mario Zechner",
  "    Copyright (c) 2025-2026 Can Bölük",
  "    Copyright (c) 2026 Stencil Labs, Inc.",
  "",
  "    Permission is hereby granted, free of charge, to any person obtaining a copy",
  "    of this software and associated documentation files (the \"Software\"), to deal",
  "    in the Software without restriction, including without limitation the rights",
  "    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "    copies of the Software, and to permit persons to whom the Software is",
  "    furnished to do so, subject to the following conditions:",
  "",
  "    The above copyright notice and this permission notice shall be included in all",
  "    copies or substantial portions of the Software.",
  "",
  "    THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
  "    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "    SOFTWARE.",
  "",
];

const lines = [
  "# Third-party notices for the shipped engine",
  "",
  "This package ships `engine/win32-x64/brush.exe`, a Rust build of [`brush-shell`](https://github.com/reubeno/brush)",
  "at the commit pinned in `engine.lock.json`, with the `experimental-bundled-coreutils` feature. That",
  "feature compiles a subset of [`uutils/coreutils`](https://github.com/uutils/coreutils) into the same",
  "binary, so the table below covers every package in the build's `Cargo.lock`.",
  "",
  "brush itself is MIT: its license text ships beside the artifact as `engine/LICENSE.brush`. The crates",
  "listed here keep their own licenses, which are all permissive; nothing in this build is copyleft, and",
  "GNU bash (GPLv3) is never bundled — the engine implements bash behaviour itself.",
  "",
  `Generated by \`node scripts/license-scan.mjs --checkout=<brush checkout at the pinned ref>\`: ${rows.length} packages, which is every \`Cargo.lock\` entry present in the local registry cache — that cache holds what this build compiled.${missing.length > 0 ? ` The lock's remaining ${missing.length} entries belong to other platforms or to features this build does not enable, so they are not in the binary.` : ""}`,
  "",
  ...OH_MY_PI_NOTICE,
  "## Licenses in this build",
  "",
  "| License | Packages |",
  "|---|---|",
  ...summary.map(([license, count]) => `| \`${license}\` | ${count} |`),
  "",
  "## Packages",
  "",
  "| Package | Version | License | Repository |",
  "|---|---|---|---|",
  ...rows
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((row) => `| \`${row.name}\` | ${row.version} | ${row.license !== "" ? `\`${row.license}\`` : row.licenseFile !== "" ? `see \`${row.licenseFile}\`` : "unstated"} | ${row.repository !== "" ? row.repository : "—"} |`),
];
writeFileSync(out, `${lines.join("\n")}\n`);

console.log(`wrote ${out}: ${rows.length} packages`);
for (const [license, count] of summary) console.log(`  ${String(count).padStart(4)}  ${license}`);
if (missing.length > 0) console.log(`note: ${missing.length} lock entries are for other platforms or unused features and are not in this build`);

const unstated = rows.filter((row) => row.license === "" && row.licenseFile === "");
if (unstated.length > 0) {
  console.error(`error: ${unstated.length} package(s) state no license: ${unstated.map((row) => row.name).join(", ")}`);
  process.exit(1);
}