// Verifies the rules that decide which engine patches a build applies.
//
// The lock is authoritative, the directory is checked against it, and a file name carries its pin's version:
// a mistake in any of the three is silent until the artifact misbehaves, so each is asserted here rather than
// left to a `git apply` failure that names the diff instead of the leftover.
import assert from "node:assert/strict";
import { patchPrefix, selectEnginePatches } from "../scripts/engine-patches.mjs";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

// 1. The prefix is the tag's leading version, without the `v` and the dots.
{
  assert.equal(patchPrefix("v1.5.0"), "150");
  assert.equal(patchPrefix("v1.4.3"), "143");
  assert.equal(patchPrefix("1.5.0"), "150", "a tag without the v works the same way");
  assert.equal(patchPrefix("v1.5.0-rc1"), "150", "a pre-release suffix still names the same set");
  assert.equal(patchPrefix("v2.0"), "20");
  assert.throws(() => patchPrefix("nightly"), /cannot derive a patch prefix/);
  pass("a pin's version prefix is derived from its tag");
}

// 2. A matching set comes back in lock order, which is the order the build applies it in.
{
  const listed = ["150-002-second.patch", "150-001-first.patch"];
  const present = ["150-001-first.patch", "150-002-second.patch"];
  assert.deepEqual(selectEnginePatches({ tag: "v1.5.0", listed, present }), listed, "the lock's order, not the directory's");
  assert.deepEqual(selectEnginePatches({ tag: "v1.5.0", listed: [], present: [] }), [], "a pin that needs no patch is valid");
  pass("the lock's order is the apply order");
}

// 3. A listed file that is gone is named, because the build cannot run a diff it never found.
{
  assert.throws(
    () => selectEnginePatches({ tag: "v1.5.0", listed: ["150-001-gone.patch"], present: [], directory: "patches/rubash" }),
    /patches\/rubash does not hold the patches engine\.lock\.json lists: 150-001-gone\.patch/,
  );
  pass("a missing listed patch is refused by name");
}

// 4. A file the lock does not list is refused: a retired patch left behind would run against code it no longer describes.
{
  assert.throws(
    () =>
      selectEnginePatches({
        tag: "v1.5.0",
        listed: ["150-001-kept.patch"],
        present: ["143-004-retired.patch", "150-001-kept.patch"],
        directory: "patches/rubash",
      }),
    /holds patches this pin does not list \(a retired patch is deleted, not kept\): 143-004-retired\.patch/,
  );
  pass("an unlisted patch in the directory is refused");
}

// 5. A file named for another engine version is refused even when the lock lists it.
{
  assert.throws(
    () => selectEnginePatches({ tag: "v1.5.0", listed: ["143-001-old.patch"], present: ["143-001-old.patch"] }),
    /every patch of v1\.5\.0 has to start with 150-: 143-001-old\.patch/,
  );
  pass("a patch from another engine version is refused");
}

console.log(`\n${passed} 项通过`);