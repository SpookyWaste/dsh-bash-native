/**
 * The names this plugin puts on `PATH`: `bash`, `sh`, and the utilities the engine bundles.
 *
 * Two things depend on those names resolving. The engine is a bash-compatible shell, so a script, a Makefile,
 * an npm lifecycle hook or any tool that shells out to `bash` should find one: `bash script.sh`, `bash -c …`
 * and `sh -c …` all work once the name resolves, which is the difference between "there is a bash tool" and
 * "there is a bash". And the bundled utilities are shell builtins, which a child process cannot exec: `xargs
 * rm`, `find -exec rm` and any other program that spawns one by name can only find it on `PATH`, so the same
 * directory publishes every bundled name and the engine's own implementation answers those calls — which is
 * why the toolchain ships no second copy of any of them.
 *
 * The engine is not installed under those names — a second 15.7 MB binary would be waste, and `PATH` is not
 * the package's to write — so every name is a hard link to the verified engine in a per-user directory,
 * content-addressed by the engine's own sha256: a new engine build gets a new directory, so a stale name can
 * never point at the previous build, and the directory sits outside the workspace, so a confined session
 * cannot rewrite it. Hard links share one file's bytes, so the whole set occupies what the engine occupies. A
 * volume that cannot link the engine — the development install keeps the package on another drive — costs
 * one copy rather than one per name: the first name made becomes that copy and every later name links to it.
 * A name that cannot be created at all costs only that name.
 *
 * Not covered: running a script *by its own path* (`./s.sh`). Windows has no shebang handling, and the
 * engine hands an unknown file to `CreateProcess` instead of reading its first line, so `./s.sh` reports
 * `%1 is not a valid Win32 application` even with `bash` on `PATH`; call `bash s.sh` or source it.
 * @module dsh-bash-native/shim
 */
import type { FileIdentity } from './artifact.js';
/** The command names a shell install is expected to answer to, in the order they are created. */
export declare const SHELL_NAMES: readonly ['bash', 'sh'];
/**
 * Every name the shim directory answers to: the two shell names, then the utilities the engine bundles.
 *
 * Publication is what makes a bundled utility reachable from outside the shell. The name points at the
 * engine, and the engine dispatches on its own file name (patch `0016`), so a child process that execs `rm`
 * runs the bundled `rm` rather than a second implementation kept in the toolchain.
 */
export declare const SHIM_NAMES: readonly ["bash", "sh", ...string[]];
/** The filesystem operations this module needs, injected so its rules are testable without a binary. */
export interface ShimIo {
    /** @param path - candidate path. @returns its identity, or null when it is absent or unreadable. */
    stat(path: string): FileIdentity | null;
    /** Creates a hard link, the way one verified binary becomes several names. */
    link(from: string, to: string): void;
    /** Copies one file, overwriting the destination. */
    copy(from: string, to: string): void;
    /** Creates a directory and its parents. */
    makeDirectory(path: string): void;
}
/** Inputs the executor contributes to {@link prepareShellNames}. */
export interface PrepareShellNamesOptions {
    /** The verified engine the names stand for. */
    readonly engine: string;
    /** That engine's sha256, which names the directory so a rebuilt engine cannot reuse an old name. */
    readonly sha256: string;
    /** Environment providing `LOCALAPPDATA`, where the directory lives. */
    readonly env: {
        readonly [name: string]: string | undefined;
    };
    /** Filesystem, overridable in tests. */
    readonly io?: ShimIo;
}
/**
 * Create every name in {@link SHIM_NAMES} for one verified engine.
 *
 * Reuse costs one stat per name: the directory is named by the engine's digest and lives outside the
 * workspace, so a name that is already there was made from these bytes. Creation links the engine's own bytes
 * when the volume allows it; when it does not, the first name made becomes the one copy the directory holds
 * and every later name links to that copy instead of copying 15.7 MB again.
 * @param options - the engine, its digest, the environment and the filesystem seam.
 * @returns the directory to put on `PATH`, or an empty string when the names cannot be provided.
 */
export declare function prepareShellNames(options: PrepareShellNamesOptions): string;
/** The per-user directory holding the shim names for one engine build, or null when `LOCALAPPDATA` is unset. */
export declare function shellNamesDirectory(env: {
    readonly [name: string]: string | undefined;
}, sha256: string): string | null;
