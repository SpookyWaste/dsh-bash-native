# `uu_rmdir`: a final `.` is refused before Win32 folds it away

`uu_rmdir` calls `std::fs::remove_dir(path)` with whatever operand it was given. Windows' `RemoveDirectoryW`
normalizes away a trailing `.`, so `rmdir dir/.` removes `dir` and exits 0. POSIX makes a final `.` an
`EINVAL` for `rmdir`, and the MSYS2 runtime this project's corpus is scored against enforces it: its
`rmdir` in `winsup/cygwin/dir.cc` returns `EINVAL` from `has_dot_last_component(dir, false)`.

The patch adds a Windows-only guard in `remove_single`, between the `-v` message and `remove_dir`: once
trailing separators are dropped, a last component of `.` returns `EINVAL` as an `io::Error` and the
directory survives. `..` is deliberately not rejected — its parent necessarily contains it, so Win32
answers `ERROR_DIR_NOT_EMPTY`, which is also what MSYS2 `rmdir x/..` reports.

The guard's port comes from oh-my-pi's `d48cee7d` (2026-10-17, MIT), which added the same Windows-only
check to its in-process `rmdir`. This project carries it through the vendored-crate channel rather than
its builtin suite because the engine's bundled `rmdir` is the uutils crate. The guard line
`if has_dot_last_component(path) {` is what `scripts/vendored-crates.mjs` reads back from the copy the build
compiles, so a copy that silently lost the check fails `npm test` instead of shipping.