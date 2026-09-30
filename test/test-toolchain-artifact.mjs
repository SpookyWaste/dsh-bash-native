// The packaged toolchain: what the install ships, what runs instead, and what is refused.
//
// The rules under test are the ones that decide whether a model gets `grep`, `sed` and `awk` at all, so
// each one is pinned with an in-memory filesystem: verifying every file against the manifest, materializing
// the files outside the package (as hard links when the volume allows it, as copies otherwise), recreating
// the published names as hard links, reusing an intact cache without hashing it again, and refusing a
// package or a cache that does not hash to what the manifest recorded.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseManifest, preparePackagedToolchain } from "../lib/toolchain-artifact.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const ROOT = "C:\\pkg";
const DIR = join(ROOT, "toolchain", "win32-x64");
const MANIFEST = join(DIR, "manifest.json");
const LOCAL = "C:\\Users\\u\\AppData\\Local";
const sha = (text) => createHash("sha256").update(text).digest("hex");

const GREP = "grep 0.2.0 (test)";
const COREUTILS = "coreutils 0.12.0 (test)";
const FILES = [
  { file: "grep.exe", content: GREP, component: "grep", version: "0.2.0", names: ["grep"] },
  { file: "coreutils.exe", content: COREUTILS, component: "coreutils", version: "0.12.0", names: ["cat", "ls", "rm"] },
];

/** The manifest text the package would carry, built from {@link FILES}. */
function manifestText(entries = FILES) {
  return `${JSON.stringify(
    {
      version: 1,
      target: "x86_64-pc-windows-msvc",
      files: entries.map((entry) => ({
        file: entry.file,
        sha256: sha(entry.content),
        bytes: Buffer.byteLength(entry.content),
        component: entry.component,
        version: entry.version,
        license: "MIT",
        source: `https://example.invalid/${entry.component}`,
        names: entry.names,
      })),
    },
    null,
    2,
  )}\n`;
}

const DIGEST = sha(manifestText());
const CACHE = join(LOCAL, "dsh-bash-native", "toolchain", DIGEST);
const BIN = join(CACHE, "bin");
const MARKER = join(CACHE, ".manifest-sha256");
const STAMP = join(LOCAL, "dsh-bash-native", "verified", `toolchain-${DIGEST}.json`);

/**
 * An in-memory filesystem with hard links, so these rules run without 40 MB of binaries.
 *
 * Every write moves a logical clock and stamps the file with it, which is what the real filesystem does with
 * a modification time and what a verification stamp compares; `hashes` counts the reads, because "the
 * second resolution reads neither the package nor the cache again" is the property the stamp exists for.
 */
class MemoryFs {
  constructor(files) {
    this.files = new Map(files);
    this.mtimes = new Map([...this.files.keys()].map((path) => [path, 1]));
    this.clock = 1;
    this.links = new Map();
    this.copies = 0;
    this.linkCalls = 0;
    this.hashes = 0;
    this.copyThrows = false;
    this.linkThrows = false;
  }
  /** Record a file's content and give it a fresh modification time. */
  write(path, value) {
    this.clock += 1;
    this.files.set(path, value);
    this.mtimes.set(path, this.clock);
  }
  isFile(path) {
    return this.files.has(path);
  }
  readText(path) {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }
  stat(path) {
    const value = this.files.get(path);
    return value === undefined ? null : { bytes: Buffer.byteLength(value), mtimeMs: this.mtimes.get(path) ?? 0 };
  }
  sha256(path) {
    this.hashes += 1;
    return sha(this.files.get(path) ?? "");
  }
  copy(from, to) {
    if (this.copyThrows) throw new Error("EACCES: the cache directory is not writable");
    this.copies += 1;
    this.write(to, this.files.get(from));
  }
  link(from, to) {
    this.linkCalls += 1;
    if (this.linkThrows) throw new Error("EPERM: this filesystem has no hard links");
    // A link's content is the target's content, which is what makes one file many names.
    if (!this.files.has(from)) throw new Error(`ENOENT: ${from}`);
    this.write(to, this.files.get(from));
    this.links.set(to, from);
  }
  writeText(path, text) {
    this.write(path, text);
  }
  makeDirectory() {}
  remove(path) {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}\\`)) {
        this.files.delete(key);
        this.mtimes.delete(key);
      }
    }
    for (const key of [...this.links.keys()]) {
      if (key === path || key.startsWith(`${path}\\`)) this.links.delete(key);
    }
  }
  names(path) {
    const prefix = `${path}\\`;
    const found = new Set();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest.includes("\\")) found.add(rest);
    }
    return found.size === 0 ? null : [...found];
  }
}

/** A package holding the manifest and every file it names, plus any extra paths a case wants. */
function packaged({ entries = FILES, extra = [], manifest = manifestText(entries) } = {}) {
  return new MemoryFs([
    [MANIFEST, manifest],
    ...entries.map((entry) => [join(DIR, entry.file), entry.content]),
    ...extra,
  ]);
}

/**
 * A package plus a cache a previous run built: the marker, the files, and every published name.
 *
 * The package is always part of the filesystem, because it is verified before the cache is consulted — a
 * cache can never make a tampered package run.
 */
function withCache(entries = FILES, { marker = DIGEST, dropName = null, mutate = null } = {}) {
  const fs = packaged({ entries });
  for (const entry of entries) {
    fs.write(join(CACHE, entry.file), entry.content);
    for (const name of entry.names) {
      if (name === dropName) continue;
      fs.write(join(BIN, `${name}.exe`), entry.content);
      fs.links.set(join(BIN, `${name}.exe`), join(CACHE, entry.file));
    }
  }
  if (mutate !== null) fs.write(join(CACHE, mutate.file), mutate.content);
  if (marker !== null) fs.write(MARKER, marker);
  return fs;
}

/** One resolution against the fixed package root and per-user directory. */
const prepare = (fs, options = {}) =>
  preparePackagedToolchain({ packageRoot: ROOT, env: { LOCALAPPDATA: LOCAL }, io: fs, ...options });

// 1. Every file is verified, materialized outside the package, and the published names are created there.
{
  const fs = packaged();
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.copies, 0, "the files are linked, one per packaged file and not one per name");
  for (const entry of FILES) assert.equal(fs.files.get(join(CACHE, entry.file)), entry.content);
  for (const entry of FILES) {
    for (const name of entry.names) {
      assert.equal(fs.files.get(join(BIN, `${name}.exe`)), entry.content, `${name} is published`);
    }
  }
  assert.equal(fs.files.get(MARKER), DIGEST, "the cache records which manifest it was built from");
  pass("the packaged toolchain is verified, materialized, and its names are published");
}

// 2. A cache built from this manifest, with every name present, is reused without copying again.
{
  const fs = withCache();
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.copies, 0, "an intact cache is not rewritten");
  assert.equal(fs.linkCalls, 0, "an intact cache does not relink");
  pass("an intact cache is reused untouched");
}

// 3. A cache with no marker is rebuilt: a directory that only looks like a cache proves nothing.
{
  const fs = withCache(FILES, { marker: null });
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.files.get(join(CACHE, FILES[0].file)), FILES[0].content, "a cache without a marker is rebuilt");
  pass("a cache that records no manifest is rebuilt");
}

// 4. A cache built from another manifest is rebuilt rather than mixed with this one.
{
  const fs = withCache(FILES, { marker: sha("another manifest") });
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.files.get(MARKER), DIGEST);
  assert.equal(fs.links.get(join(CACHE, FILES[0].file)), join(DIR, FILES[0].file), "the replacement is linked from the package again");
  pass("a cache from another manifest is replaced");
}

// 5. A cached file whose content changed, and a cache missing one published name, are both rebuilt.
{
  const tampered = withCache(FILES, { mutate: { file: "grep.exe", content: "a substituted grep" } });
  const first = prepare(tampered);
  assert.deepEqual(first, { ready: BIN });
  assert.equal(tampered.files.get(join(CACHE, "grep.exe")), GREP, "the substituted cache file is replaced");

  const incomplete = withCache(FILES, { dropName: "ls" });
  const second = prepare(incomplete);
  assert.deepEqual(second, { ready: BIN });
  assert.equal(incomplete.files.get(join(BIN, "ls.exe")), COREUTILS, "the missing name is published again");
  pass("a changed cache file and a missing name are both rebuilt");
}

// 6. A package whose file does not hash to the manifest is refused, and nothing is copied.
{
  const entries = [...FILES];
  const fs = packaged({ entries });
  // Same size, different bytes: only the hash can tell this apart, which is what hashing is for.
  fs.write(join(DIR, "grep.exe"), "b".repeat(Buffer.byteLength(GREP)));
  const prepared = prepare(fs);
  assert.match(prepared.refused, /packaged grep\.exe does not match the manifest/);
  assert.match(prepared.refused, new RegExp(sha(GREP)));
  assert.equal(fs.copies, 0, "a refused package is never copied");
  pass("a packaged file that does not hash to the manifest is refused");
}

// 7. A wrong size is refused before hashing, and a missing file is refused with its path.
{
  const fs = packaged();
  fs.write(join(DIR, "grep.exe"), GREP.slice(0, 4));
  assert.match(prepare(fs).refused, /packaged grep\.exe is not the size the manifest records/);

  const absent = packaged();
  absent.files.delete(join(DIR, "coreutils.exe"));
  const prepared = prepare(absent);
  assert.match(prepared.refused, /packaged toolchain is missing coreutils\.exe/);
  assert.match(prepared.refused, /coreutils\.exe/);
  pass("a wrong size and a missing file are refused with their own reason");
}

// 8. A missing or unusable manifest is refused with the path it looked at.
{
  const absent = new MemoryFs([]);
  assert.match(prepare(absent).refused, /carries no packaged toolchain/);
  const corrupt = packaged({ manifest: "{ not json" });
  assert.match(prepare(corrupt).refused, /manifest is unusable/);
  pass("a missing or unusable manifest is refused with its path");
}

// 9. The farm is a `PATH` directory and belongs in per-user state, so an install without `LOCALAPPDATA`
// is refused rather than probed from the package.
{
  const fs = packaged();
  const prepared = preparePackagedToolchain({ packageRoot: ROOT, env: {}, io: fs });
  assert.match(prepared.refused, /LOCALAPPDATA is not set/);
  assert.equal(fs.copies, 0);
  pass("an install without LOCALAPPDATA is refused rather than probed from the package");
}

// 10. A cache that cannot be written is refused, and the packaged files are not probed from where they lie.
{
  const fs = packaged();
  fs.linkThrows = true;
  fs.copyThrows = true;
  const prepared = prepare(fs);
  assert.match(prepared.refused, /could not be cached under/);
  assert.equal(fs.files.has(join(CACHE, "grep.exe")), false);
  pass("a failed cache write is refused rather than falling back to the package's own files");
}

// 11. A filesystem without hard links publishes names as copies, so the toolchain still works.
{
  const fs = packaged();
  fs.linkThrows = true;
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.files.get(join(BIN, "cat.exe")), COREUTILS, "the name is published even without links");
  assert.equal(fs.copies, FILES.length + 4, "the four names cost four copies on such a filesystem");
  pass("a filesystem without hard links falls back to copies");
}

// 12. The manifest parser rejects a record that could describe an unusable package.
{
  const valid = JSON.parse(manifestText());
  assert.equal(parseManifest(manifestText()).files.length, 2);
  const rejects = [
    { files: [] },
    { files: "two" },
    { files: [{ ...valid.files[0], file: "..\\escape.exe" }] },
    { files: [{ ...valid.files[0], sha256: "not-a-digest" }] },
    { files: [{ ...valid.files[0], bytes: 0 }] },
    { files: [{ ...valid.files[0], component: "" }] },
    { files: [{ ...valid.files[0], names: [] }] },
    { files: [{ ...valid.files[0], names: [7] }] },
  ];
  for (const manifest of rejects) {
    assert.equal(parseManifest(JSON.stringify(manifest)), null, `${JSON.stringify(manifest).slice(0, 60)} is refused`);
  }
  assert.equal(parseManifest("{ not json"), null);
  pass("a manifest that cannot describe a usable package is refused");
}

// 13. The packaged files are linked into the cache rather than copied, which is what makes the farm cost
// 15 links instead of 38 MB.
{
  const fs = packaged();
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.copies, 0, "no packaged file is copied");
  for (const entry of FILES) {
    assert.equal(fs.links.get(join(CACHE, entry.file)), join(DIR, entry.file), `${entry.file} is a link to the package's`);
  }
  for (const entry of FILES) {
    for (const name of entry.names) assert.equal(fs.files.get(join(BIN, `${name}.exe`)), entry.content);
  }
  pass("the packaged files are linked into the cache instead of copied");
}

// 14. A cross-volume or link-less filesystem still gets a working toolchain: linking that fails falls back
// to copying.
{
  const fs = packaged();
  fs.linkThrows = true;
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.copies, FILES.length + 4, "the link failures fall back to copies");
  pass("linking that fails falls back to copying");
}

// 15. The stamp is what removes the repeated hashing: the second resolution reads nothing from either side.
{
  const fs = withCache();
  prepare(fs);
  const afterFirst = fs.hashes;
  assert.equal(afterFirst > 0, true, "the first resolution verifies the package and the cache by hashing");
  const second = prepare(fs);
  assert.deepEqual(second, { ready: BIN });
  assert.equal(fs.hashes, afterFirst, "a stamped resolution hashes nothing");
  assert.equal(fs.copies, 0, "and copies nothing either");
  assert.equal(fs.files.has(STAMP), true, "the verdict is stamped");

  const always = withCache();
  prepare(always);
  const beforeAlways = always.hashes;
  prepare(always, { verify: "always" });
  assert.equal(always.hashes > beforeAlways, true, "`always` re-hashes on every resolution");
  pass("a stamp removes the repeated hashing, and `always` puts it back");
}

// 16. Rewriting a packaged file invalidates the stamp, and a same-size rewrite that no longer matches the
// manifest is refused instead of trusted.
{
  const fs = withCache();
  prepare(fs);
  const hashed = fs.hashes;
  fs.write(join(DIR, "grep.exe"), "b".repeat(Buffer.byteLength(GREP)));
  const stale = prepare(fs);
  assert.equal(fs.hashes > hashed, true, "a rewritten packaged file is hashed again");
  assert.match(stale.refused, /does not match the manifest/);
  pass("a rewritten packaged file invalidates the stamp and is re-verified");
}

// 17. A cache file that changed under the stamp is re-verified and rebuilt.
{
  const fs = withCache();
  prepare(fs);
  fs.write(join(CACHE, "grep.exe"), "a substituted grep");
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: BIN });
  assert.equal(fs.files.get(join(CACHE, "grep.exe")), GREP, "the substituted cache file is replaced");
  pass("a cache file that changed under the stamp is re-verified and rebuilt");
}

console.log(`\n${passed} 项通过`);
