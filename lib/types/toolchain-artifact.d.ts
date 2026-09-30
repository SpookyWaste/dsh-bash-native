/**
 * The POSIX toolchain this package ships, and the farm that publishes it.
 *
 * The same two facts that shape `artifact.ts` shape this module. The toolchain is the capability: without
 * it `grep`, `sed`, `awk`, `jq`, `find`, `xargs`, `timeout`, `diff`, `cmp`, `which`, `stat` and `ps` are
 * either absent or — for `find`, `timeout` and `convert` — the unrelated Windows programs of the same
 * name, so an install that cannot build one from source was never "install and use". It ships as the
 * distinct binaries minus their hard links (`toolchain/win32-x64/*.exe`) plus a manifest naming every
 * command each one provides, because 104 published names are only 15 files. It is not run from the package
 * itself: a `PATH` directory belongs in per-user state rather than in `node_modules`, so the files are
 * verified against the manifest, materialized under `%LOCALAPPDATA%`, and the published names are created
 * there.
 *
 * Two costs were removed from that description. The 15 files are hard links to the packaged ones whenever
 * the volume allows it, which is the normal `$DSH_HOME` install — 15 files that share their bytes cost no
 * copy at all — and a copy otherwise. And verification is stamped: a stamp records the identity of every
 * packaged file and of every materialized one, so a resolution that finds them all unchanged skips the
 * 76 MB of hashing that reading both sides used to cost.
 *
 * The cache is content-addressed by the manifest's own digest, so a rebuilt package lands in a new
 * directory, and it is never pruned: another live process may still be running the previous toolchain.
 * @module dsh-bash-native/toolchain-artifact
 */
import type { ArtifactIo, VerifyMode } from './artifact.js';
/** The toolchain directory prepared for use, or why the packaged one cannot be used. */
export type PackagedToolchain = {
    readonly ready: string;
} | {
    readonly refused: string;
};
/** The filesystem operations this module needs beyond {@link ArtifactIo}, injected so its rules are testable. */
export interface ToolchainIo extends ArtifactIo {
    /** Creates a hard link, which is how one file becomes every name it publishes. */
    link(from: string, to: string): void;
    /** Copies one file, overwriting the destination; the fallback when a link is impossible. */
    copy(from: string, to: string): void;
    /** Removes a file or directory tree, ignoring absence. */
    remove(path: string): void;
    /** @param path - existing directory. @returns its entry names, or null when it cannot be read. */
    names(path: string): readonly string[] | null;
}
/** Inputs the executor contributes to {@link preparePackagedToolchain}. */
export interface PrepareToolchainOptions {
    /** The installed package root, i.e. the directory holding `toolchain/`. */
    readonly packageRoot: string;
    /** Environment providing `LOCALAPPDATA`, where the cache and the stamps live. */
    readonly env: {
        readonly [name: string]: string | undefined;
    };
    /** How much of the verification to repeat. Omitted means `stamped`. */
    readonly verify?: VerifyMode;
    /** Filesystem and hashing, overridable in tests. */
    readonly io?: ToolchainIo;
}
/** One packaged binary and every command name it publishes. */
export interface PackagedFile {
    readonly file: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly component: string;
    readonly version: string;
    readonly license: string;
    readonly source: string;
    readonly names: readonly string[];
}
/** The manifest `toolchain/win32-x64/manifest.json` carries: what the package holds and what it provides. */
export interface ToolchainManifest {
    readonly version: number;
    readonly files: readonly PackagedFile[];
}
/**
 * Prepare the packaged toolchain for use.
 *
 * Every file is verified against the manifest before anything is materialized, and the materialized copies
 * are hashed after they are written, so a truncated download, a tampered binary or a half-written cache is
 * refused rather than probed as "this command is missing". The published names are recreated as hard links,
 * which is why 104 commands cost the 15 files' bytes and not 104 copies of them, and the files themselves
 * are hard links to the package's own bytes whenever the volume allows it (a copy otherwise). With the
 * default `stamped` verification all of that reading is skipped while the stamp's recorded identities still
 * match; `always` re-hashes.
 * @param options - package root, environment, verification mode and I/O seams.
 * @returns the `bin` directory to probe and put on `PATH`, or the reason the packaged toolchain cannot be used.
 */
export declare function preparePackagedToolchain(options: PrepareToolchainOptions): PackagedToolchain;
/** Read and validate the manifest, or null when it cannot be trusted to describe files and names. */
export declare function parseManifest(text: string): ToolchainManifest | null;
