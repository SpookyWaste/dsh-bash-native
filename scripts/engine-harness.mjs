// Shared engine harness for the tests that run real bash scripts.
//
// Two constraints live here once, so every test inherits them:
//  1. An agent-sandboxed run cannot open named pipes, so a child's stdio is redirected to files
//     instead of pipes (`spawnSync` with pipes reports EPERM locally while passing in CI).
//  2. An engine may be absent (CI, or a machine that never installed one), and every caller must
//     skip rather than fail.
// @module dsh-bash-native/test-harness

import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveEngine } from '../lib/resolve.js'
import { packageRoot, preparePackagedEngine } from '../lib/artifact.js'
import { captureStdio, readBrushVersion } from '../lib/verify.js'
import { prepareShellNames } from '../lib/shim.js'

const isFile = (path) => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * The toolchain directory this project installs into.
 *
 * `--tools-dir=DIR` names one explicitly, `DSH_BASH_NATIVE_TOOLS` overrides the default, and the
 * default is the per-user directory the engine resolver also probes.
 * @param argv - the process arguments, so the caller's flags are honored.
 * @param env - the process environment.
 * @returns the directory, or an empty string when nothing is configured.
 */
export function toolsDirectory(argv, env) {
  const flag = argv.find((arg) => arg.startsWith('--tools-dir='))
  if (flag !== undefined) return flag.slice('--tools-dir='.length)
  if (env.DSH_BASH_NATIVE_TOOLS !== undefined && env.DSH_BASH_NATIVE_TOOLS.length > 0) return env.DSH_BASH_NATIVE_TOOLS
  const local = env.LOCALAPPDATA
  return local === undefined || local.length === 0 ? '' : join(local, 'dsh-bash-native', 'tools', 'bin')
}

/**
 * Directories this plugin materializes for itself, which the host environment never provides.
 *
 * A session that has resolved the plugin once carries the toolchain farm, the legacy per-user directory and a
 * shim directory named after *its* engine build on its own `PATH`. Inheriting the first two would silently
 * turn an "engine alone" run into a run with a toolchain — the count of satisfied `needs` changes, cases stop
 * skipping, and a baseline stops describing the environment it was recorded for — and inheriting a shim
 * directory would answer a name with a *different* engine build. All three are therefore dropped, and the two
 * that belong on the child's `PATH` are composed deliberately: the farm on request, the shim for the engine
 * under test.
 */
const PLUGIN_TOOLCHAIN_DIRS = /[\\/]dsh-bash-native[\\/](toolchain|tools)[\\/]/i
const PLUGIN_SHIM_DIRS = /[\\/]dsh-bash-native[\\/]shim[\\/]/i

/**
 * The shim directory for one engine, prepared when the environment allows it.
 *
 * The bundled utilities are shell builtins, so a child process reaches them only through a name on `PATH`, and
 * the plugin publishes those names as hard links to the engine it verified. A run that wants to see that path
 * composes it the way the plugin does. A shim that cannot be written (a confined session cannot write outside
 * the workspace) leaves the bundled names absent, which is what the engine-only baseline describes.
 * @param engine - absolute path to the engine under test; an empty string means no engine.
 * @returns the directory to put on `PATH`, or an empty string.
 */
function prepareShim(engine) {
  if (engine.length === 0) return ''
  try {
    const packaged = preparePackagedEngine({ packageRoot: packageRoot(), env: process.env })
    const digest =
      'ready' in packaged && packaged.ready === engine
        ? packaged.sha256
        : createHash('sha256').update(readFileSync(engine)).digest('hex')
    return prepareShellNames({ engine, sha256: digest, env: process.env })
  } catch {
    // An unreadable engine or an unwritable shim directory costs the bundled names on this PATH, and every
    // caller already treats a missing directory as "not provided".
    return ''
  }
}

/**
 * Build the PATH a run should see: the engine alone by default, the toolchain on request.
 * @param options - `withTools`, `toolsDir`, the base PATH, and the engine whose shim names belong on it.
 * @returns the PATH value for the child process.
 */
export function pathWithToolchain(options) {
  const segments = options.basePath.split(delimiter).filter((segment) => segment.length > 0)
  const without = segments.filter(
    (segment) =>
      segment.toLowerCase() !== options.toolsDir.toLowerCase() &&
      !PLUGIN_TOOLCHAIN_DIRS.test(segment) &&
      !PLUGIN_SHIM_DIRS.test(segment),
  )
  const shim = options.engine === undefined ? '' : prepareShim(options.engine)
  const front = [options.withTools ? options.toolsDir : '', shim].filter((dir) => dir.length > 0)
  return [...front, ...without].join(delimiter)
}

/**
 * Apply the harness's absent-versus-refused policy to one resolution.
 *
 * Exported so the policy is testable without a broken environment, and so every suite shares it.
 * @param resolution - what the plugin's resolver produced.
 * @returns the engine path, or null when no candidate exists at all.
 * @throws when a candidate exists but was refused.
 */
export function engineOrThrow(resolution) {
  if (resolution.engine !== null) return resolution.engine.path
  const refused = resolution.probed.filter((probe) => probe.refused !== undefined)
  if (refused.length > 0) throw new Error(resolution.failure ?? 'dsh-bash-native: every engine candidate was refused')
  return null
}

/**
 * The engine this run should test.
 *
 * `DSH_BASH_NATIVE_ENGINE` names one explicitly; otherwise the plugin's own resolver picks the first
 * engine it would use at runtime.
 *
 * Absent and refused are different outcomes, and both explicit and resolved engines follow that rule. A
 * path that does not exist counts as absent rather than as an error, so a stale variable skips instead
 * of failing. A path that exists is verified with the same build signature the plugin uses, because a
 * suite that scores a build the plugin would refuse reports that build's failures as the plugin's own:
 * pointing this variable at an upstream `cargo install` brush used to surface as a corpus full of
 * undeclared silent-wrong cases instead of as "this is not the build the contract describes".
 * @returns the engine path, or null when no engine exists at all.
 * @throws when a candidate exists but was refused.
 */
export function findEngine() {
  const configured = process.env.DSH_BASH_NATIVE_ENGINE
  if (configured !== undefined && configured.length > 0) {
    if (!existsSync(configured)) return null
    const verdict = readBrushVersion(configured)
    if (verdict.refused !== null) {
      throw new Error(
        `dsh-bash-native: DSH_BASH_NATIVE_ENGINE names ${configured}, which this contract cannot use: ${verdict.refused}`,
      )
    }
    return configured
  }
  return engineOrThrow(
    resolveEngine(
      { bashPath: '', bundledEngineDir: '', packaged: preparePackagedEngine({ packageRoot: packageRoot(), env: process.env }) },
      process.env,
      process.platform,
      { isFile },
      (path) => readBrushVersion(path),
    ),
  )
}

/**
 * Describe one engine so a report can name what was tested.
 *
 * Uses the verifier's own file-captured stdio: this runs inside the same confinement tier as everything
 * else in the session, where asking `spawnSync` for pipes is what fails.
 * @param engine - the engine path.
 * @returns the first line of the engine's own version output, or an empty string.
 */
export function engineVersion(engine) {
  let directory
  try {
    directory = mkdtempSync(join(tmpdir(), 'dsh-bash-native-version-'))
    const stdoutPath = join(directory, 'stdout.txt')
    const stderrPath = join(directory, 'stderr.txt')
    const capture = captureStdio(stdoutPath, stderrPath)
    try {
      const result = spawnSync(engine, ['--version'], { stdio: capture.stdio, windowsHide: true })
      if (result.error !== undefined) return ''
    } finally {
      capture.close()
    }
    return readFileSync(stdoutPath, 'utf8').trim().split(/\r?\n/)[0] ?? ''
  } catch {
    return ''
  } finally {
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true })
  }
}

/**
 * Build a runner that executes scripts through one engine.
 * @param engine - the engine path.
 * @param captureDir - directory for the stdout/stderr capture files.
 * @returns a `run(script, options)` function returning `{ status, stdout, stderr }`.
 */
export function createRunner(engine, captureDir) {
  const stdoutPath = join(captureDir, 'stdout.txt')
  const stderrPath = join(captureDir, 'stderr.txt')
  return function run(script, options = {}) {
    const outFd = openSync(stdoutPath, 'w')
    const errFd = openSync(stderrPath, 'w')
    try {
      const result = spawnSync(engine, ['-c', script], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
        // Opt-in: a caller measuring something that may hang (a candidate utility that reads stdin
        // instead of its file arguments) passes a timeout and reads the null status as a difference.
        ...(options.timeout === undefined ? {} : { timeout: options.timeout, killSignal: 'SIGKILL' }),
      })
      if (result.error !== undefined && options.timeout === undefined) throw result.error
      return {
        status: result.status,
        stdout: readFileSync(stdoutPath, 'utf8'),
        stderr: readFileSync(stderrPath, 'utf8'),
      }
    } finally {
      closeSync(outFd)
      closeSync(errFd)
    }
  }
}

/**
 * The Windows directory itself, with the trailing separator so a sibling directory cannot match it.
 *
 * Matching any path segment called `windows` is not enough: a GitHub runner keeps its real Node under
 * `C:\hostedtoolcache\windows\node\…`, which is not an impostor.
 */
const WINDOWS_ROOT = `${(process.env.SystemRoot ?? 'C:\\Windows').replace(/[\\/]+$/, '').toLowerCase()}\\`

/**
 * Whether a command is the unrelated Windows program of the same name (`find.exe` searches text,
 * `timeout.exe` waits) rather than a POSIX tool.
 * @param path - a resolved command path, in either separator style.
 * @returns true when the path is inside the Windows directory.
 */
export const isWindowsProgram = (path) => path.toLowerCase().replace(/\//g, '\\').startsWith(WINDOWS_ROOT)

/** Git for Windows ships MSYS builds of the POSIX tools under its own tree (`usr\bin`, `mingw64\bin`). */
const MSYS_MARKERS = ['\\git\\usr\\bin\\', '\\git\\mingw64\\bin\\', '\\git\\bin\\']

/**
 * Whether a command resolves to some other implementation of that name, MSYS included.
 *
 * The MSYS builds matter for the same reason the Windows programs do: they expand globs inside their own
 * argv — the behaviour this project's toolchain patches out — so a case about argument handling cannot say
 * anything about it while one of them answers the name.
 * @param path - a resolved command path, in either separator style.
 * @returns true when the path is a Windows program or an MSYS build.
 */
export const isForeignProgram = (path) => {
  const lowered = path.toLowerCase().replace(/\//g, '\\')
  return isWindowsProgram(lowered) || MSYS_MARKERS.some((marker) => lowered.includes(marker))
}

/**
 * POSIX shell semantics: CRLF is a file-format concern, not part of the compared text.
 * @param text - captured stream text.
 * @returns the text with CRLF line endings normalized to LF.
 */
export const normalizeOutput = (text) => text.replace(/\r\n/g, '\n')

/**
 * Evaluate one corpus expectation object against captured stdout.
 *
 * `matches` patterns are applied to the output with its trailing line breaks removed, so an anchored
 * pattern such as `^[-dl][rwx-]{9}$` describes one line rather than having to encode the newline.
 * @param stdout - captured stdout.
 * @param expectation - `equals`, `lines`, `matches`, or `contains`.
 * @returns true when the output satisfies every declared part of the expectation.
 */
export function matchesOutput(stdout, expectation) {
  const actual = normalizeOutput(stdout)
  if (expectation.equals !== undefined) return actual === expectation.equals
  if (expectation.lines !== undefined) {
    const lines = actual.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    const expected = [...expectation.lines].sort()
    const sorted = [...lines].sort()
    return sorted.length === expected.length && sorted.every((line, index) => line === expected[index])
  }
  if (expectation.matches !== undefined) {
    const trimmed = actual.replace(/\n+$/, '')
    return expectation.matches.every((pattern) => new RegExp(pattern).test(trimmed))
  }
  if (expectation.contains !== undefined) return expectation.contains.every((text) => actual.includes(text))
  return true
}

/**
 * True when the captured stdout violates one of the declared `notContains` guards.
 * @param stdout - captured stdout.
 * @param expectation - an expectation object that may carry `notContains`.
 * @returns true when some forbidden text is present.
 */
export function violatesGuards(stdout, expectation) {
  if (expectation.notContains === undefined) return false
  const actual = normalizeOutput(stdout)
  return expectation.notContains.some((text) => actual.includes(text))
}

/**
 * Resolve each declared need to a path, separating absent commands from Windows impostors.
 *
 * A missing command means the toolchain does not provide it yet; a Windows impostor means the name
 * resolves to something with different semantics, which is the failure mode this project exists to
 * remove and therefore must never be mistaken for a satisfied dependency.
 * @param run - a shell runner from {@link createRunner}.
 * @param needs - command names the caller depends on.
 * @param options - `cwd` and `env` for the probe.
 * @returns `{ missing, collisions, foreign }`; the last two are rendered as `name -> path`.
 */
export function probeNeeds(run, needs, options = {}) {
  if (needs.length === 0) return { missing: [], collisions: [], foreign: [] }
  const script = needs.map((name) => `p=$(command -v ${name} 2>/dev/null); printf '%s\\t%s\\n' ${name} "$p"`).join('; ')
  const missing = []
  const collisions = []
  const foreign = []
  for (const line of run(script, options).stdout.replace(/\r\n/g, '\n').split('\n')) {
    if (line.length === 0) continue
    const [name, path = ''] = line.split('\t')
    if (path.length === 0) missing.push(name)
    else if (isWindowsProgram(path)) collisions.push(`${name} -> ${path}`)
    else if (isForeignProgram(path)) foreign.push(`${name} -> ${path}`)
  }
  return { missing, collisions, foreign }
}

/**
 * Build a runner that executes one program with an explicit argv, with no shell involved.
 *
 * This is the discriminator for "did the shell rewrite my argument, or did the program": a POSIX
 * shell resolves quoting before `exec`, so only a direct spawn can tell the two apart.
 * @param captureDir - directory for the stdout/stderr capture files.
 * @returns a `run(program, args, options)` function returning `{ status, stdout, stderr }`.
 */
export function createDirectRunner(captureDir) {
  const stdoutPath = join(captureDir, 'stdout-direct.txt')
  const stderrPath = join(captureDir, 'stderr-direct.txt')
  return function run(program, args, options = {}) {
    const outFd = openSync(stdoutPath, 'w')
    const errFd = openSync(stderrPath, 'w')
    try {
      const result = spawnSync(program, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      })
      if (result.error !== undefined) throw result.error
      return {
        status: result.status,
        stdout: readFileSync(stdoutPath, 'utf8'),
        stderr: readFileSync(stderrPath, 'utf8'),
      }
    } finally {
      closeSync(outFd)
      closeSync(errFd)
    }
  }
}
