// The registry crates this build replaces with a patched copy of the resolved version.
//
// Each entry names the patch that is tracked, the file inside the crate copy it edits, and the line that
// proves the patch reached the copy cargo will compile. Nothing there is optional: a vendored copy that
// quietly keeps the unpatched source is exactly the failure the guards exist to catch, and an entry
// without a guard cannot pass `test/test-vendored-crates.mjs`.
//
// The machinery lives in `scripts/uucore-override.mjs`, which also owns the `uucore` entry: its copy has
// to keep the coreutils monorepo layout because its build script walks that tree for locale bundles.
// `uu_tail` says `build = false` in its manifest, has no such script, and is copied as it is.
import { UUCORE_CRATE, applyCrateOverride, assertCrateGuard } from "./uucore-override.mjs";
import { join } from "node:path";

/** The `tail` last-block fix, tracked as `patches/vendored/uu_tail/0001-tail-reads-the-last-block.patch`. */
export const UU_TAIL_CRATE = {
  name: "uu_tail",
  patch: join("patches", "vendored", "uu_tail", "0001-tail-reads-the-last-block.patch"),
  module: join("src", "chunks.rs"),
  guard: "self.size - (self.max_blocks_to_read as u64 - 1) * BLOCK_SIZE",
  guardFailure: "does not give the block closest to the beginning of the file its remainder",
};

/** The `rmdir` final-dot guard, tracked as `patches/vendored/uu_rmdir/0001-refuse-a-final-dot-on-windows.patch`. */
export const UU_RMDIR_CRATE = {
  name: "uu_rmdir",
  patch: join("patches", "vendored", "uu_rmdir", "0001-refuse-a-final-dot-on-windows.patch"),
  module: join("src", "rmdir.rs"),
  guard: "if has_dot_last_component(path) {",
  guardFailure: "does not refuse a final dot before Win32 folds it away and removes the directory",
};

/** Every crate this build vendors, in the order the overrides are applied. */
export const VENDORED_CRATES = [UUCORE_CRATE, UU_TAIL_CRATE, UU_RMDIR_CRATE];

/**
 * Point the checkout at a patched copy of every vendored crate.
 * @param options - the checkout, the repository root, the build cache, and the run/log seam.
 * @returns the applied overrides, keyed by crate name: the resolved version and the vendored directory
 * (empty for an in-repo copy).
 */
export function applyVendorOverrides({ checkout, repoRoot, cacheRoot, io }) {
  const applied = new Map();
  for (const crate of VENDORED_CRATES) {
    applied.set(crate.name, applyCrateOverride({ crate, checkout, repoRoot, cacheRoot, io }));
  }
  return applied;
}

/**
 * Prove every vendored copy carries its patch, against the file the build will compile.
 *
 * The overrides are read back from {@link applyVendorOverrides} rather than resolved again, and a crate
 * missing from them is refused: a guard verified against a directory this run never wrote would be a
 * statement about the wrong tree.
 * @param options - the checkout, the applied overrides, and the log seam.
 * @returns the patched files, keyed by crate name.
 */
export function assertVendorGuards({ checkout, applied, io }) {
  const files = new Map();
  for (const crate of VENDORED_CRATES) {
    const result = applied.get(crate.name);
    if (result === undefined) {
      throw new Error(`${crate.name} has no applied override, so its guard cannot be verified; apply the vendored crates with the same table first`);
    }
    files.set(crate.name, assertCrateGuard({ crate, checkout, vendorDir: result.vendorDir, io }));
  }
  return files;
}