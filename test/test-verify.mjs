import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { argumentSignature, captureStdio, readBrushVersion } from "../lib/verify.js";
import { packageRoot, preparePackagedEngine } from "../lib/artifact.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const PATCHED = ["tmp=0", "builtin"];
const UNPATCHED = ["tmp=1", "file"];
const ARGUMENT = "Q:\\x";
const UNREWRITTEN = "/q/x";

/**
 * A spawn seam that answers by argument, the way the real one does: `--version` gets the banner, the
 * shell-side signature gets its two facts, and the argument-side signature gets what the child printed.
 */
const answers = (banner, signature = PATCHED, argument = ARGUMENT, failure = null) => (_path, args) => {
  if (failure !== null) return { line: "", failure };
  if (args[0] === "--version") return { line: banner, failure: null };
  if (args[1].includes("console.log")) return { line: `${argument}\n`, failure: null };
  return { line: `${signature.join("\n")}\n`, failure: null };
};

// 1. A brush banner plus every patched behaviour is accepted, and the version is kept.
{
  const verdict = readBrushVersion("C:\\eng\\brush.exe", answers("brush 0.4.0 (git:08db87a6-modified)\n"));
  assert.equal(verdict.refused, null);
  assert.equal(verdict.version, "brush 0.4.0 (git:08db87a6-modified)");
  pass("a brush banner plus the build signature is accepted and the version is retained");
}

// 2. An unpatched upstream brush is refused, with every fact that did not hold named.
{
  const verdict = readBrushVersion("C:\\eng\\brush.exe", answers("brush 0.4.0\n", UNPATCHED, UNREWRITTEN));
  assert.equal(verdict.version, "");
  assert.match(verdict.refused, /not the build this contract describes/);
  assert.match(verdict.refused, /tmp=0 and builtin and the argument Q:\\x did not hold/);
  assert.match(verdict.refused, /engine\.lock\.json/);
  pass("an unpatched brush build is refused with the facts that did not hold");
}

// 3. A build missing only the argument rewrite — the shape a pre-drive-mount build has — is refused too.
{
  const verdict = readBrushVersion("C:\\eng\\brush.exe", answers("brush 0.4.0\n", PATCHED, UNREWRITTEN));
  assert.match(verdict.refused, /the argument Q:\\x did not hold/);
  assert.doesNotMatch(verdict.refused, /tmp=0/);
  pass("a build without the drive-mount rewrite is refused for that fact alone");
}

// 4. Either shell-side behaviour missing is enough to refuse, and the reason names that one.
{
  const half = readBrushVersion("C:\\eng\\brush.exe", answers("brush 0.4.0\n", ["tmp=0", "file"]));
  assert.match(half.refused, /builtin did not hold/);
  const other = readBrushVersion("C:\\eng\\brush.exe", answers("brush 0.4.0\n", ["tmp=1", "builtin"]));
  assert.match(other.refused, /tmp=0 did not hold/);
  pass("either missing behaviour refuses the candidate and is named");
}

// 5. A foreign shell's banner is refused, and the refusal quotes it.
{
  const verdict = readBrushVersion("C:\\Program Files\\Git\\bin\\bash.exe", answers("GNU bash, version 5.3.15(1)-release (x86_64-pc-msys)\n"));
  assert.match(verdict.refused, /which is not brush/);
  assert.match(verdict.refused, /GNU bash, version 5\.3\.15/);
  pass("a foreign banner is refused and quoted back");
}

// 6. A binary that cannot run, and one that prints nothing, are refused with different reasons.
{
  const failed = readBrushVersion("D:\\eng\\brush.exe", answers("", PATCHED, ARGUMENT, "it could not be run: spawn EINVAL"));
  assert.match(failed.refused, /could not be run/);
  const silent = readBrushVersion("D:\\eng\\brush.exe", answers("\n"));
  assert.equal(silent.refused, "it reported no version");
  pass("a run failure and an empty banner are refused differently");
}

// 7. Only the leading token may identify the engine, and a signature that cannot be read is refused.
{
  const wrapper = readBrushVersion("D:\\eng\\wrapper.exe", answers("Windows bash wrapper for brush 0.4.0\n"));
  assert.match(wrapper.refused, /which is not brush/);
  const leading = readBrushVersion("D:\\eng\\brush.exe", answers("Brush 0.4.0\n"));
  assert.equal(leading.refused, null, "the comparison is case-insensitive");
  const unaskable = readBrushVersion("D:\\eng\\brush.exe", (path, args) =>
    args[0] === "--version" ? { line: "brush 0.4.0\n", failure: null } : { line: "", failure: "it could not be run: ETIMEDOUT" },
  );
  assert.match(unaskable.refused, /is brush but could not be asked/);
  pass("the engine name has to lead the banner, and an unreadable signature is refused");
}

// 8. The argument signature quotes the Node path, so a path with spaces or a quote cannot break it.
{
  assert.equal(
    argumentSignature("C:\\Program Files\\nodejs\\node.exe"),
    "'C:\\Program Files\\nodejs\\node.exe' -e 'console.log(process.argv[1])' /q/x",
  );
  assert.match(argumentSignature("C:\\odd'name\\node.exe"), /^'C:\\odd'\\''name\\node\.exe' -e /);
  pass("the argument signature single-quotes the Node path and escapes a quote");
}

// 9. The verifier must never ask for pipes: a child launched under the harness's restricted token
// cannot open one, and the resulting EPERM would refuse the engine this package ships.
{
  const directory = mkdtempSync(join(tmpdir(), "dsh-verify-stdio-"));
  try {
    const stdoutPath = join(directory, "stdout.txt");
    const stderrPath = join(directory, "stderr.txt");
    const capture = captureStdio(stdoutPath, stderrPath);
    assert.deepEqual(capture.stdio[0], "ignore");
    assert.equal(typeof capture.stdio[1], "number");
    assert.equal(typeof capture.stdio[2], "number");
    assert.equal(
      capture.stdio.some((entry) => entry === "pipe"),
      false,
      "a pipe is what a confined child cannot open",
    );
    const result = spawnSync(process.execPath, ["-e", "console.log('captured')"], { stdio: capture.stdio });
    capture.close();
    assert.equal(result.error, undefined);
    assert.equal(readFileSync(stdoutPath, "utf8").trim(), "captured");
    assert.equal(readFileSync(stderrPath, "utf8"), "");
    pass("the verifier's stdio captures output through files and never through pipes");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// 10. The production spawn is exercised against the artifact the package ships, so a broken build or a
// broken verifier fails here instead of being reported as "no engine".
{
  const packaged = preparePackagedEngine({ packageRoot: packageRoot(), env: process.env });
  assert.equal("ready" in packaged, true, `the shipped engine is not ready: ${packaged.refused ?? "unknown"}`);
  const verdict = readBrushVersion(packaged.ready);
  assert.equal(verdict.refused, null);
  assert.match(verdict.version, /^brush\b/i);
  pass("the production spawn verifies the shipped artifact end to end");
}

console.log(`\n${passed} 项通过`);