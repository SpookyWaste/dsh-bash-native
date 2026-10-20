# Vendored crates

Crates whose published source cannot produce the behaviour this plugin needs, so the build compiles a
patched copy of the resolved version instead.

| Crate | Patch | The rule it carries |
|---|---|---|
| `uu_tail` | `uu_tail/0001-tail-reads-the-last-block.patch` | [uu_tail/README.md](uu_tail/README.md) |
| `uu_rmdir` | `uu_rmdir/0001-refuse-a-final-dot-on-windows.patch` | [uu_rmdir/README.md](uu_rmdir/README.md) |

The table that drives the whole mechanism is `scripts/vendored-crates.mjs`: every entry names the crate, the
tracked patch, the file inside the copy that patch edits, and a guard line only the patched file carries.
The machinery it calls is `scripts/uucore-override.mjs`, which is also where `uucore` itself is vendored —
that entry differs only in needing the coreutils monorepo layout for the locale bundles its build script
walks, and its own rule is [../uucore/README.md](../uucore/README.md).

Nothing vendored is ever checked in. What is recorded is the patch, the resolved version and the digest of
the copy the build compiled; a copy whose record does not match the patch is rebuilt, and `npm test` fails
if a guard is missing from the file cargo is about to compile.