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
import type { Context } from '@deepseek-ai/cordis';
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox';
import type { ShellExecRequest, ShellExecSpec, ShellExecution, ShellProcess } from '@deepseek-ai/dsh-shell';
import type { BashNativeConfig } from './config.js';
import type { EngineVerdict } from './resolve.js';
/** Concurrency-safe plugin name. */
export declare const name = "bash-native";
/** Prompt-section name; unique so a scoped contribution shadows rather than duplicates. */
export declare const ENVIRONMENT_SECTION = "bash-native:environment";
/**
 * Windows-native bash executor over `ctx.subprocess`.
 *
 * One instance registers the `shell` service for its scope. Every command runs the resolved
 * engine as `engine … -c <command>`; a confined file policy wraps that exact argv through
 * `ctx.sandbox`, and `danger-full-access` spawns it unconfined while still reporting the mode.
 */
export declare class BashNativeExecutor extends LocalBashExecutor {
    /** The sandbox services are always injected: `confine` selects the policy, not the dependency set. */
    static inject: string[];
    /**
     * Validated configuration schema, reusing the inherited budget schemas by reference.
     *
     * The assertion reconciles a static-side typing limit only: reading `LocalBashExecutor.Config.dict`
     * erases schemastery's mode parameters, so TS cannot see that the reused fields keep their
     * `volatile` markers, while at runtime this schema is strictly the base schema plus the switches.
     * The configuration this executor reads is typed independently as `BashNativeConfig`.
     */
    static Config: typeof LocalBashExecutor.Config;
    readonly config: BashNativeConfig;
    /** The configured default file-effect mode — the capability fact the tool layer reads. */
    private readonly mode;
    /** Facts for processes currently confined, keyed by the exact handle the settlement hook receives. */
    private readonly processFacts;
    /** Last engine resolution, invalidated when configuration or `PATH` changes. */
    private cachedResolution;
    /** Last toolchain probe, invalidated when any of the three directories it can use changes. */
    private cachedTools;
    /** Last preparation of the packaged toolchain, which depends only on the package root and `LOCALAPPDATA`. */
    private cachedToolchain;
    /** Engine verdicts keyed by absolute path, so each candidate is asked once per process. */
    private readonly verified;
    /** Last preparation of the packaged engine, which depends only on the package root and `LOCALAPPDATA`. */
    private cachedPackaged;
    /** Last creation of the `bash`/`sh` names, keyed by the engine file they stand for. */
    private cachedShellNames;
    /** Digests of engines this process resolved from outside the package, so the file is read once. */
    private readonly digests;
    /**
     * @param ctx - the scope this executor registers `shell` in.
     * @param config - validated configuration.
     * @throws when `requireEngineOnLoad` is set and no engine resolves.
     */
    constructor(ctx: Context, config: BashNativeConfig);
    /** The configured default mode, or undefined when this executor does not confine. */
    get sandboxMode(): SandboxMode | undefined;
    /** Absolute engine path, or an empty string while no engine resolves. */
    get enginePath(): string;
    /** Interactive argv prefix for this engine, the `shellArgs` equivalent for a PTY composition. */
    get engineArgs(): readonly string[];
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
    private interactiveRcFile;
    /** The actionable failure text of the last resolution, or null on success. */
    get engineFailure(): string | null;
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
    resolve(request: ShellExecRequest): ShellExecSpec;
    /**
     * The directory that answers to `bash` and `sh`, created once per engine build.
     *
     * A shell that a script, a Makefile or a tool can actually call is the difference between "there is a
     * `bash` tool" and "there is a bash"; the names are links to the verified engine rather than a second
     * binary, and the directory is outside the workspace so a confined session cannot rewrite what the next
     * session will run. No engine, no names: an unresolved composition keeps working and simply lacks them.
     * @returns the directory to prepend to `PATH`, or an empty string when the names cannot be provided.
     */
    private shellNames;
    /**
     * The digest that names one engine's shell-name directory.
     *
     * The packaged engine's digest comes from the lock it was verified against, so nothing is read twice; an
     * engine that came from `bashPath`, `bundledEngineDir` or `PATH` has no lock, and its file is hashed once
     * per process — the shell names are addressed by content, so a rebuilt engine must not reuse them.
     * @param engine - the resolved engine.
     * @returns its sha256, or null when the file cannot be read.
     */
    private engineDigest;
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
    private tools;
    /**
     * The packaged toolchain's `bin` directory, prepared once per package placement and `LOCALAPPDATA`.
     *
     * A refusal is logged once and then reported as "no packaged toolchain": the probe that follows states
     * which commands are missing, so the contract tells the truth either way rather than claiming a
     * capability the install does not have.
     * @returns the directory to probe, or an empty string when the package carries none.
     */
    private packagedToolchain;
    /**
     * Run one command through the resolved engine under its resolved file policy.
     * @param spec - a resolved spec from {@link BashNativeExecutor.resolve}.
     * @returns the live execution handle.
     * @throws when no engine resolves.
     */
    execute(spec: ShellExecSpec): Promise<ShellExecution>;
    /**
     * Stamp per-process sandbox facts before `done` settles.
     * @param proc - the settled process handle.
     * @param stderr - the retained stderr tail used for settlement classification.
     * @param providerRejected - whether the subprocess promise rejected without a direct outcome.
     * @param providerError - the provider rejection reason, when any.
     */
    protected onProcessDone(proc: ShellProcess, stderr: string, providerRejected: boolean, providerError?: unknown): void;
    /**
     * Wrap the exact engine argv through the sandbox provider.
     * @param argv - the engine argv about to be spawned.
     * @param policy - the resolved confined policy for this call.
     * @param signal - cancellation of confinement preparation.
     * @returns the provider's argv and settlement-classification facts.
     */
    private confine;
    /**
     * Resolve the engine, reusing the cached result while configuration and `PATH` are unchanged.
     * @returns the current resolution, including its actionable failure text when nothing resolved.
     */
    private resolution;
    /**
     * The engine this package ships, verified for the place it runs from.
     *
     * Preparation verifies the artifact and hands back its own path, so it is memoized on the inputs that can
     * change that answer: the package root, `LOCALAPPDATA` (where the stamp lives) and the verification mode.
     * Off Windows the shipped artifact is not this platform's engine, so no candidate is contributed, and a
     * configured `bashPath` outranks it without being prepared at all.
     * @returns the prepared engine or its refusal, or null when this composition carries none.
     */
    private packaged;
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
    protected verifyEngine(path: string): EngineVerdict;
    /**
     * Resolve the engine or fail with every probed candidate and a remedy.
     * @returns the resolved engine.
     * @throws Error carrying the resolution failure text.
     */
    private requireEngine;
    /**
     * Decorate the handle's foreground projection in place, memoized once. The handle keeps its
     * identity because the per-process facts and the settlement hook key on the exact instance.
     * @param execution - the handle to decorate.
     * @param map - success projection.
     * @param mapError - rejection projection.
     * @returns the same handle with its `result()` projection replaced.
     */
    private static decorateResult;
}
export default BashNativeExecutor;
