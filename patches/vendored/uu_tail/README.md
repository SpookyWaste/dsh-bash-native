# Reading the block closest to the beginning of a file

`0001-tail-reads-the-last-block.patch` changes one expression in `uu_tail`'s `ReverseChunks` iterator, which
is what `tail -n` walks a seekable file backwards with:

```rust
let block_size = if self.block_idx == self.max_blocks_to_read - 1 {
    self.size - (self.max_blocks_to_read as u64 - 1) * BLOCK_SIZE   // was: self.size % BLOCK_SIZE
} else {
    BLOCK_SIZE
};
```

**Why.** The last block of that walk is the one closest to the beginning of the file, and upstream sized it
as the remainder `size % BLOCK_SIZE`. For a file whose size is a whole multiple of the 64 KiB block that
remainder is zero, so the block held no bytes at all and the lines it should have carried were never seen.
Measured on the engine this plugin shipped before the patch: a 65536-byte file printed nothing for `-n 1`,
`-n 2` and `-n 3`, and a 131072-byte file answered `-n 16384` with 8192 lines. Subtracting what the other
blocks cover gives that block its full `BLOCK_SIZE` in that case and the same remainder in every other,
which is what upstream's own fix does (`uutils/coreutils` `471cc8a6`; unreleased — the newest published
`uu_tail` is still 0.12.0).

**Scope.** Only the backward walk over a *seekable* file changes. `tail -c N` on such a file and the
streaming path a pipe takes were measured correct before the patch and stay unchanged, and `-n +N` (counted
from the start) does not use this iterator at all. The arithmetic is wrong on Linux too — it is simply
reached less often — so the patch is not conditioned on Windows.

## How it reaches the build

`tail` is one of the utilities the engine carries as a bundled tool (`BUILT_IN_UTILITIES` in
`src/toolchain.ts`), so the copy that answers a script is the one compiled into `brush.exe`, and no
toolchain binary shadows it. The crate itself comes from crates.io, where a source cannot be patched in
place — the registry cache is shared with every other build on the machine and cargo owns it. So
`scripts/vendored-crates.mjs` names it: the resolved version is copied into the build cache as the crate
itself (its manifest says `build = false`, so it has no build script and needs no monorepo layout), this
patch is applied to that copy, `[patch.crates-io]` points cargo at it, and `src/chunks.rs` is read back for
the guard line before the build starts. The copy is never checked in.