/**
 * argv and environment construction for the `dsh-bash-native` executor.
 *
 * Every function here is pure, so the exact spawn shape is testable with no engine installed.
 * Environment layering mirrors `@deepseek-ai/dsh-bash-local`: the model-friendly overrides come
 * first and a trusted caller's own entry still wins. `TMP`, `TEMP` and `TMPDIR` are deliberately
 * never written — the sandbox runner owns the confined child's temp authorization, and a
 * second opinion here would either widen or break it.
 * @module dsh-bash-native/argv
 */
import type { ResolvedEngine } from './resolve.js';
/** Environment layers for one execution, lowest precedence first. */
export interface ShellEnvLayers {
    /** Executor-configured extra overrides, layered directly above the model-friendly defaults. */
    readonly overrides?: Readonly<Record<string, string>> | undefined;
    /** Ordinary per-call environment from the request. */
    readonly env?: Readonly<Record<string, string>> | undefined;
    /** Managed `DSH_*` facts, which merge last so no ordinary entry can displace one. */
    readonly dshEnv?: Readonly<Record<string, string>> | undefined;
    /** Directories to prepend to `PATH`, highest priority first; omitted when this execution leaves `PATH` alone. */
    readonly toolsDirs?: readonly string[] | undefined;
    /** The inherited `PATH` those directories go in front of. */
    readonly basePath?: string | undefined;
}
/**
 * Build the argv that runs one command string through the engine.
 * @param engine - the resolved engine.
 * @param command - the caller's command text, passed verbatim as the shell's operand.
 * @returns the exact argv to spawn.
 */
export declare function buildCommandArgv(engine: ResolvedEngine, command: string): string[];
/**
 * Build the argv that starts an interactive session on the engine.
 * @param engine - the resolved engine.
 * @returns the exact argv a PTY backend would spawn.
 */
export declare function buildInteractiveArgv(engine: ResolvedEngine): string[];
/**
 * Interactive argv with a startup file, which is the toolchain's way into a persistent PTY session.
 *
 * The bash-shaped prefix carries `--norc`, and `--rcfile` is mutually exclusive with it by design, so
 * the flag is replaced rather than added. An engine whose prefix is not bash-shaped is returned
 * unchanged: it has its own way of naming a startup file, and inventing one would be a guess. An empty
 * `rcFile` is the plain interactive prefix, which is why the executor has this one entry point.
 * @param engine - the resolved engine.
 * @param rcFile - the startup file to read, or an empty string for no startup file.
 * @returns the interactive argv prefix for that engine, without the executable path.
 */
export declare function interactiveArgsWithRcFile(engine: ResolvedEngine, rcFile: string): string[];
/**
 * Layer one execution's environment.
 *
 * The subprocess seam merges these entries over a scrubbed copy of the parent environment, so `PATH`
 * survives on its own; the toolchain and shell-name directories therefore have to be prepended to the
 * *inherited* value, which is why the base `PATH` is an input rather than something read here.
 * @param layers - the executor overrides, the directories to prepend, the request environment, and the managed facts.
 * @returns the explicit environment entries to hand the subprocess seam.
 */
export declare function buildShellEnv(layers: ShellEnvLayers): Record<string, string>;
