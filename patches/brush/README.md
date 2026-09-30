# Engine patches

`scripts/build-engine.mjs` clones the commit in `engine.lock.json`, applies every `*.patch` here in
name order, builds `brush-shell`, and installs the result as `engine/win32-x64/brush.exe` inside this
package (backing the previous artifact up under `%LOCALAPPDATA%\dsh-bash-native\engine-backup\` first).
That artifact is what ships: the executor verifies it against the hash in `engine.lock.json` and runs it
where the package puts it, so no per-user copy is involved.

## Why patch the engine at all

Some divergences cannot be fixed from outside it: the toolchain can shadow a Windows program, but it
cannot make the shell set `$!`, map `/tmp`, or give a child its own invisible console. Measurement
decides which of them matter, and the compatibility corpus holds the result
(`corpus/baseline.json` for the engine alone).

## What is measured today

The corpus declares two gaps as `known-gap`, both engine-side; the third row below is an engine
behaviour the corpus pins as a timing boundary rather than counting as a gap:

| Gap | Measurement | Root cause (source-read) |
|---|---|---|
| `$!` is empty for a background job the shell registers no process for | `sleep 0.2 & p=$!` → `p=""` | see "Landed" below: the fix covers external commands; a builtin, a function or a bundled utility has no registered process to report, and a bundled utility does start a child — nothing ties it to the job |
| A bundled utility reports a closed reader in its own words and exits with its own status | `seq 1 200000 \| head -c 1` → stderr `write error: Broken pipe`, writer status **0**; `yes \| head -c 1` → **0** with no output; `cat big \| head -c 1` → **13**; `ls -R <tree> \| head -c 1` → **1**; the shell's own builtin gives **141** with no output | Windows has no `SIGPIPE`, and **each utility decides for itself** what to do instead: `uu_seq` prints and returns success, `uu_yes` returns success silently, `uu_cat` calls `std::process::exit(13)`, every one of them under an explicit `cfg(windows)` branch. `0005` ends a compound command that *observed* the broken pipe; a child that consumed the condition inside itself is a declared gap — see the research section on the broken-pipe writer |
| The write side of a process substitution can be cut off by the exit | `echo hi > >(cat)` → status **0**, stdout **empty** (bash prints `hi`) | `setup_process_substitution` spawns the consumer with `tokio::spawn` and drops the handle, so nothing waits for it; the consumer is an in-process task, not a child that outlives the shell |

The `ERR` trap gap that used to sit beside it is now landed as `0003-err-trap-scope.patch`; its section
below keeps the evidence, including the bash cross-check that the fix was measured against.

Two gaps that used to be listed here are now landed, and their sections below keep the evidence:
`/tmp` (`0002-unix-tmp-alias.patch` for the paths the shell opens, `0004-external-argv-tmp-alias.patch`
for the arguments of every command it launches) and the descriptor-path ordering inside `open_file`,
which was part of the `0002` patch.

## Landed

### `0001-background-job-pid.patch` — the PID behind `$!`

Measured before: `sleep.exe 30 & p=$!` → empty, `jobs` reported `<pid unknown>`.
Measured after: a real PID, `jobs -p` prints it, and `sleep.exe 30 & p=$!; kill "$p"` exits 0.

The patch adds `directly_spawnable_pipeline()` and `try_spawn_pipeline_as_job()` to
`brush-core/src/interp.rs` and makes `CompoundList::execute` try them before
`spawn_async_ao_list_in_task`. A background pipeline of literal, external simple commands is now
spawned by `spawn_pipeline_processes` in the parent, and its children are registered as
`JobTask::External` — which is what `Job::representative_pid()` (and therefore `$!` and `jobs -p`)
reads. Everything else keeps the in-process path unchanged.

Two deliberate limits, both decided before spawning rather than discovered afterwards:

* A name that is not a plain external command is declined, and the check happens *before* anything
  starts because the alternative is abandoning processes that already began. The premise used to be "a
  builtin has no child process", and measurement does not support it for the bundled set: `sleep 30 &`
  really does start a `--invoke-bundled sleep` child (see `0004`), which is simply never tied to the
  job, so `$!` stays empty. What the check excludes with no child at all is a true in-process builtin
  (`echo`), a function, and a compound command. The corpus keeps the bundled case as `known-gap`
  (`process-dollar-bang-builtin-background`) while the external case is `must-match`
  (`process-dollar-bang-external`, `process-jobs-p-reports-pid`, `process-kill-with-dollar-bang`).
* A command name that is not a plain literal (`$CMD &`) is declined, because resolving it needs
  expansion and expansion can run command substitution.

oh-my-pi solves the same problem the same way (`try_spawn_pipeline_as_job` plus
`should_try_spawn_pipeline_as_job`, commits `0534320f` and `2e5b0b57`), but its regression test is
`#[cfg(unix)]`, so the behaviour was never asserted on Windows — which is why the corpus asserts it
here.

## Also measured: the build needs `experimental-bundled-coreutils`

`brush-shell`'s default features do not include the bundled utilities the contract names.
Built without that feature, `type -t sleep` reports `missing` where the published engine reports
`builtin`, so the contract's account of that set would be false. `engine.lock.json`
therefore pins `features: ["experimental-bundled-coreutils"]`, and the corpus is what catches it if
that drifts.

## Next: `/tmp`, and the fd paths, both with an exact location

### Where the `/tmp` bug is

`brush-core/src/shell/fs.rs:200`:

```rust
pub fn absolute_path(&self, path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.as_os_str().is_empty() || path.is_absolute() {
        path.to_owned()
    } else {
        self.working_dir().join(path)
    }
}
```

On Windows, Rust does not consider `/tmp` absolute (it has no drive or UNC prefix), so the path takes
the join branch, and `PathBuf`'s push semantics treat a rooted-but-driveless `\tmp` as "replace
everything after the prefix": `D:\work` joined with `/tmp` is `D:\tmp`. That is the measured
`cd /tmp && pwd` → `D:\tmp`, and because that directory usually does not exist, `cd /tmp` fails and
anything that writes to `/tmp` fails or lands in the drive root. `brush-core` contains no reference to
`temp_dir` or `/tmp` at all, so upstream has never had a mapping: not in 0.4.0, not in 0.5.0, not on
main.

### What oh-my-pi did, and when

The fix is **recent**: three commits on 2026-09-10, all closing oh-my-pi issue #11603.

| Commit | What it fixed |
|---|---|
| `48c96e2e` | Moved the `/tmp` mapping out of `Host::resolve` into `normalize_shell_path`, so every shell path boundary agrees — builtins, `ls`, and redirections alike — instead of only the utility builtins |
| `7176afe1` | Taught the **glob root** resolver (`pattern_drive_alias_root`) the alias: pattern expansion bypasses the normalizer, so `/tmp/*` did not expand under `env::temp_dir()` even after the first fix |
| `93da2fc1` | Collapse `.`/`..` against the logical POSIX path, clamped at root, **before** substituting: otherwise `/tmp/../tmp/f` became `%TEMP%\..\tmp\f`, a *sibling* of the temp directory, and a `..` escaping `/tmp` now yields no rewrite at all |

Related earlier work in the same area: `a90dfe0d` (2026-08-12, issue #8355) preserved non-ASCII in
`/c` and `/mnt/c` drive-alias tails, and the 8.3 short-name identity fix is `eaa7fd1c`/`3ff57384`
(2026-08-07/16, issue #7911) with a follow-up tightening in `843a3609` (2026-09-24).

### Therefore the patch has four parts, not one

1. Translate in the **single** chokepoint every boundary already goes through: `absolute_path`. The
   file also shows the precedent for platform special files — `open_file` calls
   `crate::sys::fs::try_open_special_file(path)` *before* `absolute_path` for `/dev/null` on Windows —
   so `/tmp` belongs beside it rather than in the builtins.
2. Cover the **pattern/glob root** helper as well (brush's `pattern_path_root…`, next to the
   `pattern_path_root_drive_letters` test); otherwise `/tmp/*` bypasses the mapping.
3. Collapse `.`/`..` against the logical POSIX path before substituting, clamping at root, so a `..`
   cannot escape the temp directory.
4. **The fd paths are a separate, smaller bug with the same cause.** `open_file` absolutizes first and
   only then calls `shell_fd_path_to_fd(&path_to_open)`, which compares the string against
   `/dev/stdin`, `/dev/stdout`, `/dev/stderr` and `/dev/fd/N`. After `absolute_path` the string is
   `D:\dev\stdin`, so the comparison can never match — that is why `/dev/stdin` is unavailable even on
   main, where `shell_fd_path_to_fd` exists. Checking the raw path first (as `try_open_special_file`
   already does) is a reordering, not new machinery.

## The port, in oh-my-pi's own code

Fetched from `can1357/oh-my-pi` (three commits on 2026-09-10, all closing #11603) rather than
reconstructed from their messages. This is the source of truth for the patch.

**One correction to the section above:** the pinned brush has **no `normalize_shell_path` at all** — a
grep for it across `brush-core` returns nothing, and `translate_unix_drive_path` is absent too. Both are
oh-my-pi's own additions to their vendored `brush-core`; upstream only has `pattern_drive_alias_root`
(which their second commit then extends). So the patch has to carry the helper *and* its call site, not
just a new branch inside an existing function.

### 1. `sys/fs.rs` — the `/tmp` translation in its final form (`48c96e2e` + `93da2fc1`)

```rust
pub fn normalize_shell_path(path: &Path) -> Cow<'_, Path> {
    #[cfg(windows)]
    {
        translate_unix_drive_path(path)
            .or_else(|| translate_unix_tmp_path(path, env::temp_dir))
            .map_or(Cow::Borrowed(path), Cow::Owned)
    }
    #[cfg(not(windows))]
    { Cow::Borrowed(path) }
}

/// `.`/`..` are collapsed against the logical POSIX path first, clamping at the root, so
/// `/tmp/../tmp/f` resolves like `/tmp/f` instead of appending the raw remainder onto the nested
/// `%TEMP%` (which would escape into a sibling dir). A `..` that climbs out of `/tmp` yields a
/// non-`/tmp` path, i.e. no rewrite.
#[cfg(any(windows, test))]
fn translate_unix_tmp_path(path: &Path, temp_dir: impl FnOnce() -> PathBuf) -> Option<PathBuf> {
    let mut components = path.components();
    if components.next() != Some(Component::RootDir) {
        return None;
    }

    let mut logical: Vec<&OsStr> = Vec::new();
    for component in components {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                logical.pop();
            }
            Component::Normal(part) => logical.push(part),
            // A second root or a drive prefix cannot appear in a POSIX operand.
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }

    let mut tail = logical.into_iter();
    if tail.next() != Some(OsStr::new("tmp")) {
        return None;
    }

    let mut native = temp_dir();
    native.extend(tail);
    Some(native)
}
```

Their tests are worth carrying over as they stand: `/tmp` → the temp dir, `/tmp/probe/sub` →
`temp/probe/sub`, `/tmp/../tmp/f` → `temp/f`, `/tmp/probe/../sub` → `temp/sub`, `/tmp/..` → `None`,
`/tmp/../var/f` → `None`, and neither `/tmpfile` nor `/var/tmp` aliases.

### 2. `sys/fs.rs` — the glob root learns the alias too (`7176afe1`)

Pattern expansion does not go through the normalizer; it resolves its root through
`pattern_drive_alias_root_impl`, which knew only the MSYS drive aliases. That function takes the temp
directory as a parameter and grows one arm ahead of the drive-letter one:

```rust
    // A bare `/tmp` glob root maps to the system temp dir, matching the
    // non-pattern rewrite in `normalize_shell_path`.
    if second == Some("tmp") {
        return Some((temp_dir(), 2));
    }
```

The caller passes `env::temp_dir`, and `/tmpfile` deliberately falls through to plain root handling.

### 3. The call site is what makes it true everywhere (`48c96e2e`)

Their reason for moving the mapping is the trap worth quoting:

> Moved the POSIX /tmp mapping out of `Host::resolve` into `normalize_shell_path` so every shell path
> boundary (builtins, `ls`, redirections) agrees, instead of only the utility builtins.

Their `Host::resolve` now only calls the normalizer and joins against the shell's cwd. The equivalent
boundary in brush is `Shell::absolute_path` (`brush-core/src/shell/fs.rs`), which today joins without
normalizing; since every redirection, `cd`, `test` and `open_file` reaches the filesystem through it,
that is where the call belongs. The same file shows the pattern to imitate: `open_file` calls
`crate::sys::fs::try_open_special_file(path)` *before* `absolute_path` for Windows' `/dev/null`.

### `0003-err-trap-scope.patch` — the `ERR` trap fires in the scope that set it

Measured: `(trap 'echo caught' ERR; false) 2>/dev/null; echo done` prints `done` only, while the same
trap at the top level fires. bash prints `caught` and `done`, because a trap set *inside* a subshell
applies to that subshell; `-E` governs whether a trap is *inherited*, not whether it works where it was
set.

The root cause is one guard in `brush-core/src/shell/traps.rs`, in `invoke_trap_handler`:

```rust
        // In functions and subshells, some traps are only inherited when the
        // corresponding option is enabled.
        if (self.in_function() || self.is_subshell())
            && !self.is_trap_inherited_in_current_scope(signal)
        {
            return Ok(ExecutionResult::success());
        }
```

with

```rust
    fn is_trap_inherited_in_current_scope(&self, signal: TrapSignal) -> bool {
        match signal {
            TrapSignal::Err => self.options().shell_functions_inherit_err_trap,
            TrapSignal::Debug | TrapSignal::Return => self.options().shell_functions_inherit_debug_and_return_traps,
            TrapSignal::Exit | TrapSignal::Signal(_) => true,
        }
    }
```

So inside a subshell an `ERR` handler fires only when `set -E` is on — including a handler that was set
inside that very subshell, which is the bug. The guard cannot tell the two cases apart because
`TrapHandler` (`brush-core/src/traps.rs`) carries only `command` and `source_info`, no provenance.

The fix takes the second design, because the first one has to be right in every place that opens a
scope while this one keeps the whole rule in the firing path:

* `TrapHandler` gains `inherited: bool` (serde-defaulted), and `TrapHandlerConfig::mark_all_inherited()`
  flips it for every registered handler.
* A subshell marks its cloned copy inherited right after `let mut subshell = shell.clone();`, and
  `Shell::enter_function` marks the handlers that already existed when the body starts.
* `invoke_trap_handler` now fetches the handler first and skips only an **inherited** one whose option
  is off, so a handler set in the current scope always fires.

Measured against GNU bash 5.3.15 on the same machine, six cases, all matching after the fix:

| Snippet | bash | brush before | brush after |
|---|---|---|---|
| `(trap 'echo caught' ERR; false) 2>/dev/null; echo done` | `caught`, `done` | `done` | `caught`, `done` |
| `f() { false; }; trap 'echo caught' ERR; f; echo done` | `caught`, `done` | `caught`, `done` | unchanged |
| `set -E; f() { false; }; trap 'echo caught' ERR; f; echo done` | `caught`, `caught`, `done` | same | unchanged |
| `trap 'echo t' ERR; (false) 2>/dev/null; echo done` | `t`, `done` | same | unchanged |
| `set -E; trap 'echo t' ERR; (false) 2>/dev/null; echo done` | `t`, `t`, `done` | same | unchanged |
| `trap 'echo t' ERR; if false; then :; fi; echo done` | `done` | same | unchanged |

Three of those are now corpus cases (`shell-trap-err` plus the two function ones and the inherited
subshell one), and the corpus proves they discriminate: against the engine without this patch,
`shell-trap-err` reports `[silent-wrong]` and a `REGRESSION`, which is exactly the guard working.

### `0004-external-argv-tmp-alias.patch` — the alias reaches the arguments

`0002` fixed what the shell opens itself. Everything else still resolved `/tmp` the way Win32 does —
against the current drive's root — and the measurement that made a second patch worth it was worse than
"does nothing": with the working directory on `D:`, `cat /tmp/f` read `D:\tmp\f`, `ls /tmp` listed
whatever lived in `D:\tmp`, and `rm -rf /tmp/d` deleted *that* directory while reporting success. Reads
were wrong under every file policy, writes were wrong whenever the policy allowed them, and the corpus
could not see it because its `/tmp` cases never asserted that the delete happened (they left a file in
`%TEMP` on every green run).

**Where the one change goes.** Read `brush-shell/src/bundled.rs` before assuming the bundled utilities
run in-process: every registered name installs a *shim* builtin whose execution re-enters
`current_exe()` as `brush --invoke-bundled <name> <args...>`, so a bundled `cat` is an ordinary child
process. That makes `brush-core/src/commands.rs::compose_std_command` — the only place an external
spawn is composed, `std::process::Command::new` appears nowhere else in the shipped crates — the single
boundary that covers bundled utilities, installed tools and foreign programs at once. The plan it
replaced was a per-utility operand table for the bundled set, which would have left `grep`, `find` and
`node` uncovered.

**The rule** (`sys/fs.rs::normalize_shell_arg` and `translate_tmp_argument`, unit-tested in that file):

- a bare argument that is `/tmp` or starts with `/tmp/` is translated through the same
  `translate_unix_tmp_path` the shell-side patch uses;
- an option's attached value is translated too (`--file=/tmp/x`, which is what `sort --output=` is),
  because that value is the same kind of operand;
- everything else is returned unchanged: `/dev/...` and `/etc/...` keep their meaning (the drive-mount
  rule arrives with `0009`), `a=/tmp/x` is data rather than an option, and an argument that merely *contains*
  `/tmp` is never rewritten.

**The trade-off is Git Bash's, so it is documented rather than hidden.** The rule reads text, not
intent: `grep /tmp/x file` has its pattern translated, exactly as MSYS translates a `/`-leading argument
before running a native program. `DSH_BASH_NATIVE_NO_PATHCONV` (exported, or set on a single command)
disables the rewrite for every argument, so operands must then be given as real paths. The corpus pins
both halves as `argv-tmp-pattern-translated-unless-escaped`.

Measured on this machine, patched engine with the toolchain on `PATH`:

| Form | Before `0004` | With `0004` |
|---|---|---|
| `cat`, `ls`, `od -c`, `wc -l`, `head -1`, `realpath` on `/tmp/f` | the drive-root lookalike (`D:\tmp\f`) | the temporary directory |
| `cp /tmp/f /tmp/c`, `rm -f /tmp/c`, `rm -rf /tmp/d` | the drive-root lookalike | the temporary directory, and the delete really happens |
| `grep hello /tmp/f`, `sed -n 1p /tmp/f`, `find /tmp/d -maxdepth 1`, `diff /tmp/f /tmp/f` | the drive-root lookalike, or "path not found" | the temporary directory |
| `node /tmp/s.js`, `/tmp/prog.exe --version` | not resolved | translated, the program path included |
| `echo /tmp/x`, `printf '/tmp/%s' x` | printed `/tmp/x` | unchanged: in-process builtins are never spawned |
| `DSH_BASH_NATIVE_NO_PATHCONV=1 cat /tmp/f` | — | verbatim arguments, so the drive-root path is used again; `=0` and an empty value keep the rewrite |

Verification: `cargo test --package brush-core --lib sys::fs` covers the translation and the three
"left alone" forms; ten `argv-tmp-*` corpus cases cover the table; both recorded baselines hold
(`fail 0`, `silent-wrong 0`; the current counts are the table in `docs/manual.md`); the installed engine
is the source build.

**Series reproducibility, found while generating this patch.** `git apply` of `0001`, `0002`, `0003` in
name order failed on a fresh checkout at `0003`, whose context was the *pre-`0001`* text of
`interp.rs:249`: the tree it was generated from had `0001` applied after it, so the series could only be
applied to a tree that already carried that patch. `0003` is regenerated here against the post-`0001`
state, and the whole series now replays from a clean checkout — `node scripts/build-engine.mjs
--refresh` re-checks out the pin, applies every patch in this directory, rebuilds and re-installs — while a scratch
clone patched the same way is byte-identical to that tree apart from line endings. **Two corrections,
measured when the replay was finally run (section 36 of `docs/research.md`).** The replay claim was
unverified: `applyPatches` called `git apply` without the checkout as its working directory, so the
patches were applied to whichever repository the script was invoked from and the first one failed with
`brush-core/src/interp.rs: No such file or directory`; that is fixed, and every patch in the series now
applies in name order. And a rebuild is *not* byte-identical to the shipped artifact: 28 bytes differ — three in the
COFF header (`TimeDateStamp`) and twenty-five in `.rdata` (the linker's debug-record GUID and age) — with
no `.text` byte changed, so `engine.lock.json` records the provenance of the shipped bytes and a rebuilt
engine is accepted behaviourally (the full suite and the corpus), never by hash.

### `0005-closed-reader-stage-abort.patch` — a broken pipe ends a compound command that saw it

Windows has no `SIGPIPE`. A standalone tool that writes into a pipe whose reader left is killed by the
signal and exits 141 silently; this shell's own builtins already map the same condition
(`error.rs`/`commands.rs`) to `ExecutionExitCode::BrokenPipe`, so a single builtin such as
`printf … | head -c 1` ends with 141 and prints nothing. What did not follow is everything *around* the
builtin: a compound command that keeps running after one of its commands reported 141 never notices, so
a loop writing into a closed pipe spins or blocks instead of ending the stage the way bash's killed
child process does.

`ExecutionResult::is_broken_pipe()` is checked where a sequence decides whether to continue — the
`Program`, `CompoundList`, `AndOrList` and `CaseClause` loops plus the `while`/`until`, `for` and
arithmetic `for` bodies — so a stage stops the moment the status says the reader is gone.

What it does **not** cover is the shape the second review measured in a live session. With a bundled
child as the writer (`for i in $(seq 1 200000); do echo "$i"; done | head -2`), the child prints its
own broken-pipe line and exits with its own status, so no command in the loop ever reports
`BrokenPipe`; because the pipeline is also serialized (below), that command prints the diagnosis and
then blocks — `timeout 8` around it measured `rc=124`, not the end of the stage. The patch therefore
ends the stages that **observed** the closure through `is_broken_pipe()`, which is the in-process half,
and the "never observed" half stays a declared engine gap (see the research section on the broken-pipe
writer and the corpus case `pipe-bundled-child-reports-own-status`).

Measured, with the toolchain on `PATH`:

| Form | Writer status | stderr |
|---|---|---|
| `printf "%.0sx" $(seq 1 20000) \| head -c 1` (in-process builtin) | **141** | empty |
| `seq 1 200000 \| head -1` (bundled child) | **0** | `brush.exe: write error: Broken pipe` |
| `cat <large file> \| head`, `ls -R / \| head` | 13, 1 | empty / permission noise plus `Broken pipe` |
| `yes \| head`, `node -e '…console.log…' \| head` | 0 | empty |
| `i=0; while [ $i -lt 5 ]; … done \| head -1` | 0 | empty (`head` receives `loop`) |
| the same loop with 200000 iterations | killed by a 5-second timeout (`rc=124`) | empty |

The last row is the half this patch does **not** fix, and it is a second consequence of having no fork:
`brush-shell/src/bundled.rs` already carries the TODO ("pipeline serialization") that a builtin stage
returns a *completed* command rather than a spawn handle, so an in-process stage runs to completion
before the next stage is even started; with both ends of the pipe living in that one process, the writer
can neither observe `BrokenPipe` (the read end is still open) nor be drained (the reader has not
started), and it blocks once the pipe buffer — 64 KiB here — is full. That blocking half is **closed** by
`0013`/`0014`, which start an in-process stage on its own thread.

The other half — a **child** process that reports a closed reader in its own words and picks its own exit
code — is a **declared gap**, and the research section on the broken-pipe writer records why it stays one:
the four bundled writers measured here answer `0` + a message (`seq`), `0` silently (`yes`), `13` (`cat`)
and `1` (`ls -R`), and each of those is a deliberate `cfg(windows)` branch in the utility itself. Closing
it would mean overriding that decision in a dozen crates, or growing a pump thread in front of every
bundled utility and racing the utility's own diagnostic.

### `0006-descriptor-paths.patch` — descriptor paths resolve against the shell's descriptors

`/dev/stdin`, `/dev/stdout`, `/dev/stderr`, `/dev/fd/N` and `/proc/self/fd/N` name *this process's*
descriptors, and a shell embedded in a larger host shares that process, so they have to resolve against
the shell's descriptors instead. The check for that already existed in `open_file` (and `0002` had moved
it ahead of `absolute_path`), yet not one of them worked on Windows, because both redirection call sites
called `Shell::absolute_path` *before* `open_file`: `/dev/stdout` became `D:\dev\stdout` and the
comparison could never match.

The patch does three things:

- both redirection sites now hand `open_file` the path as the script spelled it, leaving absolutization
  to `open_file` itself (the absolute form is still computed where it is needed, for the
  `disallow_overwriting_regular_files_via_output_redirection` check and for the error message);
- `DescriptorPath` is ported from oh-my-pi's vendored copy — `/dev/tty`, `/proc/self|thread-self|/<pid>/fd/N`
  in addition to the names upstream listed, and a Windows drive or UNC prefix is skipped so both
  spellings are recognized, which matters because there is more than one call site;
- `try_open_special_file` now tests "rooted and ending in `dev/null`" instead of `is_absolute()`: on
  Windows a root-relative path has no prefix, so passing the raw path would otherwise have regressed
  `> /dev/null` — the corpus case `fd-redirect-dev-null-is-a-sink` guards exactly that.

Measured, with the toolchain on `PATH`:

| Form | Before | After |
|---|---|---|
| `echo a > /dev/stdout`, `> /dev/fd/1`, `> /proc/self/fd/1` | `failed to redirect to D:/dev/stdout` | prints |
| `read x < /dev/stdin <<< hi` | same failure | `x=hi` |
| `while read l < /dev/fd/3; do …; done 3< file` | same failure | `got=a` |
| `wc -l 3< file < /dev/fd/3` | same failure | `2` (the `3<` has to come first, as in bash) |
| `ls /missing 2> /dev/stderr` | same failure | the error stays on stderr |
| `echo hi > /dev/null` | rc=0 | rc=0 (regression guarded) |
| `cat /dev/null`, `ls /dev/null`, `test -e /dev/null` | fails | still fails: a descriptor path is not a file a child can open |

The same patch changes what a child process receives. On Windows `inject_fds` used to refuse the whole
spawn when the command's descriptor table held anything beyond stdin/stdout/stderr, which broke
`cat < <(echo hi)` — a working form, since the redirect target is resolved *by the shell* and handed over
as stdin. It now drops what the child cannot receive, so the half of process substitution that works
keeps working:

| Form | Result |
|---|---|
| `read x < <(echo hi)`, `while read l; do …; done < <(printf …)` | works (in-process consumer) |
| `cat < <(echo hi)`, `wc -l < <(printf 'a\nb\n')`, `grep -c b < <(…)` | works (the shell resolves the target) |
| `cat <(echo hi)`, `diff <(a) <(b)`, `tee >(cat)` | fails on its own terms: the literal `/dev/fd/63` reaches a program that cannot open it. oh-my-pi's fork refuses this identically ("fd redirections beyond stdin/stdout/stderr on Windows"), because a Windows child process has no descriptor table to be handed one |
| `echo hi > >(cat)` | status 0 with no output: the write-side consumer is a shell task the exit can cut short (declared gap, not fixed here) |

### `0007-wait-selectors.patch` — `wait` reports the status of the job it waited for

Upstream's `wait` builtin implemented only "no arguments ⇒ wait for all" and `%spec`, and the spec path
threw the status away: `cmd.exe /c exit 4 & wait %1` returned **0**. `-n`, `-p` and a process ID were
`unimp`. This patch ports oh-my-pi's `pi-builtins/src/wait.rs` and adds the three things it needs from
the job manager, all of them in `jobs.rs`:

- `JobSelector` (`JobId` / `ProcessId`) and `WaitedJob` (job id, identifier, command line, result);
- `JobManager::{resolve_job_spec_selector, contains_process_id, resolve_process_id, wait_next}` — `wait_next`
  is a 10 ms poll loop, the same interval oh-my-pi uses, because the job table has nothing to await: a
  job is observed through `poll_done`, so "the next job to finish" is polled;
- `Job::{matches_selector, contains_process_id, wait_identifier}`, the last of which is what `-p` reports.

`brush-core`'s tokio dependency gains the `time` feature for that interval (both the wasm and the
unix/windows entry, so no target stops compiling).

The builtin differs from oh-my-pi's in one place on purpose: `wait_for_job` polls first and waits second,
because a job whose process already exited can still hold a result nobody collected, and waiting for its
tasks alone reports success for it. That is what makes `cmd.exe /c exit 9 & p=$!; sleep 0.3; wait $p`
report 9 instead of 0.

Measured against Git Bash (GNU bash 5.x) with `MSYS_NO_PATHCONV=1` so `cmd.exe /c` keeps its `/c`:

| Snippet | Git Bash | This engine |
|---|---|---|
| `cmd.exe /c exit 7 & p=$!; wait $p; echo rc=$?` | 7 | 7 |
| `cmd.exe /c exit 5 & wait -n; echo rc=$?` | 5 | 5 |
| `… & wait -n >/dev/null; wait -n; echo rc=$?` (nothing left to wait for) | 127 | 127 |
| `cmd.exe /c exit 4 & wait %1; echo rc=$?` | 4 | 4 (upstream silently said 0) |
| `cmd.exe /c exit 3 & p=$!; wait -n -p who` (`$who = $p`) | yes | yes |
| two PIDs: `wait $a $b` | the last one's status (6) | 6 |
| `wait 999999; echo rc=$?` | 127 plus "not a child of this shell" | same |
| `sleep 0.1 & wait -n; echo rc=$?` (builtin job, no PID) | 0 | 0 |

`-f` stays `unimp`, deliberately: this engine's `Job::wait` has one policy (a stopped job is reported as
`Stopped`, where oh-my-pi threads a `wait_for_terminate` flag through `JobTask::wait`), and Windows has
no job-control stop to tell apart, so the flag says so instead of pretending.

### `0008-windows-kill-builtin.patch` — a `kill` builtin, a signal vocabulary, and the status a killed child reports

Upstream's `brush-builtins/src/kill.rs` is complete — `-s`, `-n`, `-l`, BSD-style `-sigspec`, `%spec`
operands and `kill -0` — but it is cfg'd out of Windows in two places, its default signal is
`nix::sys::signal::Signal::SIGKILL`, and the Windows signal type is an **empty enum**, so nothing it
parses could work even if it were registered.

- the Windows `Signal` becomes 31 classic POSIX names whose `#[repr(i32)]` discriminants are their real
  numbers, `as_str` returns the `SIG`-prefixed spelling (so `kill -l` prints `1) SIGHUP`, as bash does),
  `from_str` takes either spelling, and `TryFrom<i32>` looks the number up. oh-my-pi's fork has only
  TERM/KILL/INT and its `TryFrom<i32>` always fails, which is why `kill -9` cannot work there
- `windows-sys` (0.59, already in the lock) backs `kill_process` = `OpenProcess(PROCESS_TERMINATE)` +
  `TerminateProcess(handle, 128 + n)` + `CloseHandle`, and `check_signalable` =
  `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` with `ERROR_INVALID_PARAMETER → NoSuchProcess` and
  anything else → `PermissionDenied`, mirroring the unix mapping of ESRCH/EPERM
- the Windows platform module re-exports those two publicly (they were `pub(crate)`, which is what kept
  the builtin unix-only), both the module declaration and the factory entry drop `, unix`, and the
  default signal becomes bash's `TERM` instead of `SIGKILL`
- a finished job is refused instead of signalled, because its process ID may already have been reused

No handle duplication, unlike oh-my-pi: their `ChildProcess` keeps (and duplicates) the process handle
because their Windows `kill_process` is a stub, while this one turns the child into a
`wait_with_output()` future at construction and keeps no handle, so addressing the process by ID is the
smaller equivalent. The pid-reuse window that opens is closed by the finished-job guard; keeping a handle
in `ChildProcess` is listed under the remaining candidates.

Measured against Git Bash (`MSYS_NO_PATHCONV=1` so `cmd.exe /c` keeps its `/c`):

| Snippet | Git Bash | This engine |
|---|---|---|
| `cmd.exe … & p=$!; kill "$p"; wait "$p"` | 143 | 143 |
| `kill -9` / `-INT` / `-HUP` | 137 / 130 / 129 | 137 / 130 / 129 |
| `kill %1` | 0 | 0 |
| `kill -l 15` / `kill -l TERM` | TERM / 15 | TERM / 15 |
| `kill -0 $$` | 0 | 0 |
| `kill 999999` / `kill -0 999999` | 1 + `No such process` | 1 + `no such process` |
| `kill` with no operand | 2 (usage) | 2 |
| `kill %9` | 1 + `no such job` | 1 + `no such job` |

One consequence worth stating: the builtin shadows the toolchain's `kill.exe`, so `kill` left
`TOOLCHAIN_COMMANDS` — the contract may not claim a `PATH` program that can never be reached.

### `0009-drive-mount-aliases.patch` — a single-letter first component is a drive mount

Git Bash and Cygwin mount every drive at `/<letter>`, so `/c/Windows/System32` is how their scripts spell a
system path; this engine resolved it against the current drive's root (`D:\c\Windows\System32`) and failed.
The patch adds the rule to the two seams `0002`/`0004` established — `sys::fs::normalize_shell_path` for what
the shell opens, `sys::fs::normalize_shell_arg` for what a child receives — and has `patterns.rs` ask the
same predicate (`sys::fs::drive_mount_root`), because pattern expansion builds its own root outside
`normalize_shell_path`.

Measured on this machine: `cd /c` → `C:\`, `cd /c/Windows` → `C:\Windows`,
`cd /c/Windows/System32/..` → `C:\Windows` (dot segments collapse before substitution, clamped at the
mount), `test -f /c/Windows/System32/drivers/etc/hosts` → 0, `printf '%s\n' /c/Windows/*.exe` expands to
`C:/Windows/…`, `node -e 'console.log(process.argv[1])' /c/Windows` → `C:\Windows`, and
`sort --output=/c/Windows/Temp/…` writes. Multi-letter roots are untouched (`echo /dev/null
/proc/self/fd/1 /usr/bin` prints as written), `/tmp` still wins the temporary-directory alias, and
`cat /dev/null` still fails as an argument.

**One deliberate divergence from Git Bash.** The corpus caught seven `silent-wrong` cases on the first build
of this patch: `cmd.exe /c exit 7` had its `/c` rewritten to `C:\`, so `cmd.exe` started interactively and
printed its banner. Git Bash has exactly the same footgun — which is why its users must set
`MSYS_NO_PATHCONV` before calling `cmd.exe /c`. The **argument** rule here therefore fires only when
something follows the mount (`/c/Windows` is rewritten, `/c` is not), while the **shell's own** resolution
has no such ambiguity (`cd /c` is always `C:\`), and an option's attached value (`--opt=/c`) is exempt
because it cannot be a switch. The contract states this, because a model cannot tell the difference and the
cost is a command silently changing mode.

**The same rewrite cannot tell a path from a script** (found in review, section 37 of `docs/research.md`).
An argument that *starts* `/<letter>/` is rewritten whether or not it names a path, so a program's script
operand goes with it: `awk '/x/{print}'` reaches awk as `X:\{print}` and fails on the program text, and
`sed '/x/d'` reports ``invalid command code `X'``. A pattern spelled as a bare mount survives
(`grep -e '/x/'`), because that form is never rewritten. MSYS behaves the same way for a native program —
its own `sed` and `awk` are MSYS-linked, which is why Git Bash never shows this — and the escape hatch is
the `/tmp` patch's: `DSH_BASH_NATIVE_NO_PATHCONV=1`. The corpus records both failing shapes as platform
differences (`platform-drive-mount-hits-a-script-operand`, `platform-drive-mount-hits-awk-program-text`)
and pins the hatch as `must-match` (`platform-drive-mount-script-operand-escape-hatch`); the contract
states the boundary and the rewrite that avoids it (`awk '$0 ~ /x/'`).

### `0010-missing-builtins.patch` — the builtins a script expects, and what each one can honestly mean

Four builtins a script reaches for were either gated off or stubbed: `umask` and `ulimit` behind
`cfg(all(feature = "builtin.X", unix))`, `disown` behind `TODO(disown)` plus `UnimplementedCommand`, and
`wait -f` behind an `unimp` return. Three of them can mean something exact here, and one cannot.

- **`umask`**: Windows has no POSIX permission model, so no creation call consults a mask and a new file's
  access comes from its parent's ACL. The Windows branch remembers the value in an `AtomicU32` and reports
  it, which is what a script that reads `umask`, or sets one before creating files, is doing. Measured
  against Git Bash: `umask` → `0022`, `umask -S` → `u=rwx,g=rx,o=rx`, `umask 077; umask` → `0077`. The
  patch comment and the plugin's documentation both say it changes nothing about what the platform grants.
- **`history`**: bash answers nothing and returns 0 in a shell without history; this engine returned
  `HistoryNotEnabled`, a failure a script could not distinguish from a real error. It now answers nothing
  and returns 0.
- **`disown`**: a real builtin now (`%spec`, a pid, no argument for the current job, `-a`, `-r`, `-h`),
  removing entries from the public `JobManager.jobs` vector. The premise that makes it honest is
  `CreateOptions::kill_external_commands_on_drop`, which defaults to `false` ("children outlive the shell,
  as a real shell requires"): dropping the shell's handle does not terminate the child, so a disowned job
  leaves the table and keeps running — the state bash leaves behind. Had the default been `true`, removal
  would have killed the process and this builtin should not have been written. Verified with an external
  child: `rc=0`, zero rows from `jobs`, and `kill -0 $!` still succeeding.
- **`wait -f`**: `WaitCommand` parsed the flag and returned `unimp`. This engine has one wait policy, and
  it already waits for a job's tasks to finish; "terminated" and "changed status" differ only for a job
  that *stops*, which needs job control this engine does not implement. Taking the existing path is
  therefore exact, and `wait -f <pid>` reports the child's own status (`cmd.exe /c exit 7` → `rc=7`), with
  an unknown pid refused exactly as bash refuses it (`is not a child of this shell`, `rc=127`).
- **`ulimit` deliberately stays out.** Its resource table is typed directly on `rlimit::Resource`, and both
  `rlimit` and `nix` are `[target.'cfg(unix)'.dependencies]`: the crate does not exist on Windows. What it
  needs is a platform abstraction of the table (a neutral resource enum plus two get/set pairs) and a
  compatibility value to report, since Windows has no such limits. Git Bash's reference values are recorded
  for that work: `ulimit -n` → `3200`, `ulimit -c` → `0`, `ulimit -a` → a table. It stays declared as
  missing in the contract, which keeps the claim true.

### `0011-crlf-script-text.patch` — a Windows-authored script is text, so its carriage returns go

A script written on Windows separates its lines with CRLF, and this parser takes the line feed as the
line ending, so the carriage return becomes an ordinary character at the end of the line's last token.
Measured on this pin against Git Bash 5.x, on the same files, before the patch:

| Shape | This engine (before) | Git Bash |
|---|---|---|
| `echo one` / `echo two` | `one\r` and `two\r`, status 0 | `one`, `two` |
| `echo sink > /dev/null` | the redirect fails on `null\r`, the file is not written, and the command still exits **0** | status 0, the redirect happens |
| `mkdir -p /tmp/x` (path operand) | `cannot create directory '…x\r'`, status 2 | status 0 |
| `if [ "$x" = 1 ]; then` | `syntax error at end of input`, status 2 | status 0 |
| `f() {` | `syntax error at line 1 col 5`, status 2 | status 0 |
| `(echo one` … `)` | `syntax error at line 2 col 10`, status 2 | status 0 |
| `echo one \` + newline | `command not found: two\r`, status 127 | `one two` |
| a here-document body | the body lines keep the carriage return | the body lines do not |
| a `-c` string, `eval`, `source` | the same shapes as above | unaffected |

The two silent ones are why this is a patch rather than a README note: **a redirect that does not happen
while the command reports success** is the class this project treats as worst, and it appears on every
line of every script a Windows tool wrote (PowerShell `>`, `cmd /c echo >`, Notepad, or a checkout whose
`core.autocrlf` added them). A whole CRLF script is unusable: an `if`, a function and a subshell all fail
to parse.

**Where the fix goes.** `brush-core/src/shell/parsing.rs::create_parser` is the one place both text paths
meet: `parse_string` (the `-c` string, `eval`, command substitution) hands it `s.as_bytes()`, and
`parse` hands it a reader. `source_file` in `brush-core/src/shell/execution.rs` was building a
`brush_parser::Parser` by hand instead, so it did not pass through `create_parser` at all — calling
`create_parser` there is the second half of this patch and the only reason `source` and script files are
covered. The parser itself is untouched: its grammar's newline rule, its snapshot tests and the
`brush-parser` crate stay as upstream wrote them.

**The rule is "remove every carriage return", not "treat CRLF as a line ending".** Git Bash reads the
file in text mode, so a carriage return is not part of a script's characters at all: it drops a lone `\r`
at end of input, a `\r` in the middle of a line and a `\r` inside quotes just as it drops the one before
a line feed (all four measured). Removing every one of them is also what keeps the filter stateless — no
lookahead, so a boundary between two reads cannot change the result, and a read that returns nothing but
carriage returns has to read again instead of reporting end of input. Both properties are pinned by unit
tests in the patch. What a *program* turns into a carriage return is unaffected, because that comes from
an escape sequence in the program text rather than from the text itself: `printf 'a\r\nb' | wc -c` is
still 4, and a file read as data keeps its carriage returns (`cat crlf-data.txt | wc -c` is 4). Ten
corpus cases (`crlf-*`) pin the table above and all three boundaries.

### `0012-relative-command-paths.patch` — a relative command runs beside the script

**Symptom.** `./tool` and `sub/dir/tool` report `command not found`, while the same file runs when the path
is absolute. Measured on the shipped artifact, from `D:\Pi\dsh_plugins\dsh-bash-native`:

| Command word | Before | After |
|---|---|---|
| `./toolchain/win32-x64/find.exe --version` | `command not found: ./toolchain/win32-x64/find.exe` | `find (Rust) 0.10.0` |
| `toolchain/win32-x64/find.exe --version` | `command not found: …` | `find (Rust) 0.10.0` |
| `./nope` (absent) | `command not found: ./nope` | `command not found: ./nope` — the text the caller wrote, not the joined path |
| `find --version` (no separator) | resolves on `PATH` | unchanged |

**Root cause (measured, then read).** `brush-core/src/commands.rs::compose_std_command` builds
`std::process::Command::new(&converted_name)` from the path the caller wrote, and the operating system
resolves a relative *image* path against **the process's** current directory. This shell never changes that
one: `cd` moves `shell.working_dir()`, which is handed to each child as `cmd.current_dir(…)`, so the child's
directory is right while the lookup that finds the child happens from wherever the engine was started. The
experiment that separates the two: with the process's start directory as the base the same relative path
runs; after `cd dsh-bash-native` it does not, and in that very command `cmd.exe /c cd` reports the child's
directory as the shell's.

**Fix.** When the alias-normalized program path has no root *and* contains a separator, join it with
`context.shell.working_dir()` before handing it to `Command`. A name without a separator keeps its meaning
(the OS searches `PATH` for it, which is also what `exec` relies on), and the test is `has_root` rather than
`is_absolute` because a rooted path such as `/usr/bin/x` is drive-relative on Windows and keeps that
meaning. One function covers both callers: `execute_external_command` and the `exec` builtin.

**Not covered.** Running a *script* by path still needs an interpreter program: this package installs no
`bash`/`sh` name, so `./script.sh` and a `#!/usr/bin/env bash` shebang remain unavailable (`. ./script.sh`
works). That is a separate gap, not a side effect of the resolution rule.

### `0013-compound-pipeline-stage-concurrency.patch` — an in-process stage runs on its own thread

**Symptom.** A non-last pipeline stage that is a compound command never finishes when its output exceeds the
pipe buffer, because its reader does not exist yet. Measured with `timeout 10 <engine> -c …` (124 = still
blocked):

| Stage | Before | After |
|---|---|---|
| `seq 1 200000` (external) | 0 | 0 |
| `cat big.txt` (bundled utility) | 0 | 0 |
| `{ cat big.txt; }` | **124** | 0 |
| `for i in $(seq 1 20000); do echo x; done` | **124** | 0 |
| `while read -r l; do echo "$l"; done < big.txt` | **124** | 0 |
| `if true; then cat big.txt; fi` | **124** | 0 |
| `( cat big.txt )` | **124** | 0 |

**Root cause (read, then measured).** `brush-core/src/interp.rs::spawn_pipeline_processes` starts every
stage of a multi-command pipeline before waiting for any of them, and two of the three stage kinds return
immediately: an external command hands back a child process, and a simple command whose builtin runs in a
cloned shell hands back a `spawn_blocking` task. `ExecuteInPipeline for ast::Command` awaited `Compound` and
`Function` **inline** instead, so the loop reached the reader only after the writer had finished — and a
writer that fills the buffer (64 KiB here) with nobody reading blocks forever.

**Fix.** `run_stage_concurrently` moves the stage's own shell onto a blocking thread and returns
`StartedTask`, exactly the shape `execute_via_builtin_in_owned_shell` already used for a builtin. The
`ParentShell` arm stays inline: a single-command pipeline and `lastpipe`'s last stage have to run in the
shell that owns them, and the semantics that shows are unchanged (measured: `echo hello | read v` leaves `v`
empty, `shopt -s lastpipe` sets it to `hello`).

### `0014-function-call-stage-concurrency.patch` — the same rule for a function call

`0013` covered a compound command *as* a stage. A function **call** is a simple command that resolves to a
function, and `commands.rs::Command::execute` ran that body inline for the same reason — measured after
`0013`, `f() { cat big.txt; }; f | head -1` was still `124`, while `g() { echo hi; }; { g; } | head -1` was 0.

**Fix.** The function branch of `Command::execute` mirrors the builtin branch: an owned shell becomes a task
(`execute_via_function_in_owned_shell`), a parent shell still runs inline. The body's own spawn result is
awaited inside the task, because a function may end in an external command and the pipeline waits on one
handle per stage. Measured after: every shape in the table above, plus `f() { …; }; f | head -1` and a
function called inside a brace group, returns 0, and a function as `lastpipe`'s last stage still mutates the
parent shell.

### `0015-trailing-slash-requires-directory.patch` — a trailing separator has to mean a directory

`*/` is bash's "the directories here": a pattern whose last component is a separator matches directories
only, and a pattern matching none stays literal. Measured on the volume this project's workspace lives on,
`echo */` in a directory holding `mydir/`, `note.md`, `plain.txt` and `sub/` printed
`mydir/ note.md/ plain.txt/ sub/` — every entry, files included, each with the separator already appended —
and `echo *.md/` invented `note.md/` where bash prints the pattern unchanged. The same tree under `%TEMP%`
behaved correctly, and that difference is the whole story.

**Root cause.** The rule was delegated to the file system. `Pattern::expand` splits `*/` into a glob component
and a trailing **empty** component; `push_path_for_pattern` appends the separator; and the literal branch kept
a candidate when `symlink_metadata("note.md/")` succeeded — the comment right there claimed the trailing slash
"makes lstat fail with ENOTDIR for a regular file". That holds on Unix and on some Windows volumes (the system
volume refuses `file/` with `ERROR_DIRECTORY`, 267: `stat note.md/` fails there), but whether a volume rejects
a trailing separator on a regular file is a property of the **volume**, not of the platform: on the volume
this project is developed on, `stat note.md/` reports a regular file and `[ -e note.md/ ]` succeeds. Reaching
the same data through a `C:`-pathed junction to a `D:` target stayed lenient, so the property travels with the
volume rather than with the path prefix. The consequence is the worst kind: on such a volume the pattern
silently means "every entry", and the same leniency lets `rm -r file/` delete the file.

**Fix.** A separator-only component is now checked explicitly: `p.is_dir()`. `is_dir` follows symlinks, which
is what bash does for `dir/` — a symlink to a directory matches, a dangling one does not. The non-empty branch
keeps `symlink_metadata().is_ok()`, because a literal like `*/link.txt` must still match a dangling symlink
(bash matches on directory-entry existence).

Measured after, same tree, same volume:

| snippet | before | after | bash |
|---|---|---|---|
| `echo */` | `mydir/ note.md/ plain.txt/ sub/` | `mydir/ sub/` | `mydir/ sub/` |
| `echo *.md/` | `note.md/` | `*.md/` | `*.md/` |
| `shopt -s nullglob; echo *.md/` | `note.md/` | (empty) | (empty) |
| `shopt -s failglob; echo *.md/` | `note.md/` | `error: no match: *.md/` | error |

Two limits on that evidence, recorded so the case is not mistaken for more than it is. **The corpus case
`glob-trailing-slash-requires-directory` cannot fail on a volume that refuses `file/`**, and the corpus always
runs under `%TEMP%`: it pins the rule on a lenient volume (this project's own, where the bug was reported) and
passes trivially elsewhere. **The symlink shapes were not measurable here** — creating one needs
`SeCreateSymbolicLinkPrivilege`, which the confined shell does not hold (`failed to create symbolic link …`),
so the symlink half of `is_dir` follows bash by construction and belongs in the cross-check rather than in the
suite.

### `0016-bundled-name-dispatch.patch` — the engine answers to the utility names it carries

A bundled utility is registered as a brush builtin that re-enters the engine as
`brush --invoke-bundled <name>`. That reaches the prompt and nothing else: a child process cannot exec a
builtin, so `xargs rm`, `find . -exec rm {} +` and any other program that spawns `rm` by name could only find
one on `PATH` — which is why the toolchain used to carry a second copy of every one of the 75 utilities the
engine bundles, each of them its own artefact to patch. Measured before the patch:
`printf 'rm\n' | xargs which` answered `…\toolchain\<manifest digest>\bin\rm.exe`, and that copy deleted
`note.md/`.

**Fix.** `maybe_dispatch` also dispatches on the executable's own file stem: a process named `rm.exe` runs the
registered `rm` with the remaining arguments, and `argv[0]` is the bundled name so the utility reports itself
as `rm`. The registry is the gate — `brush`, `bash` and `sh` are not registered, so a copy of the engine under
any other name is still a shell — and the explicit dispatch flag still wins, so the shell's own path is
unchanged.

**What it buys.** The plugin's shim directory publishes the bundled names as hard links to the engine, so one
implementation answers both the prompt and a child process, and `scripts/build-toolchain.mjs` stops publishing
the 75 duplicates (`BUILT_IN_UTILITIES`), which is what retires the second `rm`. Measured after:
`./rm.exe --version` → `rm (uutils coreutils) 0.12.0`, `./cat.exe --version` → `cat (uutils coreutils) 0.12.0`,
`./mybrush.exe -c 'echo shell-ok'` → `shell-ok`, the shim holds 77 names, and the farm's directory holds 28
instead of 103.

**A bug found while measuring, and fixed here.** The first draft consumed the process's second argument in the
flag check and never passed it on, so `./rm.exe -r adir/` ran `rm adir/` (`cannot remove 'adir/': Is a
directory`) and `./rm.exe --version` reported a missing operand. The battery for this patch therefore runs
every direct form — `--version`, `-r dir/`, a refusal, and a mixed command — and not only the refusal.

### `0017-rm-refuses-a-trailing-separator-on-a-file.patch` — the rule the platform owes `rm`

A path ending in a separator has to name a directory. POSIX gives that rule to the kernel: `unlink("file/")`
fails with `ENOTDIR` and `rm` reports it. Windows does not, and — measured here — whether a volume refuses a
trailing separator at all is a property of the **volume**: the system volume answers `ERROR_DIRECTORY` (267)
for `stat note.md/`, while the volume this project lives on reports a regular file and lets `rm -r file/`
delete it. The `*/` bug of `0015` is the same leniency seen from the pattern side.

**Fix.** The registry entry for `rm` is wrapped: operands are scanned before the utility runs, and one whose
text ends with a separator while `is_dir()` says otherwise is reported as
`rm: cannot remove '<operand>': Not a directory`, dropped from the argv, and turned into exit status 1 even
when the remaining operands succeed — GNU's behaviour for the same command. A command consisting only of
refused operands never reaches the utility, because it would add a "missing operand" complaint GNU does not
print; `\` counts as a separator on Windows only.

**Why here rather than inside `uu_rm`.** The rule belongs to the platform layer the engine already replaces
for `/tmp` and drive mounts, and applying it at registration keeps one implementation of `rm` instead of a
vendored copy of another crate to keep in step with `uucore`. Measured: `rm -r file.txt/` → rc 1, file kept;
`rm -r adir/` → rc 0, directory gone; `rm -r file.txt/ ok.txt` → rc 1 with `ok.txt` removed and `file.txt`
kept; `rm -f file.txt/` refuses as GNU does.

### `0018-host-env-survives-non-unicode.patch` — one undecodable variable no longer costs every command

A Windows environment block is UTF-16 and Windows does not require it to be well-formed: a launcher that
fills the block from a byte string can put an unpaired surrogate in a name or a value.
`brush-core/src/sys/windows/env.rs` read that block with `std::env::vars()`, which panics on the first entry
it cannot decode.

**Why it costs the whole shell rather than one variable.** The read happens while the shell is being built:
`brush-core/src/shell.rs:239` calls `wellknownvars::inherit_env_vars` from the constructor, so the panic
lands before the first command is parsed. Measured on the shipped engine, with the variable staged by
PowerShell:

| Run | Before `0018` | After `0018` |
|---|---|---|
| `brush.exe --disable-color --noprofile --norc -c "echo alive"`, one undecodable value in the environment | `brush had a problem and crashed`, exit **-1073740791** (`0xC0000409`) | `alive`, exit **0** |
| the same run with a well-formed variable beside it | — | `good=[kept] bad=[unset]` |
| `brush.exe --version` | exit **0** | exit **0** |

**The third row is why this shipped.** The plugin's engine check runs `--version`, which never creates a
shell, so a host carrying one such variable passed verification and then aborted every command. The corpus
could not have caught it either: every case runs with a clean environment.

**Fix.** `get_host_env_vars` now reads `std::env::vars_os()` and filters through a new `decode_host_env`,
which keeps an entry only when both its name and its value are valid Unicode. Dropping is the deliberate
choice — an unpaired surrogate has no `String` representation, and rewriting it with `U+FFFD` would turn
"this entry is unusable" into a plausible wrong path. A dropped `PATH` costs the shell the host's search
path and still runs every command; an abort costs it all of them.

**Tests.** `decode_host_env` takes `(OsString, OsString)` as a free function precisely so its input can be
constructed: a unit test in the same file injects `OsString::from_wide(&[0xD800, …])` as the key and again
as the value, and `test-e2e-engine.mjs` case 8 runs a real command with the variable set. That case stages
it through PowerShell, because Node normalizes a lone surrogate away before the child's environment block is
built — measured: the same `spawnSync` with the `env` option pointed at the **pre-patch** engine exits 0, so
that shape cannot produce this input at all.

**Not covered.** `brush-core/src/sys/unix/env.rs:7` calls the same `std::env::vars()` and is left alone: this
package ships a `win32-x64` engine only, so a Unix change here could not be measured. oh-my-pi's fix
(`46f31296a`) is the mirror image — it patched the Unix copy and left the Windows one calling `vars()`.

### `0019-windows-long-path-identity.patch` — one directory, one spelling

Windows keeps a second, 8.3 name for most directories, so one place has two spellings:
`C:\Users\EXAMPL~1\AppData\Local\Temp` and `C:\Users\Example\AppData\Local\Temp` name the same
directory. Measured on this machine, before the patch:

| Command | `$PWD` afterwards |
|---|---|
| `cd "C:/Users/Example/AppData/Local/Temp/dsh-ONtwLL"` | `C:\Users\Example\AppData\Local\Temp\dsh-ONtwLL` |
| `cd /tmp` | `C:\Users\EXAMPL~1\AppData\Local\Temp\dsh-ONtwLL` |
| `cd "$TEMP"` | `C:\Users\EXAMPL~1\AppData\Local\Temp\dsh-ONtwLL` |
| `pwd -P` in all three | the same directory |

The short spelling is not something a script asked for — it is what the host reports. Two of those rows
name one directory and compare unequal, so a script that records a directory one way and looks it up the
other way sees two places.

**Fix, at every entry point that stores a path.** `brush-core/src/sys/fs.rs` gains
`expand_to_long_path`, and the four places that write a shell path through it are:

* `brush-core/src/shell.rs:223` — the initial working directory. `std::env::current_dir()` reports
  whatever spelling the process was started with.
* `brush-core/src/shell/fs.rs` (`set_working_dir`) — every `cd`, after the existing `normalize()` and
  not instead of it.
* `brush-core/src/sys/windows/env.rs` — `TEMP`, `TMP` and `TMPDIR`, and only those: they are the names the
  engine itself resolves paths against, and `PATH` keeps exactly the value the host set.
* `brush-core/src/sys/fs.rs` — the temporary directory `/tmp` resolves through (`long_temp_dir`), used by
  both `normalize_shell_path` and `normalize_shell_arg`. Without this one the alias and `$TEMP` would be
  two spellings again, one call apart.

oh-my-pi's own fix (`eaa7fd1c`, `3ff57384`, tightened in `843a3609` — see "The port, in oh-my-pi's own
code") needed more than one commit for the same reason, which is why the invariant here is stated as
"every entry point that stores a path" rather than as a list of call sites.

**Why `GetLongPathNameW` and not `canonicalize`.** `canonicalize` resolves symlinks and junctions and
prefixes the result with `\\?\`. Expanding a spelling must not change which file the path names, and a `cd`
into a symlinked directory has to keep the spelling the script used. The Win32 query answers only for a
path that exists: a name that is not there, a volume with 8.3 generation disabled, and a query that fails
all come back unchanged, which is what every call site did before. A relative path is refused outright,
because the query would resolve it against the current directory and turn a relative path into an absolute
one. The `windows-sys` feature this needs (`Win32_Storage_FileSystem`) is added to the line `0008`
created; `0020` reuses it.

**Measured after.** All four rows above report `C:\Users\Example\AppData\Local\Temp\dsh-ONtwLL`,
`$TEMP` and `$TMPDIR` included, and the corpus is unchanged (`112/190`, `fail 0`, `silent-wrong 0`,
`known-gap 4`, `collision 11`, `skip 57`).

**Not covered.** `get_short_path` (`GetShortPathNameW`) is not ported. oh-my-pi added it to match a `~`
abbreviation component by component in its TUI, and this repository has no consumer for it.

### `0020-windows-file-identity.patch` — the file identity `test -ef` was missing

`[[ a -ef b ]]` is `stat` on Unix: two paths name one file when they resolve to the same `(device, inode)`.
This engine had no Windows equivalent, so every form of the operator — a file against itself included —
answered `error: operation not supported on this platform: get_device_and_inode` and exited 1.

**Fix.** The `// TODO(windows): implement using file index / volume serial number` in
`brush-core/src/sys/windows/fs.rs` becomes that implementation. `GetFileInformationByHandle` answers
`dwVolumeSerialNumber` and the 64-bit file index, which is the `(st_dev, st_ino)` pair, and the handle is
opened with `access_mode(0)` and `FILE_FLAG_BACKUP_SEMANTICS`:

* `access_mode(0)` asks for no access rights at all, so a file the caller may not read can still be
  identified — and a directory can be opened this way at all.
* `FILE_FLAG_BACKUP_SEMANTICS` is what lets the handle name a **directory**, which the operator supports.
* `FILE_FLAG_OPEN_REPARSE_POINT` is deliberately **absent**: Unix `-ef` goes through `metadata()`, which
  follows a symlink, so this has to follow one too.

It reuses the `Win32_Storage_FileSystem` feature `0019` added to `brush-core/Cargo.toml`.

**A zero file index is a refusal, not an identity.** A filesystem that cannot supply one reports zero, and
returning `(volume, 0)` would make two unidentified files compare equal — turning "this cannot be answered"
into a wrong answer. The patch keeps the loud `NotSupportedOnThisPlatform` error for that case instead.

**Measured before and after.** The first four rows are corpus cases; the hard link and the
identical-bytes row are `test-e2e-engine.mjs` case 10, because a corpus case can only write file contents.

| Snippet | Before | After |
|---|---|---|
| `[[ a.txt -ef a.txt ]]` | error, 1 | **0** |
| `[[ a.txt -ef b.txt ]]`, different bytes | error, 1 | **1** |
| `[[ a.txt -ef b.txt ]]`, identical bytes | error, 1 | **1** |
| `[[ d -ef ./d ]]`, a directory | error, 1 | **0** |
| `ln a.txt hard.txt; [[ a.txt -ef hard.txt ]]` | error, 1 | **0** |
| `[[ a.txt -ef absent.txt ]]` | error, 1 | **1**, and nothing on stderr |

The hard link is the shape that separates identity from everything else a wrong implementation could have
reached for: two path strings that differ, one file. The identical-bytes row is its mirror — two path
strings that differ and two files — so a content digest answers it wrongly.

**Coverage.** The corpus had **no** case for `-ef` at all, which is how the operator stayed unimplemented.
`test-ef-same-file`, `test-ef-different-files`, `test-ef-absent-operand` and `test-ef-directory` are new,
and both baselines were re-recorded: engine-only **116/194**, with the toolchain **181/194**, `fail 0`,
`silent-wrong 0` in both.

## The last gap: a background job the shell registers no process for

`sleep 30 & p=$!` gives an empty `$!`. An external command now works, because
`0001-background-job-pid.patch` spawns the pipeline directly and the job carries real children. The
bundled set is **not** the case this section used to describe: `sleep`, `cat` and the rest are *shim*
builtins (see `0004`), so the call does start a child — `brush --invoke-bundled <name>` — and what is
missing is the registration, not the process. A true in-process builtin (`echo`), a function and a
compound command have no child at all, so for those there is nothing whose PID could be reported.

What "fixing" it would cost, and why the cheap versions are refused:

* **Report a synthetic number** — `$!` must name a process `kill $p` can actually signal. Inventing a
  number would make `kill` hit an unrelated process, which is worse than an empty value.
* **Spawn a child engine for the builtin** (`brush -c '<command>'`) — the PID would be real and
  killable, but the child is a *fresh* shell that sees exported variables and nothing else. bash forks,
  so `x=1; { echo "$x"; } &` prints `1`; the child-engine version prints an empty line. That is a silent
  wrong answer, which this project treats as worse than a declared gap.
* **Tie the child a bundled shim already starts to the job** — the separate route the measurement above
  opens, and *not* the previous bullet: that child runs the very utility the job asked for, so its PID is
  the one `kill` should signal, and the work would be in the job registry rather than in a fresh shell.
  Whether the engine can register it is **not measured**; this section does not settle it.
* **Emulate the fork faithfully** — a child engine seeded with a snapshot of the parent's shell state
  (variables, functions, options, traps, cwd) would be close, and brush-core already carries a `serde`
  feature that might make a snapshot possible. Whether the shell state is serializable is **not
  verified**; this is the only honest route to the gap, and it is a research spike rather than a patch.

Oh-my-pi has not solved it either. Its `interp.rs` commits since June 2026 are the virtual filesystem
(`8b984d7a`), descriptor paths (`d2c72b21`), streaming output (`12591dbd`), a builtins compatibility
sweep (`edc0caeb`), two refactors, and a spawn observer (`126e3adf`) that only observes *external*
spawns — none of them gives a builtin background job a PID. Their `$!` fix takes the same shape as
ours, so the same limit follows.

Consequences, stated rather than hidden:

* FULL mode as the corpus defines it — failures, skips, collisions, gaps and drift all zero — is **not
  reachable on this engine family** while gaps are declared. The corpus carries two (`known-gap`): this
  one and the broken-pipe status, and the criterion is not redefined to make the number green.
* A user who needs full POSIX background semantics has an engine for it: `git-bash`, `msys2`, `cygwin`
  and `wsl` fork properly, at the cost the README's tier matrix already documents (the native engines
  are the ones that can run confined).

### Worth taking from oh-my-pi when the fd paths are next touched

`d2c72b21` is the mature shape of two problems this project only partly has:

* `openfiles::DescriptorPath` — one grammar for `/dev/stdin`, `/dev/stdout`, `/dev/stderr`,
  `/dev/fd/N`, `/proc/self/fd/N` and `/dev/tty`, resolved in `Shell::open_file` against the command's
  fd table rather than the host process's. Our `0002-unix-tmp-alias.patch` only moves the check ahead
  of absolutization, which covers the shell's own redirections but not this grammar.
* `pi-builtins` routes **every operand** through `ShellPaths`. That is their answer to "a builtin that
  resolves a path operand itself does not see the shell's path rewriting", and their commit message is
  explicit that it replaced an earlier argv pre-pass. We did not need it for the bundled utilities:
  `0004-external-argv-tmp-alias.patch` translates arguments at the spawn boundary, and the bundled set
  goes through that boundary because each name is a shim that re-enters this binary. It becomes
  relevant only if an in-process builtin is ever added that resolves paths itself.

## Remaining candidates, in value order

1. **Pipeline parallelism for in-process stages — landed as `0013` + `0014`.** This entry used to name
   `brush-shell/src/bundled.rs` (TODO "pipeline serialization") as the cause; the measurement says
   otherwise. A bundled utility is a `--invoke-bundled` child process (`0004`), so `cat big | head -1`
   already returned 0 while `{ cat big; } | head -1`, a `for` loop, a `while read` loop, an `if` clause, a
   subshell and a function call each blocked forever. What those have in common is not a missing fork but a
   stage that executes *in this process*, which `run_stage_concurrently` now moves onto a blocking thread.
2. **Await process-substitution tasks before exiting** — the write side of `>(cmd)` is a `tokio::spawn`ed
   task whose handle is dropped, so `echo hi > >(cat)` exits 0 and prints nothing (measured; the third
   declared gap). It cannot simply join the `jobs` list, because a `&` background job must *not* be
   awaited at exit, so the substitution tasks need to be distinguishable.
3. **Child creation flags** — `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` on every external spawn
   (`sys/tokio_process.rs`), so a child cannot change the host console codepage.
4. **`jobs -l`** — upstream returns `unimp`; oh-my-pi's `jobs.rs` shows the intended line format.
5. **8.3 short-name identity — landed as `0019`.** `GetLongPathNameW` for the initial working directory,
   for `cd`, for `TEMP`/`TMP`/`TMPDIR`, and for the temporary directory `/tmp` resolves through. oh-my-pi
   needed more than one commit for the same thing, which is why the invariant is "every entry point that
   stores a path" rather than a list of call sites.
6. **`/dev/null` as an argument — measured and rejected.** The alias mechanism is right there (`sys::fs`
   maps `/tmp` per `0004`), so mapping an argument's `/dev/null` onto `NUL` was implemented and measured.
   It swaps one error for another, program by program: `wc -c NUL`, `od -c NUL`, `sort NUL`, `nl NUL`,
   `uniq NUL`, `tac NUL` and `sha256sum NUL` open the device, while `cat NUL`, `cp NUL`, `head -1 NUL` and
   `tail -1 NUL` fail with `函数不正确` (ERROR_INVALID_FUNCTION, from opening a character device the way
   those utilities do), and a native program such as Node cannot open it at all. Git Bash hands native
   children the spelling `nul` for the same reason, and its own `cat /dev/null` works only because the
   MSYS C runtime special-cases the device. Since `cat /dev/null` is the common form and still fails, the
   alias would replace a clear "path not found" with a program-dependent mix, so it does not ship; the
   contract instead tells the reader that a sink belongs in a redirection.
7. **`ulimit` on Windows — measured, and decided against; the gap stays declared.** Its resource table is
   typed on `rlimit::Resource` and both `rlimit` and `nix` are Unix-only dependencies, so this is a
   platform abstraction of the table rather than a cfg flip; `0010` therefore left the command declared as
   missing instead of shipping a number that means nothing. oh-my-pi's current state is the same answer
   from the other direction: `crates/pi-builtins/src/lib.rs:97` declares `#[cfg(all(feature =
   "builtin.ulimit", unix))] mod ulimit;`, so it does not exist on Windows there either, and their
   vendored `brush-core/src/rlimits.rs` keeps the limits as shell state behind `#[cfg(unix)]` — off Unix
   `ResourceLimits` is a fieldless struct with no methods. That design (`ebf2a2aa966c`, 2026-09-28, "kept
   ulimit off the host process's own rlimits") exists precisely because the shell runs inside its host
   process and must never call `setrlimit` on it. Windows has no `setrlimit` for such a table to act on, so
   a compatibility table (`-n` → `3200`, `-c` → `0`, `-a` → a few lines, matching Git Bash on this machine)
   would be the whole feature — a number a script could only misread. `docs/manual.md` states the absence,
   and the corpus has no `ulimit` case because a command that does not exist cannot be scored.
8. **Keep a process handle in `ChildProcess`** — oh-my-pi duplicates one per external task so `kill %1`
   terminates exactly the process it started; here the process is addressed by ID with a finished-job
   guard instead (see `0008`), which closes the same window from the other side. Worth doing if a job
   ever has to be signalled after its ID could have been reused.
9. **Multi-target `kill` — measured, then deliberately left undone.** Upstream's operand loop in
   `brush-builtins/src/kill.rs` keeps one `pid_or_job_spec` and refuses a second with `too many jobs or
   processes specified` (status 2); Git Bash accepts several. The patch would be small — take a vector,
   signal each target, keep going after a failure, and aggregate the status — but it would **not** buy the
   idiom that motivates it: `kill $(jobs -p)` is blocked by the empty job table inside a command
   substitution (see the README's "Known limitations"), so the substitution still yields nothing. The
   failure is loud, and `job_kill` covers DSH's own background work, so the corpus records today's
   behaviour instead (`process-kill-refuses-several-targets`, `process-kill-one-target`). Measured
   against Git Bash 5.x, for whoever does take it:

   | Snippet | Git Bash | This engine |
   |---|---|---|
   | `kill %1 %2` (both alive) | 0, both killed | 2, neither signalled |
   | `kill "$good" 999999` | **0** (the good one is killed, one error line) | 2 |
   | `kill 999998 999999` | **1**, two error lines | 2 |
   | `kill -0 $$ 999999` | 0 | 2 |

   That is: failures do not stop the loop, each failing target prints its own message, and the status is
   0 whenever at least one target was signalled.

Do not adopt `$?` = `128 + signal`: on Windows a terminated child reports exit status 1
(`processes.rs` only computes `128 + N` under `cfg(unix)`), so neither the contract nor the tests may
claim 143/137.
