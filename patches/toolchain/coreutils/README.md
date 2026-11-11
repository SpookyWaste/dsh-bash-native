# uutils/coreutils patches

The pinned release is **0.12.0**, built with the `windows` feature. Five patches live here; `0001`–`0004` predate this note and are summarized below, `0005` is described in full because it changes how the default `du` traversal works.

- `0001-path-alias-in-argv.patch` translates the engine's path aliases (`/tmp/...`, `/<letter>/...`) once, in the multi-call binary's `argv` entry point. `find -exec`, `xargs` and `timeout` start real programs with no shell in between, so the binary has to do the translation itself instead of inheriting a shell's.
- `0002-keep-the-os-error-code.patch` keeps the `(os error N)` suffix of a `PermissionDenied` message in `uucore`'s `strip_errno`. The plugin recognizes a file-policy refusal by that code, the only part of the message that does not depend on the host language.
- `0003-tail-reads-the-last-block.patch` fixes `tail -n` on a file whose size is a whole multiple of the block size: the chunk closest to the start of the file was read as empty, so the lines it carried were missing.
- `0004-refuse-a-final-dot.patch` refuses `rmdir dir/.` on Windows: Win32 folds `dir/.` into `dir` and would remove the directory, where POSIX treats a final `.` as invalid (MSYS2 also refuses it).
- `0005-du-windows-directory-enumeration.patch` gives `du` a directory-enumeration traversal on Windows. It is the patch this note is mostly about.

## What `0005` changes

`du`'s per-entry path calls `Stat::new`, which on Windows opens each path **twice**: `get_file_info` opens it for the file id (`FileIdInfo`) and `get_blocks` opens it again for the allocated size (`FileStandardInfo`), while directories get a third open for `fs::read_dir`. That is the cost measured in `docs/du-performance-investigation.md`: 0.79 ms per file in a cold tree with the on-access scanner watching, ~600 files/s, and the whole plugin workspace (228k files) taking more than ten minutes against the 120 s default tool timeout.

The patch walks a directory with `GetFileInformationByHandleEx(FileIdBothDirectoryInfo)` instead: one handle per directory, batched 64 KiB buffers, and every entry's apparent size (`EndOfFile`), allocated size (`AllocationSize`), attributes, file id and the four timestamps come out of the directory index. The directory's own allocation and its volume serial (`-x`) are read from the same handle (`FileStandardInfo`, `FileIdInfo`), so no second open is needed for them either.

The fast path is selected only when it can be exact: it is the default traversal (`-P`, no `-L`), and `-L`/`-D` keep the per-entry path because they dereference by path and detect symlink cycles there. The hidden `--legacy-walk` option selects the per-entry path too; it exists for the tests that compare the two traversals and as a way out if a filesystem the enumeration mishandles is ever found.

Entries the enumeration cannot describe exactly are handed back to the per-entry path **with their whole subtree**:

- reparse points (junctions, symbolic links): the per-entry path counts a reparse point as a zero-sized entry and never descends into a junction, and that asymmetry has to stay;
- compressed and sparse files, whose allocated size has its own accounting rules;
- any file that reports content but zero allocation (some SMB implementations, cloud placeholders): the per-entry path asks the file itself, which keeps the totals of such a share honest instead of reporting it as empty;
- the directory itself when its handle cannot be opened: `Stat::new` runs on it and the subtree goes back to the per-entry traversal, so the error message and the totals are the ones the per-entry path would have reported.

Measured on this machine, warm cache, `du -s`:

| tree | per-entry | enumeration |
|---|---|---|
| 3,000 files / 30 directories | 140 ms | 28 ms |
| 20,000 files / 200 directories | 1.29 s | 45 ms |
| 7,784-file coreutils checkout | 0.89 s | 0.14 s |
| 228k-file plugin workspace | more than 10 min | 3.2 s |

## Deliberate differences

- A file that can be listed but not opened (an ACL that denies reading the data but not the directory index) is measured from the index, where the per-entry path reported its allocated size as zero. The enumeration is the more accurate of the two and matches GNU `du`'s `fstatat`-only approach.
- Cloud placeholders are no longer opened at all, so `du` does not risk hydrating an OneDrive file to measure it.
- The per-entry path's `--exclude` matching no longer panics on a non-UTF-8 file name: the inline `into_string().unwrap()` became the shared lossy conversion both traversals use.

## Testing and rebuilding

`node scripts/build-toolchain.mjs --only=coreutils` applies this patch set and rebuilds the multi-call binary; `node scripts/pack-toolchain.mjs` then refreshes `toolchain/win32-x64/` and `toolchain.lock.json`'s `packaged` record.

`test/test-toolchain-du.mjs` runs `du` for real against the installed toolchain: exact apparent sizes (including a hard link counted once, and twice under `-l`), junction contents not followed, the same output from `--legacy-walk` and the default path for every option that feeds the traversal (`-a`, `-l`, `--inodes`, `-x`, `-S`, `-c`, `-d`, `-t`, `--exclude`, `--time=atime|birth|ctime`, `--block-size=1`, `-0`, non-ASCII operands, a deep subtree), `--help` not advertising the switch, and the enumeration being faster than the per-entry path on 3,000 files.

The patch was written to be upstreamable — no new dependency, no public flag, and the Unix traversal only gains an `is_dir` field that the Windows side shares — but it has not been submitted.