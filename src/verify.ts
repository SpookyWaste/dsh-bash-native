/**
 * Asking one candidate binary whether it is the engine this plugin runs.
 *
 * The engine this plugin ships is rubash, so a configured `bashPath` cannot be taken at face value:
 * `bash.exe` from Git for Windows, MSYS2 or Cygwin, and `wsl.exe`, are the binaries a user is most
 * likely to point at, and each reports itself differently. `--identity` settles the family first (a GNU
 * bash cannot answer it), then the build's own signature settles which build this is. The brush family
 * stays recognisable for deployments that still point at an old build: it is identified, refused when
 * its patched signature does not hold, and accepted only when it does.
 * TODO: retire the brush branch once no deployment can name one.
 * @module dsh-bash-native/verify
 */

import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EngineVerdict } from './resolve.js'

/** The spawn this module needs, injected so the identification parse is testable without a binary. */
export interface VersionRun {
  /**
   * @param path - executable to run.
   * @param args - arguments for that run.
   * @returns its first output line and, when it could not be run, the reason.
   */
  (path: string, args: readonly string[]): { readonly line: string; readonly failure: string | null }
}

/**
 * The facts only this repository's engine build has, asked as two commands.
 *
 * `verify` answers "is this brush at all"; these answer "is it the build the model-visible contract
 * describes". Every fact is a consequence of this repository's patches and of nothing else: `/tmp` is a
 * real directory only because of `0002`/`0004`, `kill` is a builtin only because of `0008`, and a
 * `/q/x` argument reaches a child as `Q:\x` only because of `0009`. An unpatched
 * `cargo install brush-shell` fails all of them, and running it would make the contract lie, so a
 * candidate that fails is refused rather than accepted.
 */
const BUILD_SIGNATURE = 'test -d /tmp; echo "tmp=$?"; type -t kill'
/** What the shell-side signature prints on a build that carries this repository's patches. */
const SIGNATURE_EXPECTED = ['tmp=0', 'builtin']
/** The argument-side signature: a foreign program prints the argument it actually received. */
const ARG_EXPECTED = 'Q:\\x'

/**
 * The flag that makes rubash print its persona and every effective identity value.
 *
 * It is the family discriminator because it cannot be confused with a GNU bash: bash rejects an unknown
 * long option, so a real bash answers `bash: --identity: invalid option` and exits 2, while rubash prints
 * an `identity:` block. Matching the banner is not enough on its own — rubash reports a GNU banner on
 * purpose (its `--version` is `show_shell_version`), so the name-based check the brush family uses cannot
 * apply here.
 */
const RUBASH_IDENTITY = '--identity'

/** The line `rubash --identity` leads with. */
const RUBASH_IDENTITY_LINE = /^identity:\s+(?:msys|native)\b/

/**
 * Behaviours this plugin's contract states, asked in one command.
 *
 * Every fact is observable in a bash 5.3 that does what an agent expects, and none of them depends on an
 * external program: the character count of a two-character UTF-8 value, `kill` as a builtin, the MSYS
 * persona the engine defaults to, and a real PID behind `$!` for a background job the engine runs itself
 * (brush's patch only ever gave one for a literal external command).
 */
const RUBASH_SIGNATURE = [
  `v=中文; printf '%s|%s|%s|%s\\n' "$BASH_VERSION" "$(type -t kill)" "\${#v}" "$(uname -s)"`,
  `sleep 0.05 & printf 'bg=%s\\n' "$!"`,
  'wait',
].join('; ')

/** The kernel name a Windows build reports under the default (MSYS-compatible) persona. */
const MSYS_SYSNAME = /^(?:MSYS|MINGW32|MINGW64|UCRT64|CLANG32|CLANG64|CLANGARM64)_NT-/

/**
 * The argument-side signature command.
 *
 * `Q:` need not exist: nothing here touches the filesystem. A patched engine rewrites the operand to the
 * drive mount `Q:\x` before spawning, and an unpatched one hands over the literal `/q/x`, so the string
 * the child prints is the entire difference. The host's own Node runs the child, which is the only
 * interpreter this plugin can be sure exists.
 * @param node - absolute path to the Node executable.
 * @returns the command to run through the candidate engine.
 */
export function argumentSignature(node: string): string {
  return `'${node.replaceAll("'", `'\\''`)}' -e 'console.log(process.argv[1])' /q/x`
}

/**
 * Ask one candidate binary to identify itself, then to prove it is this build.
 * @param path - an existing absolute executable.
 * @param run - the spawn seam; production passes {@link spawnVersion}.
 * @param node - the Node executable the argument signature runs (`process.execPath` in production).
 * @returns the verdict resolution reads.
 */
export function readEngineVersion(path: string, run: VersionRun = spawnVersion, node: string = process.execPath): EngineVerdict {
  // The identity flag decides the family before anything is claimed about the banner: rubash prints a GNU
  // bash banner, so the banner alone cannot tell the two families apart, while this flag cannot be answered
  // by a GNU bash at all.
  const identity = run(path, [RUBASH_IDENTITY])
  if (identity.failure === null && RUBASH_IDENTITY_LINE.test(firstLine(identity.line))) {
    return verifyRubash(path, run, identity.line)
  }
  return verifyBrush(path, run, node)
}

/**
 * The first non-empty line of a captured run, with carriage returns removed.
 * @param text - the captured output of one probe.
 * @returns the trimmed first line, or an empty string.
 */
function firstLine(text: string): string {
  return text.replace(/\r/g, '').split('\n').map((part) => part.trim()).find((part) => part.length > 0) ?? ''
}

/**
 * Verify a candidate that answered the identity flag: a rubash-family engine.
 * @param path - the candidate executable.
 * @param run - the spawn seam.
 * @param identity - the raw output of the identity probe, quoted when the persona line is unreadable.
 * @returns the verdict, carrying the family so argv construction can drop the brush-only flags.
 */
function verifyRubash(path: string, run: VersionRun, identity: string): EngineVerdict {
  const banner = run(path, ['--version'])
  if (banner.failure !== null) return { version: '', family: 'rubash', refused: `it is rubash but could not be asked: ${banner.failure}` }
  const signature = run(path, ['-c', RUBASH_SIGNATURE])
  if (signature.failure !== null) return { version: '', family: 'rubash', refused: `it is rubash but could not be asked: ${signature.failure}` }
  const lines = signature.line.replace(/\r/g, '').split('\n').map((part) => part.trim())
  const facts = (lines[0] ?? '').split('|')
  const [bashVersion = '', killType = '', charCount = '', sysname = ''] = facts
  const background = (lines[1] ?? '').replace(/^bg=/, '')
  const missing: string[] = []
  if (!bashVersion.startsWith('5.3')) missing.push('a bash 5.3 version')
  if (killType !== 'builtin') missing.push('`kill` as a builtin')
  if (charCount !== '2') missing.push('a character count for a UTF-8 value')
  if (!MSYS_SYSNAME.test(sysname)) missing.push('the MSYS-compatible persona')
  if (!/^\d+$/.test(background)) missing.push('a PID behind `$!`')
  const version = firstLine(banner.line) || firstLine(identity)
  if (missing.length > 0) {
    return {
      version: '',
      family: 'rubash',
      refused: `it is rubash (${version}) but not the build this contract describes: ${missing.join(', ')} did not hold`,
    }
  }
  return { version, family: 'rubash', refused: null }
}

/**
 * Verify a candidate that did not answer the identity flag: the brush family this repository patched.
 * @param path - the candidate executable.
 * @param run - the spawn seam.
 * @param node - the Node executable the argument signature runs.
 * @returns the verdict, carrying the brush family.
 */
function verifyBrush(path: string, run: VersionRun, node: string): EngineVerdict {
  const observed = run(path, ['--version'])
  if (observed.failure !== null) return { version: '', family: 'brush', refused: observed.failure }
  const line = observed.line.trim().split('\n')[0]?.trim() ?? ''
  // brush prints e.g. `brush 0.4.0 (git:08db87a6-modified)`, so the name has to lead the line: a
  // binary whose banner merely mentions brush (a wrapper, or a shell that echoes it) cannot pass.
  if (!/^brush\b/i.test(line)) {
    return { version: '', family: 'brush', refused: line === '' ? 'it reported no version' : `it reports "${line}", which is not brush` }
  }
  const missing: string[] = []
  const signature = run(path, ['-c', BUILD_SIGNATURE])
  if (signature.failure !== null) return { version: '', family: 'brush', refused: `it is brush but could not be asked: ${signature.failure}` }
  const printed = signature.line
    .replace(/\r/g, '')
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const tail = printed.slice(-SIGNATURE_EXPECTED.length)
  for (const [index, fact] of SIGNATURE_EXPECTED.entries()) {
    if (tail[index] !== fact) missing.push(fact)
  }
  const argument = run(path, ['-c', argumentSignature(node)])
  if (argument.failure !== null) return { version: '', family: 'brush', refused: `it is brush but could not be asked: ${argument.failure}` }
  if (argument.line.replace(/\r/g, '').trim() !== ARG_EXPECTED) missing.push(`the argument ${ARG_EXPECTED}`)
  if (missing.length > 0) {
    return {
      version: '',
      family: 'brush',
      refused:
        `it is brush (${line}) but not the build this contract describes: ${missing.join(' and ')} did not hold ` +
        `(the build needs this repository's patches; see engine.lock.json)`,
    }
  }
  return { version: line, family: 'brush', refused: null }
}

/**
 * The pre-rubash name for {@link readEngineVersion}.
 *
 * Kept because the harness and the confirmation tests reach for it by name; it now answers for both
 * families. `TODO` once the brush family retires: fold the two callers onto the new name and drop this.
 */
export const readBrushVersion = readEngineVersion

/**
 * The stdio shape a child launched from inside a session can actually use.
 *
 * A process started under the harness's restricted token cannot open a named pipe, so asking for pipes
 * (`spawnSync(..., { encoding: 'utf8' })`) fails with `EPERM` before the engine starts. That would refuse
 * every candidate — including the engine this package ships — and, with `requireEngineOnLoad: true`, take
 * the plugin down in exactly the tiers it exists to serve. The verifier therefore redirects both streams
 * to files, the same shape the test harness uses for its own runs, and one file per stream because a
 * refusal must be able to quote what the candidate wrote.
 *
 * Exported so a unit test can pin the property that matters: the array handed to `spawnSync` never
 * contains `'pipe'`.
 * @param stdoutPath - capture file for the child's stdout.
 * @param stderrPath - capture file for the child's stderr.
 * @returns the `stdio` value and the disposer that closes both descriptors.
 */
export function captureStdio(stdoutPath: string, stderrPath: string): {
  readonly stdio: ['ignore', number, number]
  close(): void
} {
  const stdout = openSync(stdoutPath, 'w')
  const stderr = openSync(stderrPath, 'w')
  return {
    stdio: ['ignore', stdout, stderr],
    close() {
      closeSync(stdout)
      closeSync(stderr)
    },
  }
}

/** The production spawn: one bounded run, at resolution time, in the session's own confinement tier. */
function spawnVersion(path: string, args: readonly string[]): { line: string; failure: string | null } {
  let directory: string | undefined
  try {
    directory = mkdtempSync(join(tmpdir(), 'dsh-bash-native-verify-'))
    const stdoutPath = join(directory, 'stdout.txt')
    const stderrPath = join(directory, 'stderr.txt')
    const capture = captureStdio(stdoutPath, stderrPath)
    let result: ReturnType<typeof spawnSync>
    try {
      result = spawnSync(path, [...args], { stdio: capture.stdio, timeout: 10_000, windowsHide: true })
    } finally {
      capture.close()
    }
    if (result.error !== undefined) return { line: '', failure: `it could not be run: ${result.error.message}` }
    // Both streams are read, and they are read after the descriptors are closed so nothing is buffered.
    const text = `${readFileSync(stdoutPath, 'utf8')}${readFileSync(stderrPath, 'utf8')}`.trim()
    return { line: text, failure: null }
  } catch (error) {
    // A synchronously throwing spawn (a NUL in the path, an aborted call, an unwritable temporary
    // directory) is the same verdict as a failed run: this candidate cannot be the engine, and the
    // reason is what the probe list shows.
    return { line: '', failure: `it could not be run: ${String(error)}` }
  } finally {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  }
}