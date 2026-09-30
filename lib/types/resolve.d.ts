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
import type { PackagedEngine } from './artifact.js';
/** One answered probe, reported on failure so the caller sees every candidate that was tried. */
export interface EngineProbeResult {
    /** Human-readable origin, e.g. `per-user engine directory`. */
    readonly label: string;
    /** The path or bare name this probe looked for. */
    readonly displayPath: string;
    /** Whether the probe resolved to an existing file. */
    readonly found: boolean;
    /** Why a found file was refused, or absent when the candidate was accepted. */
    readonly refused?: string;
}
/** The engine the executor drives. */
export interface ResolvedEngine {
    /** Absolute executable path. */
    readonly path: string;
    /** Probe label that resolved, used in logs and results. */
    readonly label: string;
    /** The engine's own `--version` first line, or an empty string when the verifier reported none. */
    readonly version: string;
    /** Activation argv prefix passed before the command string. */
    readonly args: readonly string[];
    /** Interactive argv prefix, the `shellArgs` equivalent for a PTY composition. */
    readonly interactiveArgs: readonly string[];
}
/** Outcome of one resolution: an engine, or the complete probe list plus a remedy. */
export interface EngineResolution {
    /** The resolved engine, or null when no candidate exists. */
    readonly engine: ResolvedEngine | null;
    /** Every candidate that was probed, in order. */
    readonly probed: readonly EngineProbeResult[];
    /** Actionable failure text, or null on success. */
    readonly failure: string | null;
}
/** Inputs the executor's configuration contributes to resolution. */
export interface ResolveEngineInput {
    /** Configured absolute engine path; empty means "resolve". */
    readonly bashPath: string;
    /** Directory holding a packaged engine, probed as `brush.exe` and `bin/brush.exe`. */
    readonly bundledEngineDir: string;
    /**
     * The engine this package ships, already prepared for execution by `./artifact.ts`, or the reason it
     * could not be. Null off Windows and in compositions that carry no artifact.
     */
    readonly packaged: PackagedEngine | null;
}
/** What asking one existing candidate file produced. */
export interface EngineVerdict {
    /** The engine's own `--version` first line when it identified itself, else an empty string. */
    readonly version: string;
    /** Why this file is not the engine, or null when it is. */
    readonly refused: string | null;
}
/** The one impure step of resolution, injected so candidate order stays testable. */
export interface EngineVerifier {
    /**
     * @param path - an existing absolute executable.
     * @returns whether it is the engine, and the version it reported.
     */
    (path: string): EngineVerdict;
}
/** Environment view; Windows names are matched case-insensitively by {@link engineEnvValue}. */
export interface EngineEnv {
    readonly [name: string]: string | undefined;
}
/** Filesystem probe seam: the executor passes `node:fs`, tests pass a fixture set. */
export interface EngineFs {
    isFile(path: string): boolean;
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
export declare function engineRemedy(platform: NodeJS.Platform): string;
/**
 * Read one environment entry with Windows' case-insensitive semantics.
 * @param env - environment view to read.
 * @param name - variable name to look up.
 * @returns the value, or undefined when absent.
 */
export declare function engineEnvValue(env: EngineEnv, name: string): string | undefined;
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
export declare function resolveEngine(input: ResolveEngineInput, env: EngineEnv, platform: NodeJS.Platform, fs: EngineFs, verify: EngineVerifier): EngineResolution;
