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
/**
 * Commands the toolchain may provide; the contract reports exactly which ones it found.
 *
 * `kill` is deliberately absent: the engine has a `kill` builtin, which shadows any program of that
 * name, so a toolchain copy could never be reached and claiming it as a `PATH` program would be false.
 */
export const TOOLCHAIN_COMMANDS = [
    'grep',
    'sed',
    'awk',
    'jq',
    'find',
    'xargs',
    'diff',
    'cmp',
    'which',
    'timeout',
    'stat',
    'ps',
];
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
export const NOTABLE_ADDITIONS = [
    'tty',
    'nohup',
    'nice',
    'uptime',
    'hostid',
    'pathchk',
    'locate',
    'updatedb',
];
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
export const BUILT_IN_UTILITIES = [
    'b2sum',
    'base32',
    'base64',
    'basename',
    'basenc',
    'cat',
    'cksum',
    'comm',
    'cp',
    'csplit',
    'cut',
    'date',
    'dd',
    'df',
    'dir',
    'dircolors',
    'dirname',
    'du',
    'env',
    'expand',
    'expr',
    'factor',
    'fmt',
    'fold',
    'head',
    'hostname',
    'join',
    'link',
    'ln',
    'ls',
    'md5sum',
    'mkdir',
    'mktemp',
    'more',
    'mv',
    'nl',
    'nproc',
    'numfmt',
    'od',
    'paste',
    'pr',
    'printenv',
    'ptx',
    'readlink',
    'realpath',
    'rm',
    'rmdir',
    'seq',
    'sha1sum',
    'sha224sum',
    'sha256sum',
    'sha384sum',
    'sha512sum',
    'shred',
    'shuf',
    'sleep',
    'sort',
    'split',
    'sum',
    'sync',
    'tac',
    'tail',
    'tee',
    'touch',
    'tr',
    'truncate',
    'tsort',
    'uname',
    'unexpand',
    'uniq',
    'unlink',
    'vdir',
    'wc',
    'whoami',
    'yes',
];
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
export const SHELL_BUILTINS = ['echo', 'printf', 'pwd', 'test', 'true', 'false', 'kill'];
/** Applets whose meaning the engine already covers another way, so a copy is installed but never named. */
const REDUNDANT_PROGRAMS = ['arch'];
/** Names in the directory that must never be advertised, beyond the Windows impostors. */
const SHADOWED_IN_DIRECTORY = [...SHELL_BUILTINS, ...REDUNDANT_PROGRAMS, ...BUILT_IN_UTILITIES];
/** POSIX names Windows also answers to with unrelated semantics. */
export const WINDOWS_IMPOSTORS = ['find', 'timeout', 'convert'];
/** A probe of a directory that does not exist, which is the state on a machine without a toolchain. */
export function emptyProbe(dir) {
    return {
        dir,
        provided: [],
        absent: [...TOOLCHAIN_COMMANDS],
        shadows: [],
        impostors: [...WINDOWS_IMPOSTORS],
        additional: [],
    };
}
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
export function defaultToolsDir(env, platform) {
    if (platform !== 'win32')
        return '';
    const local = env.LOCALAPPDATA;
    if (local === undefined || local.length === 0)
        return '';
    return `${local}\\dsh-bash-native\\tools\\bin`;
}
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
export function probeToolchain(dir, platform, fs) {
    if (dir.length === 0)
        return emptyProbe(dir);
    const suffix = platform === 'win32' ? '.exe' : '';
    const separator = platform === 'win32' ? '\\' : '/';
    const listed = fs.listDirectory(dir);
    // A listing may hand over raw entries (`grep.exe`, `libstdbuf.dll`) or names already stripped of the
    // platform's suffix (`grep`), so the suffix is removed here and only executables are kept.
    const programs = listed === null
        ? null
        : listed
            .map((name) => (suffix !== '' && name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name))
            .filter((name) => isExecutableName(name, suffix));
    const provided = programs === null
        ? TOOLCHAIN_COMMANDS.filter((command) => fs.isFile(`${dir}${separator}${command}${suffix}`))
        : TOOLCHAIN_COMMANDS.filter((command) => programs.includes(command));
    const known = new Set(TOOLCHAIN_COMMANDS);
    const hidden = new Set([...WINDOWS_IMPOSTORS, ...SHADOWED_IN_DIRECTORY]);
    const additional = programs === null
        ? []
        : programs
            .filter((name) => name.length > 0 && !known.has(name) && !hidden.has(name))
            .sort();
    return {
        dir,
        provided,
        absent: TOOLCHAIN_COMMANDS.filter((command) => !provided.includes(command)),
        shadows: WINDOWS_IMPOSTORS.filter((name) => provided.includes(name)),
        impostors: WINDOWS_IMPOSTORS.filter((name) => !provided.includes(name)),
        additional,
    };
}
/**
 * Whether a directory entry could be a program.
 *
 * The platform's suffix counts, and so does an extension-less name, because a probe seam that hands over
 * bare names is describing executables. Anything else — `libstdbuf.dll`, a capture file, a log — is not a
 * command and must not reach the contract.
 * @param name - one entry from a directory listing.
 * @param suffix - the platform's executable suffix, or an empty string.
 * @returns true when the entry is a program name.
 */
function isExecutableName(name, suffix) {
    if (suffix === '')
        return true;
    if (!name.includes('.'))
        return true;
    return name.toLowerCase().endsWith(suffix.toLowerCase());
}
/**
 * Put one directory at the front of a `PATH`, removing an existing occurrence first so repeated
 * layering cannot grow the value without bound.
 * @param dir - the directory to prepend.
 * @param basePath - the `PATH` to prepend to.
 * @param delimiter - the platform's `PATH` separator.
 * @returns the new `PATH`, or the base unchanged when there is nothing to prepend.
 */
export function prependPath(dir, basePath, delimiter) {
    if (dir.length === 0)
        return basePath;
    const segments = basePath.split(delimiter).filter((segment) => segment.length > 0 && segment.toLowerCase() !== dir.toLowerCase());
    return [dir, ...segments].join(delimiter);
}
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
export function prependPaths(dirs, basePath, delimiter) {
    return [...dirs].reverse().reduce((path, dir) => prependPath(dir, path, delimiter), basePath);
}
/**
 * Where the interactive startup file lives, next to the per-user state rather than inside the
 * toolchain directory so a user-configured `toolsDir` is never written to.
 * @param env - the environment to read `LOCALAPPDATA` from.
 * @param toolsDir - the probed toolchain directory, used only when there is no per-user state.
 * @returns the path, or an empty string when neither location can be derived.
 */
export function defaultRcFile(env, toolsDir) {
    const local = env.LOCALAPPDATA;
    if (local !== undefined && local.length > 0)
        return `${local}\\dsh-bash-native\\bash-native-rc.sh`;
    if (toolsDir.length === 0)
        return '';
    const separator = toolsDir.includes('\\') ? '\\' : '/';
    const parts = toolsDir.split(separator);
    return [...parts.slice(0, -1), 'bash-native-rc.sh'].join(separator);
}
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
export function rcFileContents(dirs, delimiter) {
    const prefix = dirs.filter((dir) => dir.length > 0).join(delimiter);
    const quoted = `'${prefix.replaceAll("'", `'\\''`)}'`;
    return `# Generated by dsh-bash-native: put the POSIX toolchain ahead of the same-named Windows programs.\nexport PATH=${quoted}"${delimiter}$PATH"\n`;
}
