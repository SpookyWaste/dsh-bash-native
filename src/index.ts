/**
 * `dsh-bash-native` — a Windows-native POSIX bash executor for the `ctx.shell` seam.
 *
 * The executor is a `LocalBashExecutor` subclass: process mechanics, budgets, deadlines,
 * spill-backed output, background reads, and teardown stay in `@deepseek-ai/dsh-bash-local`,
 * and this module owns three things — resolving a Windows bash engine, building its argv, and
 * honoring the DSH file policy for that engine's family. Loading it registers `ctx.shell` at
 * the scope it is mounted in, so an agent preset can give one agent a bash shell without
 * changing the composition's own executor.
 * @module dsh-bash-native
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { delimiter, dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import { SandboxUnavailableError, classifyRunnerFailure, isRunnerSpawnFailure } from '@deepseek-ai/dsh-sandbox'
import type { RunnerFailureRule, SandboxEnforcement, SandboxMode, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ShellExecRequest, ShellExecSpec, ShellExecution, ShellProcess } from '@deepseek-ai/dsh-shell'
// Type-only imports that bring the `ctx.sandboxPolicy` and `ctx.systemPrompt` service declarations into scope.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { buildCommandArgv, buildShellEnv, interactiveArgsWithRcFile } from './argv.js'
import { preparePackagedEngine, packageRoot } from './artifact.js'
import type { PackagedEngine } from './artifact.js'
import { Config } from './config.js'
import type { BashNativeConfig } from './config.js'
import { describeShellEnvironment } from './prompt.js'
import { engineEnvValue, resolveEngine } from './resolve.js'
import { prepareShellNames } from './shim.js'
import type { EngineResolution, EngineVerdict, ResolvedEngine } from './resolve.js'
import { defaultRcFile, defaultToolsDir, probeToolchain, rcFileContents } from './toolchain.js'
import type { ToolchainProbe } from './toolchain.js'
import { preparePackagedToolchain } from './toolchain-artifact.js'
import { readBrushVersion } from './verify.js'

/** Concurrency-safe plugin name. */
export const name = 'bash-native'

/** Prompt-section name; unique so a scoped contribution shadows rather than duplicates. */
export const ENVIRONMENT_SECTION = 'bash-native:environment'

/** Per-process confinement facts retained until settlement. Providers may vary enforcement and dialect between overlapping calls, so a shared latest-wrap value would classify a process against the wrong facts. */
interface ProcessFacts {
  readonly mode: SandboxMode
  readonly enforcement: SandboxEnforcement
  readonly denialSignatures: readonly string[]
  readonly runnerFailureRules: readonly RunnerFailureRule[]
  readonly runnerProgram: string
  readonly workdir: string
}

/** Engine resolution cached per configuration-and-environment key. */
interface CachedResolution {
  readonly key: string
  readonly resolution: EngineResolution
}

/** Filesystem probe for engine resolution: a readable regular file is an executable candidate. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    // An absent or unreadable candidate is simply not this probe's answer; every miss is reported in the failure list.
    return false
  }
}

/**
 * Directory probe for the toolchain: the file names in it, exactly as the directory spells them.
 *
 * The extension is left in place so the probe can tell an executable from a companion file: stripping
 * every extension here would make `libstdbuf.dll` indistinguishable from an extension-less program, and
 * the contract would advertise a library as a command. The probe knows the platform's suffix and removes
 * it itself.
 *
 * A directory that cannot be read is not an error state — no toolchain built there is supported — so it
 * reports null, and the probe then answers the known names one at a time instead of failing.
 * @param path - the toolchain directory.
 * @returns the file names, or null when the directory cannot be read.
 */
function listDirectory(path: string): readonly string[] | null {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  } catch {
    return null
  }
}

/**
 * Probe the directory the executor should use.
 *
 * A configured directory is used as given, even when it holds nothing: pointing `toolsDir` somewhere is a
 * decision, and silently substituting the packaged toolchain for it would hide a wrong path. Otherwise a
 * per-user toolchain that provides commands wins over the packaged one, so an operator who built their own
 * keeps it, and the packaged toolchain is the fallback that makes a fresh install work.
 * @param configured - the configured `toolsDir`, or an empty string.
 * @param built - the per-user directory, or an empty string when it cannot be derived.
 * @param packaged - the prepared packaged directory, or an empty string when there is none.
 * @param platform - the platform, which decides the executable suffix.
 * @returns the probe.
 */
function probeChosenToolchain(configured: string, built: string, packaged: string, platform: string): ToolchainProbe {
  const fs = { isFile, listDirectory }
  if (configured.length > 0) return probeToolchain(configured, platform, fs)
  const local = probeToolchain(built, platform, fs)
  if (local.provided.length > 0 || packaged.length === 0) return local
  return probeToolchain(packaged, platform, fs)
}

/**
 * Classify a settled confined run as a file-policy denial.
 *
 * The shell's own exit status cannot decide this. A refused file effect belongs to one command, and bash
 * semantics hand the script's status to the last command, so `echo x > <outside>/f; echo done` settles at
 * 0 with the file unwritten — measured with this engine, which reports the refusal on stderr in the same
 * dialect a lone `echo x > <outside>/f` does at status 1. `matchesSignature` in `@deepseek-ai/dsh-sandbox`
 * additionally requires a non-zero status, which is why the denial marker and its escalation hint go
 * missing exactly when a later command masks the refusal; the dialect match is the whole test here, and
 * the only status that cannot carry a denial is a signal death.
 * @param exitCode - the settled status; `null` when a signal ended the process.
 * @param stderr - the retained stderr text.
 * @param signatures - the active provider's dialect plus the configured additions.
 * @returns whether the run refused a file effect under the policy.
 */
function classifiesDenial(exitCode: number | null, stderr: string, signatures: readonly string[]): boolean {
  if (exitCode === null) return false
  const lowered = stderr.toLowerCase()
  return signatures.some((signature) => lowered.includes(signature.toLowerCase()))
}

/**
 * Windows-native bash executor over `ctx.subprocess`.
 *
 * One instance registers the `shell` service for its scope. Every command runs the resolved
 * engine as `engine … -c <command>`; a confined file policy wraps that exact argv through
 * `ctx.sandbox`, and `danger-full-access` spawns it unconfined while still reporting the mode.
 */
export class BashNativeExecutor extends LocalBashExecutor {
  /** The sandbox services are always injected: `confine` selects the policy, not the dependency set. */
  static inject = ['subprocess', 'sandbox', 'sandboxPolicy', 'systemPrompt']

  /**
   * Validated configuration schema, reusing the inherited budget schemas by reference.
   *
   * The assertion reconciles a static-side typing limit only: reading `LocalBashExecutor.Config.dict`
   * erases schemastery's mode parameters, so TS cannot see that the reused fields keep their
   * `volatile` markers, while at runtime this schema is strictly the base schema plus the switches.
   * The configuration this executor reads is typed independently as `BashNativeConfig`.
   */
  static Config = Config as unknown as typeof LocalBashExecutor.Config

  declare readonly config: BashNativeConfig

  /** The configured default file-effect mode — the capability fact the tool layer reads. */
  private readonly mode: SandboxMode

  /** Facts for processes currently confined, keyed by the exact handle the settlement hook receives. */
  private readonly processFacts = new Map<ShellProcess, ProcessFacts>()

  /** Last engine resolution, invalidated when configuration or `PATH` changes. */
  private cachedResolution: CachedResolution | undefined

  /** Last toolchain probe, invalidated when any of the three directories it can use changes. */
  private cachedTools: { readonly key: string; readonly probe: ToolchainProbe } | undefined

  /** Last preparation of the packaged toolchain, which depends only on the package root and `LOCALAPPDATA`. */
  private cachedToolchain: { readonly key: string; readonly dir: string } | undefined

  /** Engine verdicts keyed by absolute path, so each candidate is asked once per process. */
  private readonly verified = new Map<string, EngineVerdict>()

  /** Last preparation of the packaged engine, which depends only on the package root and `LOCALAPPDATA`. */
  private cachedPackaged: { readonly key: string; readonly value: PackagedEngine | null } | undefined

  /** Last creation of the `bash`/`sh` names, keyed by the engine file they stand for. */
  private cachedShellNames: { readonly key: string; readonly dir: string } | undefined

  /** Digests of engines this process resolved from outside the package, so the file is read once. */
  private readonly digests = new Map<string, string>()

  /**
   * @param ctx - the scope this executor registers `shell` in.
   * @param config - validated configuration.
   * @throws when `requireEngineOnLoad` is set and no engine resolves.
   */
  constructor(ctx: Context, config: BashNativeConfig) {
    super(ctx, config)
    this.mode = ctx.sandboxPolicy.defaultMode
    const resolution = this.resolution()
    if (config.requireEngineOnLoad && resolution.engine === null) {
      throw new Error(resolution.failure ?? 'dsh-bash-native: no usable bash engine was found.')
    }
    if (resolution.engine === null) {
      ctx.logger.warn(
        `dsh-bash-native: no bash engine resolved yet, so every \`bash\` call will fail until one is installed.\n${resolution.failure ?? ''}`,
      )
    }
    if (config.promptSection) {
      ctx.effect(
        () =>
          ctx.systemPrompt.section({
            name: ENVIRONMENT_SECTION,
            order: ctx.systemPrompt.getSectionOrder('TOOL_BASH'),
            text: () => describeShellEnvironment(),
          }),
        'dsh-bash-native: shell environment section',
      )
    }
  }

  /** The configured default mode, or undefined when this executor does not confine. */
  get sandboxMode(): SandboxMode | undefined {
    return this.config.confine ? this.mode : undefined
  }

  /** Absolute engine path, or an empty string while no engine resolves. */
  get enginePath(): string {
    return this.resolution().engine?.path ?? ''
  }

  /** Interactive argv prefix for this engine, the `shellArgs` equivalent for a PTY composition. */
  get engineArgs(): readonly string[] {
    const engine = this.resolution().engine
    if (engine === null) return []
    return interactiveArgsWithRcFile(engine, this.interactiveRcFile())
  }

  /**
   * Startup file a PTY session should read, written on demand.
   *
   * A persistent session spawns the engine directly, so it inherits the host environment and never
   * passes through `resolve()`; the file is the only way the toolchain and the `bash`/`sh` names reach it.
   * It is written only when there is something to prepend — a toolchain that provides commands, the shell
   * names, or both — and the engine can use a Windows path in `PATH`: `wsl.exe` receives a Windows path it
   * cannot translate, so it keeps its own startup file. The configured `rcFile` wins over the per-user
   * default, and the parent directory is created: an install whose engine came from `PATH` or
   * `bundledEngineDir` never created the per-user state directory, and the write used to fail there and
   * silently drop the toolchain instead.
   * @returns the path to pass as `--rcfile`, or an empty string to leave the interactive argv alone.
   */
  private interactiveRcFile(): string {
    const engine = this.resolution().engine
    const tools = this.tools()
    const dirs = [tools.provided.length > 0 ? tools.dir : '', this.shellNames()]
    if (engine === null || dirs.every((dir) => dir.length === 0)) return ''
    const file = this.config.rcFile.length > 0 ? this.config.rcFile : defaultRcFile(process.env, tools.dir)
    if (file.length === 0) return ''
    const contents = rcFileContents(dirs, delimiter)
    let existing = ''
    try {
      existing = readFileSync(file, 'utf8')
    } catch {
      // A missing startup file is the normal first run, not a failure: it is written below.
      existing = ''
    }
    if (existing !== contents) {
      try {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, contents)
      } catch (error) {
        // A startup file that cannot be written only costs the persistent session its toolchain; the
        // one-shot path is unaffected, so the interactive argv falls back to `--norc` instead of failing.
        this.ctx.logger?.warn?.(`bash-native: could not write ${file}: ${String(error)}`)
        return ''
      }
    }
    return file
  }

  /** The actionable failure text of the last resolution, or null on success. */
  get engineFailure(): string | null {
    return this.resolution().failure
  }

  /**
   * Apply this executor's defaults and stamp the per-call file policy.
   *
   * The environment is finalized here rather than at spawn time so that every execution path — plain
   * or confined — gets the same layering: the model-friendly defaults, the toolchain directory and the
   * `bash`/`sh` names at the front of `PATH`, the configured overrides, the caller's own entries, and the
   * managed facts last.
   * @param request - the caller's request, whose `sandboxPolicy` carries the calling session's resolved mode.
   * @returns the fully-specified spec.
   */
  resolve(request: ShellExecRequest): ShellExecSpec {
    const spec = super.resolve(request)
    const tools = this.tools()
    const env = buildShellEnv({
      overrides: this.config.shellEnvOverrides,
      toolsDirs: [tools.provided.length > 0 ? tools.dir : '', this.shellNames()],
      basePath: process.env.PATH ?? '',
      env: spec.env,
      dshEnv: spec.dshEnv,
    })
    const resolved: ShellExecSpec = { ...spec, env }
    if (!this.config.confine) return resolved
    return { ...resolved, sandboxPolicy: request.sandboxPolicy ?? this.ctx.sandboxPolicy.resolve() }
  }

  /**
   * The directory that answers to `bash` and `sh`, created once per engine build.
   *
   * A shell that a script, a Makefile or a tool can actually call is the difference between "there is a
   * `bash` tool" and "there is a bash"; the names are links to the verified engine rather than a second
   * binary, and the directory is outside the workspace so a confined session cannot rewrite what the next
   * session will run. No engine, no names: an unresolved composition keeps working and simply lacks them.
   * @returns the directory to prepend to `PATH`, or an empty string when the names cannot be provided.
   */
  private shellNames(): string {
    if (process.platform !== 'win32') return ''
    const engine = this.resolution().engine
    if (engine === null) return ''
    const sha256 = this.engineDigest(engine)
    if (sha256 === null) return ''
    const key = `${engine.path}\n${sha256}\n${process.env.LOCALAPPDATA ?? ''}`
    if (this.cachedShellNames?.key !== key) {
      this.cachedShellNames = { key, dir: prepareShellNames({ engine: engine.path, sha256, env: process.env }) }
    }
    return this.cachedShellNames.dir
  }

  /**
   * The digest that names one engine's shell-name directory.
   *
   * The packaged engine's digest comes from the lock it was verified against, so nothing is read twice; an
   * engine that came from `bashPath`, `bundledEngineDir` or `PATH` has no lock, and its file is hashed once
   * per process — the shell names are addressed by content, so a rebuilt engine must not reuse them.
   * @param engine - the resolved engine.
   * @returns its sha256, or null when the file cannot be read.
   */
  private engineDigest(engine: ResolvedEngine): string | null {
    const packaged = this.packaged()
    if (packaged !== null && 'ready' in packaged && packaged.ready === engine.path) return packaged.sha256
    const known = this.digests.get(engine.path)
    if (known !== undefined) return known
    try {
      const digest = createHash('sha256').update(readFileSync(engine.path)).digest('hex')
      this.digests.set(engine.path, digest)
      return digest
    } catch (error) {
      // An engine that cannot be read cannot be linked either, so the names are simply not provided and the
      // reason would have nowhere to go that the caller's logger does not already cover.
      void error
      return null
    }
  }

  /**
   * Probe the toolchain directory the contract and the environment both read.
   *
   * A configured `toolsDir` is the operator's decision and is probed as given, even when it holds nothing.
   * Otherwise a toolchain built into the per-user directory wins — someone who built one, possibly from
   * patched sources, keeps it — and the packaged toolchain is the fallback that makes an install work with
   * nothing installed but the package. The choice is memoized on all three directories, so replacing the
   * package re-probes.
   * @returns the probe the contract and the environment both read.
   */
  private tools(): ToolchainProbe {
    const configured = this.config.toolsDir
    const built = configured.length > 0 ? '' : defaultToolsDir(process.env, process.platform)
    const packaged = configured.length > 0 || built.length === 0 ? '' : this.packagedToolchain()
    const key = [configured, built, packaged, process.platform].join('\n')
    if (this.cachedTools?.key !== key) {
      this.cachedTools = { key, probe: probeChosenToolchain(configured, built, packaged, process.platform) }
    }
    return this.cachedTools.probe
  }

  /**
   * The packaged toolchain's `bin` directory, prepared once per package placement and `LOCALAPPDATA`.
   *
   * A refusal is logged once and then reported as "no packaged toolchain": the probe that follows states
   * which commands are missing, so the contract tells the truth either way rather than claiming a
   * capability the install does not have.
   * @returns the directory to probe, or an empty string when the package carries none.
   */
  private packagedToolchain(): string {
    if (process.platform !== 'win32') return ''
    const root = packageRoot()
    const key = `${root}\n${process.env.LOCALAPPDATA ?? ''}\n${this.config.verifyArtifacts}`
    if (this.cachedToolchain?.key !== key) {
      const prepared = preparePackagedToolchain({
        packageRoot: root,
        env: process.env,
        verify: this.config.verifyArtifacts,
      })
      if ('refused' in prepared) {
        this.ctx.logger?.warn?.(`bash-native: the packaged toolchain cannot be used: ${prepared.refused}`)
        this.cachedToolchain = { key, dir: '' }
      } else {
        this.cachedToolchain = { key, dir: prepared.ready }
      }
    }
    return this.cachedToolchain.dir
  }

  /**
   * Run one command through the resolved engine under its resolved file policy.
   * @param spec - a resolved spec from {@link BashNativeExecutor.resolve}.
   * @returns the live execution handle.
   * @throws when no engine resolves.
   */
  async execute(spec: ShellExecSpec): Promise<ShellExecution> {
    const engine = this.requireEngine()
    const argv = buildCommandArgv(engine, spec.command)
    const policy = spec.sandboxPolicy
    if (!this.config.confine || policy === undefined) return this.executeArgv(spec, argv)
    const mode = policy.mode
    if (mode === 'danger-full-access') {
      return BashNativeExecutor.decorateResult(await this.executeArgv(spec, argv), (result) => ({
        ...result,
        sandbox: { mode, denied: false },
      }))
    }
    let facts: ProcessFacts | undefined
    const execution = await this.executeArgv(
      spec,
      async (signal) => {
        const confined = await this.confine(argv, { ...policy, mode }, signal)
        signal.throwIfAborted()
        facts = {
          mode,
          enforcement: confined.enforcement,
          denialSignatures: [...confined.denialSignatures, ...this.config.denialSignatureAdditions],
          runnerFailureRules: confined.runnerFailureRules,
          runnerProgram: confined.argv[0] ?? engine.path,
          workdir: spec.workdir,
        }
        return confined.argv
      },
      (process) => {
        if (facts !== undefined) this.processFacts.set(process, facts)
      },
    )
    return BashNativeExecutor.decorateResult(
      execution,
      (result) => {
        const retained = facts
        if (retained === undefined) return { ...result, sandbox: { mode, denied: false } }
        const runnerFailure = classifyRunnerFailure(result.exitCode, result.stderr.text, retained.runnerFailureRules)
        if (runnerFailure !== undefined) throw new SandboxUnavailableError(mode, runnerFailure.detail)
        return {
          ...result,
          sandbox: {
            mode,
            denied: classifiesDenial(result.exitCode, result.stderr.text, retained.denialSignatures),
            enforcement: retained.enforcement,
          },
        }
      },
      (error) => {
        if (spec.signal?.aborted === true) spec.signal.throwIfAborted()
        const retained = facts
        if (retained !== undefined && isRunnerSpawnFailure(error, retained.runnerProgram, spec.workdir)) {
          throw new SandboxUnavailableError(mode, String(error))
        }
        throw error
      },
    )
  }

  /**
   * Stamp per-process sandbox facts before `done` settles.
   * @param proc - the settled process handle.
   * @param stderr - the retained stderr tail used for settlement classification.
   * @param providerRejected - whether the subprocess promise rejected without a direct outcome.
   * @param providerError - the provider rejection reason, when any.
   */
  protected onProcessDone(proc: ShellProcess, stderr: string, providerRejected: boolean, providerError?: unknown): void {
    const facts = this.processFacts.get(proc)
    if (facts !== undefined) {
      this.processFacts.delete(proc)
      const runnerFailed = providerRejected
        ? isRunnerSpawnFailure(providerError, facts.runnerProgram, facts.workdir)
        : classifyRunnerFailure(proc.exitCode, stderr, facts.runnerFailureRules) !== undefined
      proc.sandbox = {
        mode: facts.mode,
        denied: !runnerFailed && classifiesDenial(proc.exitCode, stderr, facts.denialSignatures),
        enforcement: facts.enforcement,
        ...(runnerFailed ? { runnerFailed } : {}),
      }
    }
    super.onProcessDone(proc, stderr, providerRejected, providerError)
  }

  /**
   * Wrap the exact engine argv through the sandbox provider.
   * @param argv - the engine argv about to be spawned.
   * @param policy - the resolved confined policy for this call.
   * @param signal - cancellation of confinement preparation.
   * @returns the provider's argv and settlement-classification facts.
   */
  private confine(argv: readonly string[], policy: SandboxPolicy, signal: AbortSignal) {
    return this.ctx.sandbox.confine(argv, policy, signal)
  }

  /**
   * Resolve the engine, reusing the cached result while configuration and `PATH` are unchanged.
   * @returns the current resolution, including its actionable failure text when nothing resolved.
   */
  private resolution(): EngineResolution {
    const key = JSON.stringify([
      this.config.bashPath,
      this.config.bundledEngineDir,
      engineEnvValue(process.env, 'PATH') ?? '',
      process.platform,
      this.config.verifyArtifacts,
    ])
    if (this.cachedResolution?.key !== key) {
      this.cachedResolution = {
        key,
        resolution: resolveEngine(
          { bashPath: this.config.bashPath, bundledEngineDir: this.config.bundledEngineDir, packaged: this.packaged() },
          process.env,
          process.platform,
          { isFile },
          (path) => this.verifyEngine(path),
        ),
      }
    }
    return this.cachedResolution.resolution
  }

  /**
   * The engine this package ships, verified for the place it runs from.
   *
   * Preparation verifies the artifact and hands back its own path, so it is memoized on the inputs that can
   * change that answer: the package root, `LOCALAPPDATA` (where the stamp lives) and the verification mode.
   * Off Windows the shipped artifact is not this platform's engine, so no candidate is contributed, and a
   * configured `bashPath` outranks it without being prepared at all.
   * @returns the prepared engine or its refusal, or null when this composition carries none.
   */
  private packaged(): PackagedEngine | null {
    if (process.platform !== 'win32') return null
    if (this.config.bashPath.trim().length > 0) return null
    const root = packageRoot()
    const key = `${root}\n${process.env.LOCALAPPDATA ?? ''}\n${this.config.verifyArtifacts}`
    if (this.cachedPackaged?.key !== key) {
      this.cachedPackaged = {
        key,
        value: preparePackagedEngine({ packageRoot: root, env: process.env, verify: this.config.verifyArtifacts }),
      }
    }
    return this.cachedPackaged.value
  }

  /**
   * Ask one candidate binary whether it is brush, memoized per absolute path.
   *
   * The spawn is one bounded `--version` per candidate per resolution, and resolution itself is cached
   * on configuration and `PATH`, so this runs once per configuration rather than per command. A
   * subclass may answer from a fixture instead of spawning, which is how the executor's own tests keep
   * resolution hermetic; the identification parse itself has its own test.
   * @param path - an existing absolute executable from the probe list.
   * @returns the verdict the resolver reads.
   */
  protected verifyEngine(path: string): EngineVerdict {
    const cached = this.verified.get(path)
    if (cached !== undefined) return cached
    const verdict = readBrushVersion(path)
    this.verified.set(path, verdict)
    return verdict
  }

  /**
   * Resolve the engine or fail with every probed candidate and a remedy.
   * @returns the resolved engine.
   * @throws Error carrying the resolution failure text.
   */
  private requireEngine(): ResolvedEngine {
    const resolution = this.resolution()
    if (resolution.engine === null) {
      throw new Error(resolution.failure ?? 'dsh-bash-native: no usable bash engine was found.')
    }
    return resolution.engine
  }

  /**
   * Decorate the handle's foreground projection in place, memoized once. The handle keeps its
   * identity because the per-process facts and the settlement hook key on the exact instance.
   * @param execution - the handle to decorate.
   * @param map - success projection.
   * @param mapError - rejection projection.
   * @returns the same handle with its `result()` projection replaced.
   */
  private static decorateResult(
    execution: ShellExecution,
    map: (result: Awaited<ReturnType<ShellExecution['result']>>) => Awaited<ReturnType<ShellExecution['result']>>,
    mapError?: (error: unknown) => never,
  ): ShellExecution {
    const base = execution.result.bind(execution)
    let decorated: ReturnType<ShellExecution['result']> | undefined
    execution.result = () => {
      decorated ??= base().then(map, mapError)
      return decorated
    }
    return execution
  }
}

export default BashNativeExecutor
