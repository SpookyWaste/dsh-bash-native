/**
 * Engine resolution for the `dsh-bash-native` executor.
 *
 * This plugin runs exactly one engine: brush (`brush-shell`), the Rust bash implementation that needs
 * no MSYS runtime and therefore starts under every DSH sandbox tier. A configured absolute path is
 * still verified by asking the binary, so a same-named foreign program — `bash.exe` from Git for
 * Windows, MSYS2 or Cygwin, or the `wsl.exe` trampoline — is refused instead of silently becoming the
 * engine (see {@link engineRemedy} for why those cannot be the engine here, and
 * `@deepseek-ai/dsh-bash-local` for deployments that want them).
 *
 * Resolution is a pure function of `(input, env, platform, fs, verify)`: candidate order and every
 * diagnostic are testable with no engine installed, and the one operation that cannot be pure — running
 * the binary to identify it — enters through the {@link EngineVerifier} seam.
 * @module dsh-bash-native/resolve
 */

import { posix, win32 } from 'node:path'
import type { PackagedEngine } from './artifact.js'

/** Activation argv placed before the command string. */
const ACTIVATION = ['-c'] as const
/**
 * Interactive prefix for the engine, mirroring the bash dialect default of
 * `@deepseek-ai/dsh-terminal-bash` (`--noprofile --norc -i`) so an explicitly overriding
 * composition keeps profile-free behavior.
 */
const INTERACTIVE = ['--noprofile', '--norc', '-i'] as const

/** One un-answered probe. */
interface Probe {
  readonly label: string
  /** Path or bare name as a human reads it in a failure list. */
  readonly displayPath: string
  /** Absolute path to verify, or null when `lookupName` carries the probe. */
  readonly absolutePath: string | null
  /** Bare executable name to resolve on `PATH`, or null for an absolute-path probe. */
  readonly lookupName: string | null
  /** A refusal decided before probing, for a candidate that cannot be prepared at all. */
  readonly refused?: string
}

/** One answered probe, reported on failure so the caller sees every candidate that was tried. */
export interface EngineProbeResult {
  /** Human-readable origin, e.g. `per-user engine directory`. */
  readonly label: string
  /** The path or bare name this probe looked for. */
  readonly displayPath: string
  /** Whether the probe resolved to an existing file. */
  readonly found: boolean
  /** Why a found file was refused, or absent when the candidate was accepted. */
  readonly refused?: string
}

/** The engine the executor drives. */
export interface ResolvedEngine {
  /** Absolute executable path. */
  readonly path: string
  /** Probe label that resolved, used in logs and results. */
  readonly label: string
  /** The engine's own `--version` first line, or an empty string when the verifier reported none. */
  readonly version: string
  /** Activation argv prefix passed before the command string. */
  readonly args: readonly string[]
  /** Interactive argv prefix, the `shellArgs` equivalent for a PTY composition. */
  readonly interactiveArgs: readonly string[]
}

/** Outcome of one resolution: an engine, or the complete probe list plus a remedy. */
export interface EngineResolution {
  /** The resolved engine, or null when no candidate exists. */
  readonly engine: ResolvedEngine | null
  /** Every candidate that was probed, in order. */
  readonly probed: readonly EngineProbeResult[]
  /** Actionable failure text, or null on success. */
  readonly failure: string | null
}

/** Inputs the executor's configuration contributes to resolution. */
export interface ResolveEngineInput {
  /** Configured absolute engine path; empty means "resolve". */
  readonly bashPath: string
  /** Directory holding a packaged engine, probed as `brush.exe` and `bin/brush.exe`. */
  readonly bundledEngineDir: string
  /**
   * The engine this package ships, already prepared for execution by `./artifact.ts`, or the reason it
   * could not be. Null off Windows and in compositions that carry no artifact.
   */
  readonly packaged: PackagedEngine | null
}

/** What asking one existing candidate file produced. */
export interface EngineVerdict {
  /** The engine's own `--version` first line when it identified itself, else an empty string. */
  readonly version: string
  /** Why this file is not the engine, or null when it is. */
  readonly refused: string | null
}

/** The one impure step of resolution, injected so candidate order stays testable. */
export interface EngineVerifier {
  /**
   * @param path - an existing absolute executable.
   * @returns whether it is the engine, and the version it reported.
   */
  (path: string): EngineVerdict
}

/** Environment view; Windows names are matched case-insensitively by {@link engineEnvValue}. */
export interface EngineEnv {
  readonly [name: string]: string | undefined
}

/** Filesystem probe seam: the executor passes `node:fs`, tests pass a fixture set. */
export interface EngineFs {
  isFile(path: string): boolean
}

/**
 * The remedy paragraph appended to every resolution failure.
 *
 * The two engine families this plugin deliberately does not drive are named here, because a user who
 * reached for them needs the reason rather than a probe list: an MSYS-runtime shell (Git for Windows,
 * MSYS2, Cygwin) cannot start under a confined tier, and `wsl.exe` writes where the file policy cannot
 * observe. Both remain reachable through `@deepseek-ai/dsh-bash-local`, which runs whatever `bash` its
 * `PATH` resolves and therefore needs no field pointing at an engine.
 *
 * The install half may only recommend a build the verifier accepts, and the only one it accepts is this
 * repository's own patched build: an upstream `cargo install` looks like the obvious answer and is
 * refused by the same paragraph's probe list, so naming it would send a reader through a full Rust build
 * to be rejected again.
 * @param platform - operating system the executor runs on.
 * @returns the failure text's remedy section.
 */
export function engineRemedy(platform: NodeJS.Platform): string {
  const install =
    platform === 'win32'
      ? 'This package ships the brush engine at `engine/win32-x64/brush.exe` and verifies it against `engine.lock.json`; a row above marked `refused` says what went wrong with it. The facts this contract states come from this repository\'s patches, so a `cargo install` build is refused: rebuild the pinned commit with `node scripts/build-engine.mjs --refresh` in a source checkout (Rust, and network on the first run), which replaces the artifact in this package, then reload this plugin so resolution reads it again.'
      : 'The engine this executor drives is the Windows build this repository patches, and one verified fact — the `/q/x` to `Q:\\x` argument rule — exists only in that build, so no candidate resolves on this platform. Run the `bash` on `PATH` with `@deepseek-ai/dsh-bash-local` instead.'
  return [
    install,
    'This executor runs brush only, and verifies it by asking the binary. It does not drive other shells:',
    '  - Git for Windows, MSYS2 and Cygwin bash need the MSYS runtime\'s named pipes, which the restricted',
    '    token of a confined tier denies, so they die at startup ("couldn\'t create signal pipe, Win32 error 5");',
    '  - `wsl.exe` runs the command inside a Linux VM, where no DSH runner observes or denies its writes.',
    'For either of those, put a `bash` on `PATH` and use `@deepseek-ai/dsh-bash-local`: that executor runs `bash -c` from `PATH` and offers no engine path of its own.',
  ].join('\n')
}

/**
 * Read one environment entry with Windows' case-insensitive semantics.
 * @param env - environment view to read.
 * @param name - variable name to look up.
 * @returns the value, or undefined when absent.
 */
export function engineEnvValue(env: EngineEnv, name: string): string | undefined {
  if (env[name] !== undefined) return env[name]
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === wanted) return value
  }
  return undefined
}

/**
 * Resolve the engine by probing every candidate in order.
 *
 * The order is: an explicit `bashPath`, then an explicit `bundledEngineDir`, then the engine this package
 * ships (already prepared outside the workspace by `./artifact.ts`), then `brush` on `PATH`. Every
 * candidate that exists is verified, and a candidate that exists but is not brush is reported as refused
 * rather than accepted, so the failure list distinguishes "nothing is installed" from "the thing you
 * pointed at is a different shell".
 * @param input - configured engine sources.
 * @param env - environment providing `PATH` and `LOCALAPPDATA`.
 * @param platform - operating system the executor runs on.
 * @param fs - filesystem probe seam.
 * @param verify - the one impure step: asking a candidate binary what it is.
 * @returns the resolved engine, or the probed candidates plus actionable failure text.
 */
export function resolveEngine(
  input: ResolveEngineInput,
  env: EngineEnv,
  platform: NodeJS.Platform,
  fs: EngineFs,
  verify: EngineVerifier,
): EngineResolution {
  const pathApi = platform === 'win32' ? win32 : posix
  const explicit = input.bashPath.trim()
  if (explicit !== '') {
    if (!pathApi.isAbsolute(explicit)) {
      return {
        engine: null,
        probed: [{ label: 'configured bashPath', displayPath: explicit, found: false }],
        failure: `dsh-bash-native: bashPath must be an absolute path; got "${explicit}".`,
      }
    }
    const accepted = accept(explicit, 'configured bashPath', fs, verify)
    return accepted.engine !== null
      ? { engine: accepted.engine, probed: accepted.probed, failure: null }
      : { engine: null, probed: accepted.probed, failure: `${failureHead(accepted.probed)}\n${engineRemedy(platform)}` }
  }
  const probed: EngineProbeResult[] = []
  for (const probe of buildProbes(input, platform, pathApi)) {
    if (probe.refused !== undefined) {
      probed.push({ label: probe.label, displayPath: probe.displayPath, found: false, refused: probe.refused })
      continue
    }
    const found =
      probe.lookupName !== null
        ? lookupOnPath(probe.lookupName, env, platform, pathApi, fs)
        : probe.absolutePath !== null && fs.isFile(probe.absolutePath)
          ? probe.absolutePath
          : null
    if (found === null) {
      probed.push({ label: probe.label, displayPath: probe.displayPath, found: false })
      continue
    }
    const accepted = accept(found, probe.label, fs, verify)
    probed.push(...accepted.probed)
    if (accepted.engine !== null) return { engine: accepted.engine, probed, failure: null }
  }
  return { engine: null, probed, failure: `${failureHead(probed)}\n${engineRemedy(platform)}` }
}

/** Verify one existing file and build the resolved-engine record when it is the engine. */
function accept(
  path: string,
  label: string,
  fs: EngineFs,
  verify: EngineVerifier,
): { engine: ResolvedEngine | null; probed: EngineProbeResult[] } {
  if (!fs.isFile(path)) return { engine: null, probed: [{ label, displayPath: path, found: false }] }
  const verdict = verify(path)
  if (verdict.refused !== null) {
    return { engine: null, probed: [{ label, displayPath: path, found: true, refused: verdict.refused }] }
  }
  return {
    engine: { path, label, version: verdict.version, args: [...ACTIVATION], interactiveArgs: [...INTERACTIVE] },
    probed: [{ label, displayPath: path, found: true }],
  }
}

/** Render the probed-candidate list every failure starts with. */
function failureHead(probed: readonly EngineProbeResult[]): string {
  const rows = probed.map((probe) => {
    const state = probe.refused !== undefined ? `refused: ${probe.refused}` : probe.found ? 'found' : 'missing'
    return `  - ${probe.label}: ${probe.displayPath} -> ${state}`
  })
  return ['dsh-bash-native: no usable brush engine was found. Probed:', ...rows].join('\n')
}

/** Build the ordered probe list for a platform. */
function buildProbes(input: ResolveEngineInput, platform: NodeJS.Platform, pathApi: typeof win32): Probe[] {
  const suffix = platform === 'win32' ? '.exe' : ''
  const probes: Probe[] = []
  const at = (path: string, label: string): Probe => ({ label, displayPath: path, absolutePath: path, lookupName: null })
  const dir = input.bundledEngineDir.trim()
  if (dir !== '') {
    probes.push(at(pathApi.join(dir, `brush${suffix}`), 'bundled engine directory'))
    probes.push(at(pathApi.join(dir, 'bin', `brush${suffix}`), 'bundled engine directory (bin)'))
  }
  if (input.packaged !== null) {
    probes.push(
      'ready' in input.packaged
        ? at(input.packaged.ready, 'packaged engine')
        : { label: 'packaged engine', displayPath: 'this package', absolutePath: null, lookupName: null, refused: input.packaged.refused },
    )
  }
  probes.push({ label: 'brush on PATH', displayPath: 'brush', absolutePath: null, lookupName: 'brush' })
  return probes
}

/** Resolve a bare executable name against `PATH`, honoring Windows' extension order. */
function lookupOnPath(name: string, env: EngineEnv, platform: NodeJS.Platform, pathApi: typeof win32, fs: EngineFs): string | null {
  const raw = engineEnvValue(env, 'PATH') ?? ''
  const separator = platform === 'win32' ? ';' : ':'
  const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const entry of raw.split(separator)) {
    const trimmed = entry.trim().replace(/^"(.*)"$/, '$1')
    if (trimmed === '') continue
    for (const extension of extensions) {
      const candidate = pathApi.join(trimmed, `${name}${extension}`)
      if (fs.isFile(candidate)) return candidate
    }
  }
  return null
}