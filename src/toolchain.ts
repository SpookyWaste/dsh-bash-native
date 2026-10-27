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
  isFile(path: string): boolean
  /**
   * @param path - directory to list.
   * @returns the executable base names in it (one trailing extension stripped), or null when the
   * directory cannot be read at all.
   */
  listDirectory(path: string): readonly string[] | null
}

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
] as const

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
] as const

/**
 * Names rubash answers inside the shell process, so the toolchain must not publish a second copy.
 *
 * `uname` and `arch` are full builtins with no external fallback, and the engine keeps their identity
 * fields (the MSYS-compatible persona) out of `PATH` on purpose, so a program of the same name would be a
 * second opinion about which platform this is.
 */
export const ENGINE_BUILTINS = ['arch', 'uname'] as const

/**
 * Names rubash runs in-process only for simple forms and hands to `PATH` otherwise.
 *
 * This is the class the toolchain has to publish even though the engine "answers" the name: `xargs
 * dirname`, `find -exec basename` and a script that execs `sleep` reach a program, never a builtin, and
 * the engine's own `type` reports them as external commands for exactly that reason.
 */
export const ENGINE_FALLBACK_NAMES = ['basename', 'dirname', 'sleep'] as const

/**
 * Names the engine answers itself, so a program copy of one is never advertised.
 *
 * `find -exec`, `xargs` and `timeout` start a *program*, and a builtin has no executable for them to start:
 * `xargs rm` and `find . -exec rm {} \;` need a real `rm` on `PATH` even though `rm` works at the prompt. The
 * toolchain publishes a program for every one of these names, so the program form resolves while the prompt
 * still gets the engine's builtin. {@link SHADOWED_IN_DIRECTORY} keeps them out of the contract's own lists,
 * because an operator's `toolsDir` may legitimately hold copies of them. The corpus's `xargs-rm` and
 * `find-exec-rm` cases are the gate that the program form really resolves.
 */
export const SHELL_BUILTINS = ['echo', 'printf', 'pwd', 'test', 'true', 'false', 'kill'] as const

/**
 * Commands rubash answers with an in-process copy, in its own words "the external file builtins".
 *
 * For a simple form the engine implements `mkdir`, `touch`, `chmod`, `cp`, `rm`, `rmdir`, `cat`, `sed`,
 * `mkfifo` and `tty` itself, plus the absolute spellings `/bin/pwd`, `/bin/printf`, `/bin/cat` and
 * `/bin/tty`; anything more involved it hands to `PATH`. That layer is a second implementation of commands
 * this toolchain also publishes, and the two do not agree everywhere — see
 * {@link DEFAULT_FILE_COMMANDS_FROM_PATH}. Naming a command in {@link fileCommandsFromPath} runs the
 * toolchain's program instead. This list mirrors `patches/rubash/0003` and the engine's own `matches!`.
 */
export const ENGINE_FILE_COMMANDS = [
  'cat',
  'chmod',
  'cp',
  'mkdir',
  'mkfifo',
  'printf',
  'pwd',
  'rm',
  'rmdir',
  'sed',
  'touch',
  'tty',
] as const

/**
 * The commands whose in-process copy is measurably not GNU's, and so default to the toolchain's program.
 *
 * `sed`: the in-process copy is a hand-rolled matcher for `s/pat/rep/` and `Nd` only — `\b`, `\{m,n\}` and
 * `\|` do not work, while the toolchain's sed (with this repository's patch) implements them. `rmdir`: the
 * in-process copy ignores every `remove_dir` error and then reports success, so a missing operand exits 0 and
 * `dir/.` removes the parent.
 *
 * The rest of the layer stays in-process on purpose. `chmod` and `mkfifo` have no toolchain program at all on
 * Windows — uutils publishes neither applet — so sending them to `PATH` turns `chmod +x` into "command not
 * found". `cat`, `rm`, `mkdir`, `touch`, `cp`, `tty`, `pwd` and `printf` agree with GNU in the corpus and are
 * hot enough that one process per call costs more than the copy saves. A deployment that wants every program
 * can still pass `all` through `shellEnvOverrides`.
 */
export const DEFAULT_FILE_COMMANDS_FROM_PATH = ['sed', 'rmdir'] as const

/** The engine variable that carries {@link DEFAULT_FILE_COMMANDS_FROM_PATH} to the shell. */
export const FILE_COMMANDS_FROM_PATH_ENV = 'RUBASH_FILE_COMMANDS_FROM_PATH'

/** Applets whose meaning the engine already covers another way, so a copy is installed but never named. */
const REDUNDANT_PROGRAMS = ['arch'] as const

/** Names in the directory that must never be advertised, beyond the Windows impostors. */
const SHADOWED_IN_DIRECTORY = [...SHELL_BUILTINS, ...REDUNDANT_PROGRAMS, ...ENGINE_BUILTINS] as const

/** POSIX names Windows also answers to with unrelated semantics. */
export const WINDOWS_IMPOSTORS = ['find', 'timeout', 'convert'] as const

/** What a probe found, and what the model therefore has to be told. */
export interface ToolchainProbe {
  /** The directory that was probed. */
  readonly dir: string
  /** Commands present as executables in that directory. */
  readonly provided: readonly string[]
  /** Commands the toolchain could have provided but did not. */
  readonly absent: readonly string[]
  /** Windows impostors this directory shadows, so the POSIX meaning now wins. */
  readonly shadows: readonly string[]
  /** Windows impostors that remain dangerous because nothing shadows them. */
  readonly impostors: readonly string[]
  /**
   * Every other executable base name in the directory, sorted.
   *
   * A listing that cannot be read leaves this empty and falls back to probing the known names one by
   * one, which is what an unreadable or absent directory looks like from here.
   */
  readonly additional: readonly string[]
}

/** A probe of a directory that does not exist, which is the state on a machine without a toolchain. */
export function emptyProbe(dir: string): ToolchainProbe {
  return {
    dir,
    provided: [],
    absent: [...TOOLCHAIN_COMMANDS],
    shadows: [],
    impostors: [...WINDOWS_IMPOSTORS],
    additional: [],
  }
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
export function defaultToolsDir(env: Readonly<Record<string, string | undefined>>, platform: string): string {
  if (platform !== 'win32') return ''
  const local = env.LOCALAPPDATA
  if (local === undefined || local.length === 0) return ''
  return `${local}\\dsh-bash-native\\tools\\bin`
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
export function probeToolchain(dir: string, platform: string, fs: ToolchainFs): ToolchainProbe {
  if (dir.length === 0) return emptyProbe(dir)
  const suffix = platform === 'win32' ? '.exe' : ''
  const separator = platform === 'win32' ? '\\' : '/'
  const listed = fs.listDirectory(dir)
  // A listing may hand over raw entries (`grep.exe`, `libstdbuf.dll`) or names already stripped of the
  // platform's suffix (`grep`), so the suffix is removed here and only executables are kept.
  const programs =
    listed === null
      ? null
      : listed
          .map((name) => (suffix !== '' && name.toLowerCase().endsWith(suffix) ? name.slice(0, -suffix.length) : name))
          .filter((name) => isExecutableName(name, suffix))
  const provided =
    programs === null
      ? TOOLCHAIN_COMMANDS.filter((command) => fs.isFile(`${dir}${separator}${command}${suffix}`))
      : TOOLCHAIN_COMMANDS.filter((command) => programs.includes(command))
  const known = new Set<string>(TOOLCHAIN_COMMANDS)
  const hidden = new Set<string>([...WINDOWS_IMPOSTORS, ...SHADOWED_IN_DIRECTORY])
  const additional =
    programs === null
      ? []
      : programs
          .filter((name) => name.length > 0 && !known.has(name) && !hidden.has(name))
          .sort()
  return {
    dir,
    provided,
    absent: TOOLCHAIN_COMMANDS.filter((command) => !provided.includes(command)),
    shadows: WINDOWS_IMPOSTORS.filter((name) => provided.includes(name as (typeof TOOLCHAIN_COMMANDS)[number])),
    impostors: WINDOWS_IMPOSTORS.filter((name) => !provided.includes(name as (typeof TOOLCHAIN_COMMANDS)[number])),
    additional,
  }
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
function isExecutableName(name: string, suffix: string): boolean {
  if (suffix === '') return true
  if (!name.includes('.')) return true
  return name.toLowerCase().endsWith(suffix.toLowerCase())
}

/**
 * Put one directory at the front of a `PATH`, removing an existing occurrence first so repeated
 * layering cannot grow the value without bound.
 * @param dir - the directory to prepend.
 * @param basePath - the `PATH` to prepend to.
 * @param delimiter - the platform's `PATH` separator.
 * @returns the new `PATH`, or the base unchanged when there is nothing to prepend.
 */
export function prependPath(dir: string, basePath: string, delimiter: string): string {
  if (dir.length === 0) return basePath
  const segments = basePath.split(delimiter).filter((segment) => segment.length > 0 && segment.toLowerCase() !== dir.toLowerCase())
  return [dir, ...segments].join(delimiter)
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
export function prependPaths(dirs: readonly string[], basePath: string, delimiter: string): string {
  return [...dirs].reverse().reduce((path, dir) => prependPath(dir, path, delimiter), basePath)
}

/**
 * The commands one run should take from `PATH` instead of the engine's in-process copy.
 *
 * A name survives only when the toolchain directory will actually lead `PATH` — the same `provided`
 * condition the executor uses to decide the prepend — and the probe found that program, either among the
 * declared names or in `additional` (where `rmdir` and the other published applets live). Everything else
 * keeps the engine's copy: a machine without a toolchain behaves exactly as it did before this switch
 * existed, and a toolchain missing one program costs only that program.
 * @param probe - the toolchain probe for this resolution.
 * @param requested - the configured commands, already validated against {@link ENGINE_FILE_COMMANDS}.
 * @returns the commands to hand the engine, in the configured order, without duplicates.
 */
export function fileCommandsFromPath(probe: ToolchainProbe, requested: readonly string[]): readonly string[] {
  if (probe.provided.length === 0) return []
  const available = new Set<string>([...probe.provided, ...probe.additional])
  const names: string[] = []
  for (const name of requested) {
    if (available.has(name) && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Where the interactive startup file lives, next to the per-user state rather than inside the
 * toolchain directory so a user-configured `toolsDir` is never written to.
 * @param env - the environment to read `LOCALAPPDATA` from.
 * @param toolsDir - the probed toolchain directory, used only when there is no per-user state.
 * @returns the path, or an empty string when neither location can be derived.
 */
export function defaultRcFile(env: Record<string, string | undefined>, toolsDir: string): string {
  const local = env.LOCALAPPDATA
  if (local !== undefined && local.length > 0) return `${local}\\dsh-bash-native\\bash-native-rc.sh`
  if (toolsDir.length === 0) return ''
  const separator = toolsDir.includes('\\') ? '\\' : '/'
  const parts = toolsDir.split(separator)
  return [...parts.slice(0, -1), 'bash-native-rc.sh'].join(separator)
}

/**
 * The startup file's contents, which is only the environment a PTY session could not otherwise inherit.
 *
 * A PTY session spawns the engine directly and therefore never passes through the executor's `resolve()`, so
 * without this file the persistent shell would see no toolchain and `find`, `grep` and `timeout` would
 * silently be the Windows programs again — and no `bash`/`sh` name either. The whole `PATH` prefix is
 * single-quoted so a path containing `$`, a quote or a backslash cannot be interpreted, and the inherited
 * `PATH` is double-quoted so it expands; adjacent quoted strings concatenate, which is what puts the
 * platform's separator between them. The file-command policy is exported for the same reason: the engine
 * reads it from the shell's own variables, so a session that never sees this executor's spawn environment
 * still learns which commands come from the toolchain.
 * @param dirs - the directories to prepend, in priority order; empty entries are ignored.
 * @param delimiter - the platform's `PATH` separator.
 * @param fileCommands - the commands whose programs should answer instead of the engine's in-process copies.
 * @returns the file's text, ending with exactly one newline.
 */
export function rcFileContents(dirs: readonly string[], delimiter: string, fileCommands: readonly string[] = []): string {
  const lines = ['# Generated by dsh-bash-native: the POSIX toolchain leads PATH and answers the file commands named here.']
  const prefix = dirs.filter((dir) => dir.length > 0).join(delimiter)
  if (prefix.length > 0) {
    const quoted = `'${prefix.replaceAll("'", `'\\''`)}'`
    lines.push(`export PATH=${quoted}"${delimiter}$PATH"`)
  }
  if (fileCommands.length > 0) lines.push(`export ${FILE_COMMANDS_FROM_PATH_ENV}='${fileCommands.join(',')}'`)
  return `${lines.join('\n')}\n`
}
