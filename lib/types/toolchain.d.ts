/**
 * The POSIX toolchain directory this plugin puts ahead of the Windows `PATH`.
 *
 * The engine alone provides around 75 in-process utilities but not `grep`, `sed`, `awk`, `find`,
 * `xargs`, `diff` or `which`. A separate directory supplies those as ordinary programs, which is also
 * the only way `xargs` and `find -exec` can invoke them at all — a child process cannot exec a shell
 * builtin. Two facts make this directory worth probing instead of assuming: it may be absent, and
 * every name in it shadows a Windows program of the same name (`find.exe` searches text,
 * `timeout.exe` waits for a keypress), so a partial install changes what the model must be told.
 * @module dsh-bash-native/toolchain
 */
/** The filesystem questions this module asks, injected so probing stays pure. */
export interface ToolchainFs {
    /** @param path - candidate path. @returns whether it is an existing regular file. */
    isFile(path: string): boolean;
    /**
     * @param path - directory to list.
     * @returns the executable base names in it (one trailing extension stripped), or null when the
     * directory cannot be read at all.
     */
    listDirectory(path: string): readonly string[] | null;
}
/**
 * Commands the toolchain may provide; the contract reports exactly which ones it found.
 *
 * `kill` is deliberately absent: the engine has a `kill` builtin, which shadows any program of that
 * name, so a toolchain copy could never be reached and claiming it as a `PATH` program would be false.
 */
export declare const TOOLCHAIN_COMMANDS: readonly ['grep', 'sed', 'awk', 'jq', 'find', 'xargs', 'diff', 'cmp', 'which', 'timeout', 'stat', 'ps'];
/**
 * Names in the toolchain directory worth naming in the contract, beyond {@link TOOLCHAIN_COMMANDS}.
 *
 * These are the programs this engine has no equivalent for, which is what a toolchain is for here: a
 * terminal check, a detacher, a priority setter, uptime and host id, a path validator, the findutils
 * database pair (`updatedb --localpaths=… --output=…`, then `locate --database=…`, measured on this
 * machine), and a grep implementation that needs no regular-expression dialect translation. Each is only
 * rendered when the probe found it, so the list cannot claim a program that is not there.
 *
 * `stdbuf` is deliberately absent: uutils' implementation loads a companion `libstdbuf` library at run
 * time, this build produces none, and the installed `stdbuf` therefore fails with "External libstdbuf not
 * found" — measured, so it is not advertised.
 */
export declare const NOTABLE_ADDITIONS: readonly ['tty', 'nohup', 'nice', 'uptime', 'hostid', 'pathchk', 'locate', 'updatedb'];
/**
 * Utilities the bundled-coreutils engine build carries as builtins.
 *
 * Measured with `type -t` over the GNU coreutils name set (see `docs/research.md`); the standard bash
 * builtins (`echo`, `printf`, `test`, `true`, `false`, `pwd`) are omitted because every bash has them,
 * and they are named separately in {@link SHELL_BUILTINS}. `type -t` cannot tell a name the engine
 * executes in its own process from one it dispatches to itself, and the bundled set is the second kind:
 * every call re-enters the engine as a `--invoke-bundled <name>` child (see `patches/brush/README.md`,
 * `0004`), which is why the contract states that mechanism instead of calling these utilities in-process.
 *
 * This list is also what keeps a toolchain copy of one of these names out of the contract: the engine
 * already answers it, so advertising it as an addition would claim a capability the toolchain did not add.
 */
export declare const BUILT_IN_UTILITIES: string[];
/**
 * Names the engine answers itself, so a program copy of one is never advertised.
 *
 * `find -exec`, `xargs` and `timeout` start a *program*, and a builtin has no executable for them to start:
 * `xargs rm` and `find . -exec rm {} \;` need a real `rm` on `PATH` even though `rm` works at the prompt. That
 * used to be the farm's job — it installed a copy of every name the engine answers, as hard links to one
 * multi-call binary. It is the plugin's shim directory now: every bundled name is a hard link to the engine,
 * and the engine dispatches on its own file name (patch `0016`), so one implementation answers both the
 * prompt and a child process while `scripts/build-toolchain.mjs` keeps these names out of the farm.
 * {@link SHADOWED_IN_DIRECTORY} still bars them from the contract's own lists, because an operator's
 * `toolsDir` may legitimately hold copies of them. The corpus's `xargs-rm` and `find-exec-rm` cases are the
 * gate that the program form really resolves.
 */
export declare const SHELL_BUILTINS: readonly ['echo', 'printf', 'pwd', 'test', 'true', 'false', 'kill'];
/** POSIX names Windows also answers to with unrelated semantics. */
export declare const WINDOWS_IMPOSTORS: readonly ['find', 'timeout', 'convert'];
/** What a probe found, and what the model therefore has to be told. */
export interface ToolchainProbe {
    /** The directory that was probed. */
    readonly dir: string;
    /** Commands present as executables in that directory. */
    readonly provided: readonly string[];
    /** Commands the toolchain could have provided but did not. */
    readonly absent: readonly string[];
    /** Windows impostors this directory shadows, so the POSIX meaning now wins. */
    readonly shadows: readonly string[];
    /** Windows impostors that remain dangerous because nothing shadows them. */
    readonly impostors: readonly string[];
    /**
     * Every other executable base name in the directory, sorted.
     *
     * A listing that cannot be read leaves this empty and falls back to probing the known names one by
     * one, which is what an unreadable or absent directory looks like from here.
     */
    readonly additional: readonly string[];
}
/** A probe of a directory that does not exist, which is the state on a machine without a toolchain. */
export declare function emptyProbe(dir: string): ToolchainProbe;
/**
 * The per-user toolchain directory, whether or not anything was built there.
 *
 * This mirrors the engine's per-user directory, which is what makes an unconfigured install work;
 * an explicit `toolsDir` config always outranks it. Existence is deliberately not checked here: the
 * path is also what the docs and the probe report name, and a probe of an absent directory reports
 * exactly that (every command absent) instead of hiding which directory was looked at.
 * @param env - the process environment, for `LOCALAPPDATA`.
 * @param platform - the platform, since the directory is Windows-only.
 * @returns the directory, or an empty string when it cannot be derived.
 */
export declare function defaultToolsDir(env: Readonly<Record<string, string | undefined>>, platform: string): string;
/**
 * Probe one directory for the commands the toolchain provides.
 *
 * A readable listing answers both questions at once and is the only way to see the programs beyond the
 * known names, which the install publishes as the declared set. When the listing is unavailable the known
 * names are probed one by one, which is the pre-listing behaviour and still correct for them. Only
 * executable names count: a stray file in the directory — a capture file, or a companion library such as
 * the one `stdbuf` would need — must never be advertised to the model as a command.
 * @param dir - the directory to probe; an empty string yields an empty probe.
 * @param platform - the platform, which decides the executable suffix.
 * @param fs - filesystem probe.
 * @returns the probe, with commands found, absent, the impostors they shadow, and everything else.
 */
export declare function probeToolchain(dir: string, platform: string, fs: ToolchainFs): ToolchainProbe;
/**
 * Put one directory at the front of a `PATH`, removing an existing occurrence first so repeated
 * layering cannot grow the value without bound.
 * @param dir - the directory to prepend.
 * @param basePath - the `PATH` to prepend to.
 * @param delimiter - the platform's `PATH` separator.
 * @returns the new `PATH`, or the base unchanged when there is nothing to prepend.
 */
export declare function prependPath(dir: string, basePath: string, delimiter: string): string;
/**
 * Put several directories at the front of a `PATH`, in the order given.
 *
 * The order is the caller's priority order — the toolchain's own directory first, the shell names beside it
 * second — and it is built from the back so that the first entry of `dirs` ends up first.
 * @param dirs - directories to prepend, highest priority first; empty entries are ignored.
 * @param basePath - the `PATH` to prepend to.
 * @param delimiter - the platform's `PATH` separator.
 * @returns the new `PATH`.
 */
export declare function prependPaths(dirs: readonly string[], basePath: string, delimiter: string): string;
/**
 * Where the interactive startup file lives, next to the per-user state rather than inside the
 * toolchain directory so a user-configured `toolsDir` is never written to.
 * @param env - the environment to read `LOCALAPPDATA` from.
 * @param toolsDir - the probed toolchain directory, used only when there is no per-user state.
 * @returns the path, or an empty string when neither location can be derived.
 */
export declare function defaultRcFile(env: Record<string, string | undefined>, toolsDir: string): string;
/**
 * The startup file's contents, which is only the `PATH` prepend.
 *
 * A PTY session spawns the engine directly and therefore never passes through the executor's
 * `resolve()`, so without this file the persistent shell would see no toolchain and `find`, `grep`
 * and `timeout` would silently be the Windows programs again — and no `bash`/`sh` name either. The whole
 * prefix is single-quoted so a path containing `$`, a quote or a backslash cannot be interpreted, and the
 * inherited `PATH` is double-quoted so it expands; adjacent quoted strings concatenate, which is what puts
 * the platform's separator between them.
 * @param dirs - the directories to prepend, in priority order; empty entries are ignored.
 * @param delimiter - the platform's `PATH` separator.
 * @returns the file's text, ending with exactly one newline.
 */
export declare function rcFileContents(dirs: readonly string[], delimiter: string): string;
