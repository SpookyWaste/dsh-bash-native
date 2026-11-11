// `du` on Windows used to open every path twice: `Stat::new` asks for the file id and the
// allocation through two separate `CreateFile` calls, so a cold tree cost two opens (and, with an
// on-access scanner, two scans) per file. The Windows build now walks a directory through
// `GetFileInformationByHandleAsync`-style enumeration — one directory handle per directory —
// and falls back to the per-entry path only where the enumeration cannot describe an entry.
//
// This suite pins what that optimization may not change: the enumeration and the per-entry
// traversal (`--legacy-walk`) must produce identical output for every option the traversal
// feeds, hard links must still be counted once, and the enumeration must actually be the faster
// path. Exact sizes are asserted separately, so a bug that makes both traversals agree on a
// wrong number still fails.
//
// Skipped unless a Windows toolchain and an engine are installed.
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRunner, findEngine, pathWithToolchain, toolsDirectory } from "../scripts/engine-harness.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const dir = toolsDirectory([], process.env);
const engine = dir.length > 0 && existsSync(dir) ? findEngine() : null;
if (process.platform !== "win32" || dir.length === 0 || !existsSync(dir) || engine === null) {
  console.log("SKIP  no Windows toolchain and engine installed to run du");
} else {
  const scratch = mkdtempSync(join(tmpdir(), "dsh-bash-native-du-"));
  const run = createRunner(engine, scratch);
  const env = { ...process.env, PATH: pathWithToolchain({ withTools: true, toolsDir: dir, engine, basePath: process.env.PATH ?? "" }) };

  /** Run one `du` invocation; line endings are normalized so the two traversals compare directly. */
  const du = (args) => {
    const result = run(`du ${args}`, { cwd: scratch, env });
    return { status: result.status, stdout: result.stdout.replace(/\r\n/g, "\n"), stderr: result.stderr.replace(/\r\n/g, "\n") };
  };

  /** Run both traversals on one argument list and require the same status and output. */
  const same = (label, args) => {
    const fast = du(args);
    const legacy = du(`--legacy-walk ${args}`);
    assert.deepEqual(fast, legacy, `${label}: the enumeration and the per-entry traversal disagree`);
    pass(label);
    return fast;
  };

  // 1. Fixtures. `flat` pins exact apparent sizes and hard-link deduplication, `tree` covers what
  //    the enumeration hands back to the per-entry path (a junction), plus subdirectories, empty
  //    directories, non-ASCII names and a deep path.
  const base = join(scratch, "fixtures");
  const writeFile = (relative, content) => {
    const path = join(base, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  };

  writeFile("flat/one.txt", "a".repeat(1000));
  writeFile("flat/two.txt", "b".repeat(2000));
  writeFile("flat/empty.txt", "");
  writeFile("flat/hard-a.txt", "c".repeat(5000));
  linkSync(join(base, "flat/hard-a.txt"), join(base, "flat/hard-b.txt"));

  writeFile("tree/sub/one.txt", "x".repeat(300));
  writeFile("tree/中文 目录/文件.txt", "中文内容");
  mkdirSync(join(base, "tree/empty-dir"), { recursive: true });
  writeFile("outside/o1.txt", "y".repeat(400));
  writeFile("outside/o2.txt", "z".repeat(500));
  symlinkSync(resolve(base, "outside"), join(base, "tree/junction"), "junction");
  let deep = join(base, "tree/deep");
  for (let depth = 0; depth < 40; depth += 1) {
    deep = join(deep, `n${depth}`);
    mkdirSync(deep, { recursive: true });
  }
  writeFileSync(join(deep, "leaf.txt"), "leaf");

  // 2. Exact answers. Directories are reported as 0 by `--apparent-size`, so these totals are the
  //    sum of the file contents: the hard link is counted once, and twice under `-l`.
  assert.equal(du("-b --apparent-size -s fixtures/flat").stdout, "8000\tfixtures/flat\n");
  assert.equal(du("-b --apparent-size -l -s fixtures/flat").stdout, "13000\tfixtures/flat\n");
  assert.equal(du("-b --apparent-size -s fixtures/outside").stdout, "900\tfixtures/outside\n");
  assert.equal(du("-b --apparent-size -s fixtures/tree").stdout, "316\tfixtures/tree\n");
  // The junction is a reparse point, which the per-entry traversal counts as a zero-sized entry
  // and never descends into; the enumeration must reproduce that instead of following it.
  assert.equal(du("-b --apparent-size -s fixtures/tree/junction").stdout, "0\tfixtures/tree/junction\n");
  assert.equal(du("--inodes -s fixtures/flat").stdout, "5\tfixtures/flat\n");
  pass("apparent sizes, hard links and junctions are counted exactly");

  // 3. Every option the traversal feeds must produce the same output either way. `-a` is the
  //    strict case: it prints one line per entry, so a single wrong size or path shows up.
  for (const [label, args] of [
    ["summary of a flat directory", "-s fixtures/flat"],
    ["every entry of a flat directory", "-a fixtures/flat"],
    ["hard links counted twice with -l", "-l -a fixtures/flat"],
    ["apparent size per entry", "-b --apparent-size -a fixtures/tree"],
    ["allocation per entry", "--block-size=1 -a fixtures/tree"],
    ["atime reporting", "-a --time=atime fixtures/tree"],
    ["birth time reporting", "-a --time=birth fixtures/tree"],
    ["ctime reporting", "-a --time=ctime fixtures/tree"],
    ["inode counts", "--inodes -a fixtures/tree"],
    ["staying on one filesystem", "-x -a fixtures/tree"],
    ["separate directory sizes", "-S -a fixtures/tree"],
    ["grand total over two operands", "-c -s fixtures/tree fixtures/outside"],
    ["depth limit", "-d 2 -a fixtures/tree"],
    ["threshold", "-t 100 -a fixtures/tree"],
    ["excluded entry", "--exclude=junction -a fixtures/tree"],
    ["human-readable sizes", "-h -a fixtures/flat"],
    ["NUL-separated output", "-0 -a fixtures/flat"],
    ["a junction as the operand", "-b --apparent-size -s fixtures/tree/junction"],
    ["a non-ASCII operand", "-b --apparent-size -a 'fixtures/tree/中文 目录'"],
    ["a deep subtree", "-b --apparent-size -a fixtures/tree/deep"],
  ]) {
    same(label, args);
  }

  // 4. The enumeration is an implementation detail: it is not a documented option.
  const help = du("--help");
  assert.equal(help.status, 0, `du --help exited ${help.status}`);
  assert.ok(!help.stdout.includes("legacy-walk"), "du --help documents the internal traversal switch");

  // 5. The fast path has to be faster. 3000 files: the enumeration opens 30 directories, the
  //    per-entry path opens all 3000 files twice, so the difference survives process start-up.
  for (let directory = 0; directory < 30; directory += 1) {
    for (let file = 0; file < 100; file += 1) {
      writeFile(`heavy/d${directory}/f${file}.txt`, "p".repeat((directory * 100 + file) % 500));
    }
  }
  const best = (args) => {
    let fastest = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const started = Date.now();
      const result = du(args);
      assert.equal(result.status, 0, `du ${args} exited ${result.status}: ${result.stderr}`);
      fastest = Math.min(fastest, Date.now() - started);
    }
    return fastest;
  };
  const enumerated = best("-s fixtures/heavy");
  const perEntry = best("--legacy-walk -s fixtures/heavy");
  assert.ok(
    enumerated < perEntry,
    `the directory enumeration (${enumerated} ms) is not faster than the per-entry traversal (${perEntry} ms) on 3000 files`,
  );
  pass(`the directory enumeration is faster than the per-entry traversal (${enumerated} ms vs ${perEntry} ms)`);

  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过`);