# Keeping the OS error code on a refusal

`0001-keep-the-os-error-code.patch` changes one function in `uucore`, the crate every uutils program
builds its error messages through:

```rust
pub fn strip_errno(err: &std::io::Error) -> String {
    let mut msg = err.to_string();
    if err.kind() == std::io::ErrorKind::PermissionDenied {
        return msg;                       // <- added
    }
    if let Some(pos) = msg.find(" (os error ") {
        msg.truncate(pos);
    }
    msg
}
```

**Why.** The plugin that runs these programs has to answer one question after a command settles: was a
file effect refused by the file policy? The only evidence available is the command's exit status and its
stderr — and the status cannot carry the answer, because bash hands the script's status to its last
command (`echo x > <outside>/f; echo done` settles at 0 with the file unwritten, measured). That leaves
the wording, and upstream strips exactly the part of it that does not depend on the host's language:
`strip_errno` turns `拒绝访问。 (os error 5)` into `拒绝访问。`, which matches no dialect on a
non-English Windows. Keeping the code for a refusal makes the message match the plugin's `os error 5`
default on any host language, which is what the English `access is denied` dialect already does for
English hosts. `ErrorKind::PermissionDenied` is the language-neutral test: the Windows ACL refusal is
`ERROR_ACCESS_DENIED` (5) and `EACCES`/`EPERM` map to the same kind.

**Scope.** Every other message keeps its GNU-compatible wording — the function's own doc example
(`strip_errno` of a missing file prints `No such file or directory`) still holds, and this is a
deliberate divergence from upstream only for refusals.

**What it does not cover**, recorded so the plugin's limitations stay honest: `UIoError`'s own `Display`
does not call this function — it normalizes an OS error to a table of hardcoded English strings
(`Permission denied`, and so on), which is already language-neutral and matches the provider's dialect.
Programs that do not use `uucore` at all (the Go `awk`, `jaq`, `ugrep`) and Windows' own tools keep
printing the localized text alone. The classification stays a heuristic: a refused *read* carries the
code too, so a command that hit a host ACL denial and still exited 0 will report a policy denial, which
is the same over-report an English host already produces through the provider's dialect.

## Two injection sites

`uucore` reaches a build in two shapes, and the same edit has to be applied in both:

| Build | Where `uucore` comes from | How the patch is applied |
|---|---|---|
| Engine (`brush`) | crates.io — `brush-coreutils-builtins` compiles about ninety `uu_*` crates into the engine | `scripts/uucore-override.mjs` vendors the resolved version into the build cache, applies this patch to that copy, and points `[patch.crates-io]` at it |
| Toolchain `grep` / `sed` / `findutils` | crates.io — a different resolved version each (0.10.0, 0.5.0, 0.9.0) | the same helper, from `scripts/build-toolchain.mjs` |
| Toolchain `coreutils` | in-repo `src/uucore`, version 0.12.0 | `patches/toolchain/coreutils/0002-keep-the-os-error-code.patch`, applied by that component's own patch machinery |

The in-repo copy needs its own patch file only because its path differs (`src/uucore/src/lib/mods/error.rs`);
the edit is the same three lines plus the guard, and both files carry this header so neither drifts
silently. Vendored copies are never checked in: the patch and the resolved version are recorded, the
source is copied from the cargo registry cache, and a copy whose recorded digest does not match is
rebuilt.

## The vendored copy keeps the monorepo's shape

A copy dropped into a directory of its own does not build a usable engine, and that is measured rather
than assumed: `uucore`'s build script embeds the Fluent locale bundles by walking
`project_root/src/uu/<utility>/locales`, where `project_root` is `CARGO_MANIFEST_DIR/../..`, and it always
embeds `<project_root>/src/uucore/locales`. In the crates.io layout the crate has no `src/uu` above it, so
the script falls back to scanning whatever `uu_*` crates happen to be unpacked beside it — which a lone
vendored directory has none of. The first build of this patch therefore shipped an engine that printed
`brush.exe: mkdir-error-cannot-create-directory` instead of the sentence, because the message id had no
bundle behind it.

So the vendored tree is laid out the way the monorepo lays it out — `<root>/src/uucore` beside
`<root>/src/uu/<utility>/locales` — and the utility bundles are copied from the same registry directory the
crate came from, not filtered by version, because that is exactly the set the crates.io fallback would have
embedded. `git apply --directory=src/uucore` re-roots this patch's paths at the crate's place in that tree.
The record inside the vendored root names the patch digest and how many locale sets were carried, and a
build whose record does not match is rebuilt before the guard is checked.