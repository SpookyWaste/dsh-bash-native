// No path of the machine that built this package may appear in the shipped binaries.
//
// `file!()` bakes a panic's source location into a release binary, and for code inside a dependency that
// location is the cargo registry under the builder's home directory — a name and a layout that has no business
// in a published package. Both build scripts remap that prefix (`RUSTFLAGS=--remap-path-prefix=<home>=/build`);
// this is the gate that the remap actually ran, and the automated half of the release checklist's
// `git grep -ni <user>` step (that one also covers text files, which this cannot).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const home = homedir();
if (home.length === 0) {
  console.log("SKIP  test-artifact-privacy.mjs: this platform reports no home directory");
  process.exit(0);
}

// Two spellings, because Windows has both: the long name and the 8.3 form (first six characters uppercased,
// then `~1`). The release checklist calls this out — a case-sensitive search for the long name misses the
// short one, and the short one is what an unremapped registry path can end up carrying.
const builders = new Set([home.toLowerCase()]);
const user = basename(home);
if (user.length > 6) builders.add(`${user.slice(0, 6).toLowerCase()}~1`);

const binaries = [join(ROOT, "engine", "win32-x64", "rubash.exe")];
for (const name of readdirSync(join(ROOT, "toolchain", "win32-x64"))) {
  if (name.toLowerCase().endsWith(".exe")) binaries.push(join(ROOT, "toolchain", "win32-x64", name));
}

for (const path of binaries) {
  const text = readFileSync(path).toString("latin1").toLowerCase();
  for (const needle of builders) {
    const hit = text.indexOf(needle);
    assert.equal(
      hit < 0,
      true,
      `${path.slice(ROOT.length)} carries the build machine's path (${needle} at byte ${hit}); ` +
        "rebuild it with the remap in scripts/build-*.mjs rather than publishing it",
    );
  }
}
pass(`no builder path in the ${binaries.length} shipped binaries`);

console.log(`\n${passed} 项通过`);