import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { preparePackagedEngine } from "../lib/artifact.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const ROOT = "C:\\pkg";
const ARTIFACT = join(ROOT, "engine", "win32-x64", "brush.exe");
const LOCK = join(ROOT, "engine.lock.json");
const LOCAL = "C:\\Users\\u\\AppData\\Local";
const sha = (text) => createHash("sha256").update(text).digest("hex");
const BYTES = "brush 0.4.0 (test engine)";
const DIGEST = sha(BYTES);
const STAMP = join(LOCAL, "dsh-bash-native", "verified", `engine-${DIGEST}.json`);

/**
 * An in-memory filesystem, so these rules are testable without a 16 MB binary.
 *
 * Every write moves a logical clock and stamps the file with it, which is what the real filesystem does
 * with a modification time and what the verification stamp compares; `hashes` counts the reads, because
 * "the second resolution does not read the artifact again" is the property the stamp exists for.
 */
class MemoryFs {
  constructor(files) {
    this.files = new Map(files);
    this.mtimes = new Map([...this.files.keys()].map((path) => [path, 1]));
    this.clock = 1;
    this.hashes = 0;
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
    return value === undefined ? null : { bytes: Buffer.byteLength(value), mtimeMs: this.mtimes.get(path) };
  }
  sha256(path) {
    this.hashes += 1;
    return sha(this.files.get(path) ?? "");
  }
  makeDirectory() {}
  writeText(path, text) {
    this.write(path, text);
  }
  /** Every path this filesystem holds under the per-user directory, for "nothing else was written" checks. */
  perUser() {
    return [...this.files.keys()].filter((path) => path.startsWith(LOCAL));
  }
}

function lockFor({ sha256 = DIGEST, bytes = BYTES.length, path = "engine/win32-x64/brush.exe" } = {}) {
  return JSON.stringify({ version: 1, artifact: { path, sha256, bytes } });
}

function io({ lock = lockFor(), artifact = BYTES } = {}) {
  return new MemoryFs([[LOCK, lock], [ARTIFACT, artifact]]);
}

/** One resolution against the fixed package root and per-user directory. */
const prepare = (fs, options = {}) => preparePackagedEngine({ packageRoot: ROOT, env: { LOCALAPPDATA: LOCAL }, io: fs, ...options });

// 1. A verified artifact runs where the package puts it: nothing is copied anywhere.
{
  const fs = io();
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: ARTIFACT, sha256: DIGEST });
  assert.equal(fs.perUser().length, 1, "the only per-user write is the stamp");
  assert.equal(fs.perUser()[0], STAMP);
  pass("a verified artifact is run where the package puts it, with only a stamp written");
}

// 2. A size mismatch is refused before hashing, and a content mismatch is refused after it.
{
  const short = io({ artifact: BYTES.slice(0, 5) });
  const truncated = prepare(short);
  assert.match(truncated.refused, /not the size engine\.lock\.json records/);
  assert.equal(short.hashes, 0, "the size is checked before the file is read");

  const swapped = io({ artifact: "b".repeat(BYTES.length) });
  const mismatch = prepare(swapped);
  assert.match(mismatch.refused, /does not match engine\.lock\.json/);
  assert.match(mismatch.refused, new RegExp(DIGEST));
  assert.equal(swapped.perUser().length, 0, "a refused artifact leaves no stamp");
  pass("a truncated or substituted artifact is refused, and neither is ever run");
}

// 3. A missing lock, a corrupt lock, a lock without an artifact record, and a malformed digest are
// refused with their own reasons.
{
  const missing = new MemoryFs([[ARTIFACT, BYTES]]);
  assert.match(prepare(missing).refused, /carries no engine\.lock\.json/);
  const corrupt = io({ lock: "{ not json" });
  assert.match(prepare(corrupt).refused, /carries no usable artifact record/);
  const recordless = io({ lock: JSON.stringify({ version: 1 }) });
  assert.match(prepare(recordless).refused, /carries no usable artifact record/);
  const badHash = io({ lock: lockFor({ sha256: "not-a-digest" }) });
  assert.match(prepare(badHash).refused, /carries no usable artifact record/);
  pass("a missing, corrupt, or record-less lock is refused with its own reason");
}

// 4. A packaged artifact that is absent from the install is refused with its path.
{
  const fs = new MemoryFs([[LOCK, lockFor()]]);
  const prepared = prepare(fs);
  assert.match(prepared.refused, /packaged engine is missing/);
  assert.match(prepared.refused, /brush\.exe/);
  pass("a missing artifact is refused with the path it looked at");
}

// 5. The stamp is the only thing that needs the per-user directory, so an install without `LOCALAPPDATA`
// still verifies and runs — it just hashes every time.
{
  const fs = io();
  const first = preparePackagedEngine({ packageRoot: ROOT, env: {}, io: fs });
  assert.deepEqual(first, { ready: ARTIFACT, sha256: DIGEST });
  const hashed = fs.hashes;
  const second = preparePackagedEngine({ packageRoot: ROOT, env: {}, io: fs });
  assert.deepEqual(second, { ready: ARTIFACT, sha256: DIGEST });
  assert.equal(fs.hashes > hashed, true, "without a stamp directory every resolution hashes");
  assert.equal(fs.perUser().length, 0, "and nothing per-user is written");
  pass("an install without LOCALAPPDATA verifies and runs, hashing every time");
}

// 6. The stamp is what removes the repeated hashing: the second resolution reads nothing. `always` puts
// the hashing back.
{
  const fs = io();
  prepare(fs);
  const afterFirst = fs.hashes;
  assert.equal(afterFirst > 0, true, "the first resolution verifies the artifact by hashing it");
  const second = prepare(fs);
  assert.deepEqual(second, { ready: ARTIFACT, sha256: DIGEST });
  assert.equal(fs.hashes, afterFirst, "a stamped resolution hashes nothing");

  const always = io();
  prepare(always);
  const hashesAfterFirst = always.hashes;
  prepare(always, { verify: "always" });
  assert.equal(always.hashes > hashesAfterFirst, true, "`always` re-hashes on every resolution");
  pass("a stamp removes the repeated hashing, and `always` puts it back");
}

// 7. Rewriting the packaged artifact invalidates the stamp, and a same-size rewrite that no longer
// matches the lock is refused instead of trusted.
{
  const fs = io();
  prepare(fs);
  const hashed = fs.hashes;
  fs.write(ARTIFACT, "b".repeat(BYTES.length));
  const stale = prepare(fs);
  assert.equal(fs.hashes > hashed, true, "a rewritten artifact is hashed again");
  assert.match(stale.refused, /does not match engine\.lock\.json/);
  pass("a rewritten artifact invalidates the stamp and is re-verified");
}

// 8. A stamp from the format that described the removed copy is ignored rather than read as a verdict,
// which is what the version bump is for.
{
  const fs = io();
  fs.write(STAMP, JSON.stringify({ version: 1, source: { bytes: BYTES.length, mtimeMs: 1 }, runPath: ARTIFACT, run: { bytes: BYTES.length, mtimeMs: 1 } }));
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: ARTIFACT, sha256: DIGEST });
  assert.equal(fs.hashes > 0, true, "an old-format stamp does not skip the hashing");
  const rewritten = JSON.parse(fs.readText(STAMP));
  assert.equal(rewritten.version, 2, "and it is replaced with the current format");
  assert.equal(rewritten.path, ARTIFACT);
  pass("a stamp from the removed-copy format is ignored and rewritten");
}

// 9. A stamp that names a different file is ignored, so a stamp cannot vouch for a path it was not
// written about.
{
  const fs = io();
  prepare(fs);
  const stamp = JSON.parse(fs.readText(STAMP));
  fs.write(STAMP, JSON.stringify({ ...stamp, path: join(ROOT, "engine", "win32-x64", "other.exe") }));
  const hashed = fs.hashes;
  const prepared = prepare(fs);
  assert.deepEqual(prepared, { ready: ARTIFACT, sha256: DIGEST });
  assert.equal(fs.hashes > hashed, true, "a stamp for another path re-hashes");
  pass("a stamp that names another path does not vouch for this one");
}

console.log(`\n${passed} 项通过`);
