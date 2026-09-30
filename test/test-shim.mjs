// The names this plugin puts on `PATH` — `bash`, `sh`, and the utilities the engine bundles: what they are
// made of, when they are reused, and what happens when they cannot be made at all.
//
// The rule under test is what turns "there is a `bash` tool" into "there is a bash": a script, a Makefile
// or an npm lifecycle hook calls `bash`, and the name has to resolve to the same verified engine. The
// bundled names matter for the same reason the other way around: a child process cannot exec a builtin, so
// `xargs rm` reaches the engine only through a name on `PATH`. Each case runs against an in-memory
// filesystem, so no 15.7 MB binary is copied to test a link.
import assert from "node:assert/strict";
import { join } from "node:path";
import { SHIM_NAMES, SHELL_NAMES, prepareShellNames, shellNamesDirectory } from "../lib/shim.js";
import { BUILT_IN_UTILITIES } from "../lib/toolchain.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const LOCAL = "C:\\Users\\u\\AppData\\Local";
const ENGINE = "C:\\Users\\u\\.dsh\\profiles\\web\\node_modules\\dsh-bash-native\\engine\\win32-x64\\brush.exe";
const DIGEST = "a".repeat(64);
const DIR = join(LOCAL, "dsh-bash-native", "shim", DIGEST);
const BYTES = 15_699_456;

/** An in-memory filesystem with hard links: sizes only, because that is all the shim compares. */
class MemoryFs {
  constructor(files = new Map()) {
    this.files = files;
    this.links = new Map();
    this.copies = 0;
    this.copySources = [];
    this.linkCalls = 0;
    this.linkFails = () => false;
    this.makeDirectoryThrows = false;
  }
  stat(path) {
    const bytes = this.files.get(path);
    return bytes === undefined ? null : { bytes, mtimeMs: 1 };
  }
  link(from, to) {
    this.linkCalls += 1;
    if (this.linkFails(from)) throw new Error("EXDEV: cross-device link");
    if (!this.files.has(from)) throw new Error(`ENOENT: ${from}`);
    this.files.set(to, this.files.get(from));
    this.links.set(to, from);
  }
  copy(from, to) {
    this.copies += 1;
    this.copySources.push(from);
    this.files.set(to, this.files.get(from));
  }
  makeDirectory() {
    if (this.makeDirectoryThrows) throw new Error("EACCES: the cache directory is not writable");
  }
  /** The file a name stands for, following the chain a set of links forms. */
  origin(path) {
    let at = path;
    while (this.links.has(at)) at = this.links.get(at);
    return at;
  }
}

/** A filesystem holding just the engine, plus any extra paths a case wants. */
function fsWithEngine(extra = []) {
  return new MemoryFs(new Map([[ENGINE, BYTES], ...extra]));
}

const prepare = (fs, options = {}) => prepareShellNames({ engine: ENGINE, sha256: DIGEST, env: { LOCALAPPDATA: LOCAL }, io: fs, ...options });

// 1. Every name is linked to the engine, in a directory the digest names.
{
  const fs = fsWithEngine();
  const dir = prepare(fs);
  assert.equal(dir, DIR, "the directory is content-addressed by the engine's digest");
  assert.equal(fs.linkCalls, SHIM_NAMES.length, "one link per name, and no copy");
  assert.equal(fs.copies, 0);
  for (const name of SHIM_NAMES) {
    assert.equal(fs.links.get(join(DIR, `${name}.exe`)), ENGINE, `${name} is a link to the verified engine`);
  }
  assert.equal(SHIM_NAMES.length, SHELL_NAMES.length + BUILT_IN_UTILITIES.length, "the shell names plus every bundled utility");
  assert.equal(SHIM_NAMES.length, 77, "two shell names and the 75 utilities the engine bundles");
  assert.equal(fs.links.has(join(DIR, "rm.exe")), true, "a bundled utility is reachable by name, not only the shell names");
  pass("every shim name is a hard link to the engine in a digest-named directory");
}

// 2. A directory that already carries every name is reused, which is what keeps the cost at one stat each.
{
  const fs = fsWithEngine(SHIM_NAMES.map((name) => [join(DIR, `${name}.exe`), BYTES]));
  const dir = prepare(fs);
  assert.equal(dir, DIR);
  assert.equal(fs.linkCalls, 0, "an existing set is not relinked");
  assert.equal(fs.copies, 0);
  pass("an existing set of names is reused untouched");
}

// 3. An engine on another volume costs one copy: the first name made is that copy, the rest link to it.
{
  const fs = fsWithEngine();
  fs.linkFails = (from) => from === ENGINE;
  const dir = prepare(fs);
  assert.equal(dir, DIR);
  assert.equal(fs.copies, 1, "one copy of the engine, not one per name");
  assert.equal(fs.copySources[0], ENGINE, "the copy is the one read of the engine");
  assert.equal(fs.linkCalls, SHIM_NAMES.length, "the first link fails on the engine and the rest link to the copy");
  const origins = new Set(SHIM_NAMES.map((name) => fs.origin(join(DIR, `${name}.exe`))));
  assert.deepEqual([...origins], [join(DIR, "bash.exe")], "every name stands for the one copy in the directory");
  assert.equal(fs.files.get(join(DIR, "rm.exe")), BYTES);
  pass("a cross-volume engine is copied once and every other name links to that copy");
}

// 4. A filesystem that cannot link at all still names every command, at the cost of one copy each.
{
  const fs = fsWithEngine();
  fs.linkFails = () => true;
  const dir = prepare(fs);
  assert.equal(dir, DIR);
  assert.equal(fs.copies, SHIM_NAMES.length, "with no link source every name is a copy");
  assert.equal(fs.copySources.filter((from) => from === ENGINE).length, 1, "and only the first copy reads the engine");
  assert.equal(fs.files.get(join(DIR, "bash.exe")), BYTES);
  pass("a filesystem without hard links falls back to copies");
}

// 5. A name left behind with the wrong content is replaced rather than trusted.
{
  const stale = SHIM_NAMES.map((name) => [join(DIR, `${name}.exe`), 0]);
  const fs = fsWithEngine(stale);
  const dir = prepare(fs);
  assert.equal(dir, DIR);
  assert.equal(fs.linkCalls > 0, true, "a name that is not the engine is replaced");
  assert.equal(fs.files.get(join(DIR, "bash.exe")), BYTES);
  pass("a stale name with the wrong size is replaced");
}

// 6. Without LOCALAPPDATA, and without an engine to link, the names are simply not provided.
{
  const fs = fsWithEngine();
  assert.equal(prepare(fs, { env: {} }), "", "no per-user directory means no names");
  assert.equal(shellNamesDirectory({}, DIGEST), null);
  assert.equal(fs.linkCalls, 0);
  assert.equal(prepare(fs, { engine: "C:\\missing\\brush.exe" }), "", "a missing engine cannot be linked");
  assert.equal(fs.linkCalls, 0);
  pass("no per-user directory or no engine means no shell names, and no failure");
}

// 7. A name that cannot be created costs the name and nothing else.
{
  const fs = fsWithEngine();
  fs.makeDirectoryThrows = true;
  assert.equal(prepare(fs), "", "the failure is reported as 'no names' instead of thrown");
  pass("a name that cannot be created is reported instead of thrown");
}

console.log(`\n${passed} 项通过`);
