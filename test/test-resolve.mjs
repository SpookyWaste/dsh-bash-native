import assert from "node:assert/strict";
import { engineEnvValue, resolveEngine } from "../lib/resolve.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const WIN = "win32";
const LINUX = "linux";

function fixture(paths) {
  const set = new Set(paths.map((p) => p.toLowerCase()));
  return { isFile: (p) => set.has(p.toLowerCase()) };
}

function input(overrides = {}) {
  return { bashPath: "", bundledEngineDir: "", packaged: null, ...overrides };
}

/** A verifier that accepts anything, reporting the path as its version. */
const anyEngine = (path) => ({ version: `GNU bash, version 5.3.0(1)-release (test) ${path}`, family: "rubash", refused: null });

/** A verifier that refuses anything whose banner is not rubash, the way the real one does. */
const onlyThisBuild = (path) => ({
  version: `GNU bash, version 5.3.0(1)-release (test) ${path}`,
  family: "rubash",
  refused: path.toLowerCase().includes("rubash") ? null : 'it reports a GNU bash banner and an MSYS `uname -s`, which is not this build',
});

function labels(resolution) {
  return resolution.probed.map((probe) => probe.label);
}

// 1. rubash on PATH resolves with its own version and the bash activation argv.
{
  const fs = fixture(["C:\\tools\\rubash.exe"]);
  const resolution = resolveEngine(input(), { PATH: "C:\\tools;C:\\other" }, WIN, fs, anyEngine);
  assert.equal(resolution.engine.path, "C:\\tools\\rubash.exe");
  assert.equal(resolution.engine.label, "rubash on PATH");
  assert.equal(resolution.engine.version, "GNU bash, version 5.3.0(1)-release (test) C:\\tools\\rubash.exe");
  assert.equal(resolution.engine.family, "rubash", "the family argv construction depends on");
  assert.deepEqual(resolution.engine.args, ["-c"]);
  assert.deepEqual(resolution.engine.interactiveArgs, ["--noprofile", "--norc", "-i"]);
  assert.equal(resolution.failure, null);
  pass("rubash on PATH wins and carries the bash activation argv");
}

// 2. A same-named foreign program is refused, not accepted: the failure says what it reported.
{
  const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
  const fs = fixture([gitBash]);
  const resolution = resolveEngine(input({ bashPath: gitBash }), { PATH: "", ProgramFiles: "C:\\Program Files" }, WIN, fs, onlyThisBuild);
  assert.equal(resolution.engine, null);
  assert.equal(resolution.probed[0].found, true);
  assert.match(resolution.probed[0].refused, /which is not this build/);
  assert.match(resolution.failure, /refused: it reports a GNU bash banner/);
  assert.match(resolution.failure, /dsh-bash-local/, "the remedy names the executor that does drive other shells");
  assert.match(resolution.failure, /couldn't create signal pipe/, "the remedy keeps the reason MSYS cannot be driven here");
  pass("a foreign bash is refused with its own banner and a remedy that names dsh-bash-local");
}

// 3. A configured bashPath is the only probe, and it wins outright.
{
  const fs = fixture(["D:\\eng\\rubash.exe", "C:\\tools\\rubash.exe"]);
  const resolution = resolveEngine(input({ bashPath: "D:\\eng\\rubash.exe" }), { PATH: "C:\\tools" }, WIN, fs, anyEngine);
  assert.equal(resolution.engine.path, "D:\\eng\\rubash.exe");
  assert.deepEqual(labels(resolution), ["configured bashPath"]);
  pass("an explicit bashPath is the only probe");
}

// 4. bashPath is validated: relative fails loud, missing keeps the probe list.
{
  const relative = resolveEngine(input({ bashPath: "eng\\rubash.exe" }), {}, WIN, fixture([]), anyEngine);
  assert.match(relative.failure, /must be an absolute path/);
  const missing = resolveEngine(input({ bashPath: "D:\\eng\\rubash.exe" }), {}, WIN, fixture([]), anyEngine);
  assert.equal(missing.probed[0].found, false);
  assert.match(missing.failure, /configured bashPath: D:\\eng\\rubash\.exe -> missing/);
  pass("bashPath is validated as an absolute, existing path");
}

// 5. Probe order: an explicit path, an explicit directory, the packaged engine, then PATH.
{
  const bundled = "D:\\bundle\\rubash.exe";
  const packaged = "C:\\Users\\u\\AppData\\Local\\dsh-bash-native\\engine\\<sha>\\rubash.exe";
  const onPath = "C:\\tools\\rubash.exe";
  const all = resolveEngine(
    input({ bundledEngineDir: "D:\\bundle", packaged: { ready: packaged } }),
    { PATH: "C:\\tools" },
    WIN,
    fixture([bundled, packaged, onPath]),
    anyEngine,
  );
  assert.equal(all.engine.path, bundled);
  assert.deepEqual(labels(all), ["bundled engine directory"]);
  const shipped = resolveEngine(input({ packaged: { ready: packaged } }), { PATH: "C:\\tools" }, WIN, fixture([packaged, onPath]), anyEngine);
  assert.equal(shipped.engine.path, packaged, "the packaged engine outranks whatever rubash is on PATH");
  assert.deepEqual(labels(shipped), ["packaged engine"]);
  const bare = resolveEngine(input(), { PATH: "C:\\tools" }, WIN, fixture([onPath]), anyEngine);
  assert.equal(bare.engine.label, "rubash on PATH");
  pass("resolution prefers an explicit path and directory, then the packaged engine, then PATH");
}

// 6. A packaged engine that could not be prepared is reported as refused, and PATH is still tried.
{
  const onPath = "C:\\tools\\rubash.exe";
  const resolution = resolveEngine(
    input({ packaged: { refused: "the packaged engine does not match engine.lock.json" } }),
    { PATH: "C:\\tools" },
    WIN,
    fixture([onPath]),
    anyEngine,
  );
  assert.equal(resolution.engine.path, onPath, "the search continues past a refused packaged engine");
  assert.deepEqual(labels(resolution), ["packaged engine", "rubash on PATH"]);
  assert.match(resolution.probed[0].refused, /does not match engine\.lock\.json/);
  assert.equal(resolution.probed[0].found, false);
  pass("a refused packaged engine is reported and does not stop the search");
}
// 7. A bundled directory is also probed under bin/.
{
  const resolution = resolveEngine(input({ bundledEngineDir: "D:\\bundle" }), { PATH: "" }, WIN, fixture(["D:\\bundle\\bin\\rubash.exe"]), anyEngine);
  assert.equal(resolution.engine.path, "D:\\bundle\\bin\\rubash.exe");
  assert.deepEqual(labels(resolution).slice(0, 2), ["bundled engine directory", "bundled engine directory (bin)"]);
  pass("a bundled engine directory is probed as rubash.exe and then bin/rubash.exe");
}

// 8. A total miss enumerates every candidate as missing, then gives the install remedy.
{
  const resolution = resolveEngine(input({ bundledEngineDir: "D:\\bundle" }), { PATH: "" }, WIN, fixture([]), anyEngine);
  assert.equal(resolution.engine, null);
  assert.deepEqual(labels(resolution), [
    "bundled engine directory",
    "bundled engine directory (bin)",
    "rubash on PATH",
  ]);
  assert.ok(resolution.probed.every((probe) => probe.found === false));
  assert.match(resolution.failure, /no usable rubash engine was found/);
  assert.match(resolution.failure, /scripts[\\/]build-engine\.mjs/, "the remedy names the build the verifier accepts");
  assert.doesNotMatch(resolution.failure, /cargo install --locked/, "the remedy never offers a build the verifier refuses");
  pass("a miss enumerates every probe and the install remedy");
}

// 9. A candidate that exists but cannot run is refused rather than accepted.
{
  const refuseAll = () => ({ version: "", refused: "it could not be run: spawn EINVAL" });
  const resolution = resolveEngine(input(), { PATH: "C:\\tools" }, WIN, fixture(["C:\\tools\\rubash.exe"]), refuseAll);
  assert.deepEqual(labels(resolution), ["rubash on PATH"]);
  assert.equal(resolution.probed[0].found, true);
  assert.match(resolution.probed[0].refused, /could not be run/);
  assert.equal(resolution.engine, null);
  pass("a candidate that cannot run is reported as refused rather than accepted");
}

// 10. PATH lookup honors Windows' case-insensitive names, quotes, and extension order.
{
  const fs = fixture(["C:\\Tools\\rubash.exe"]);
  const resolution = resolveEngine(input(), { Path: '  "C:\\Tools" ;C:\\empty' }, WIN, fs, anyEngine);
  assert.equal(resolution.engine.path, "C:\\Tools\\rubash.exe");
  const bare = resolveEngine(input(), { PATH: "C:\\Tools" }, WIN, fixture(["C:\\Tools\\rubash"]), anyEngine);
  assert.equal(bare.engine.path, "C:\\Tools\\rubash", "an extension-less executable still resolves");
  assert.equal(engineEnvValue({ Path: "x" }, "PATH"), "x");
  assert.equal(engineEnvValue({}, "PATH"), undefined);
  pass("PATH lookup is case-insensitive and quote/extension tolerant");
}

// 11. Off Windows the same engine is required, and a system bash is refused.
{
  const rubash = resolveEngine(input(), { PATH: "/usr/local/bin" }, LINUX, fixture(["/usr/local/bin/rubash"]), anyEngine);
  assert.equal(rubash.engine.path, "/usr/local/bin/rubash");
  assert.deepEqual(rubash.engine.args, ["-c"]);
  const systemBash = resolveEngine(input(), { PATH: "" }, LINUX, fixture(["/bin/bash"]), onlyThisBuild);
  assert.equal(systemBash.engine, null, "a system bash is not this plugin's engine");
  assert.match(systemBash.failure, /no candidate resolves on this platform/, "the platform's remedy says why nothing resolves");
  assert.match(systemBash.failure, /dsh-bash-local/, "the platform's remedy names the executor that works there");
  assert.doesNotMatch(systemBash.failure, /cargo install --locked/, "the remedy never offers a build the verifier refuses");
  pass("off Windows the resolver drives rubash and refuses the system bash");
}

console.log(`\n${passed} 项通过`);