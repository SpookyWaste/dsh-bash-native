/**
 * The brush engine this package ships, and the file that runs.
 *
 * Two facts shape this module. First, the artifact is the product: `engine/win32-x64/brush.exe` is built
 * from the pinned upstream commit with this repository's patches, and `engine.lock.json` records its
 * sha256 and size, so an install never has to compile anything and a drifted or tampered binary is caught
 * before it runs. Second, verifying the artifact means reading it, so the verdict is stamped: a stamp
 * records the path and identity of the packaged file, and a later resolution that still finds them skips
 * the hashing entirely, where `always` re-hashes every time.
 *
 * The engine runs where the package puts it, and that is the only placement this module knows: a released
 * install sits under `$DSH_HOME/profiles/<profile>/node_modules/…`, which is outside the tree the sandbox
 * labels and grants writes to, so the artifact is executable as it lies. A package inside that tree is a
 * development arrangement — a `link:` dependency, or adding a local directory — whose executable inherits
 * the tree's Low integrity label and therefore cannot write the temp directory; that is a property of the
 * arrangement, not something this module works around by copying bytes to a second location.
 *
 * Stamps are deliberately never pruned: each is a few hundred bytes per build, and a stale one only costs
 * one hash.
 * @module dsh-bash-native/artifact
 */
/** The engine path prepared for execution and the digest it was verified against, or why the packaged one cannot be used. */
export type PackagedEngine = {
    readonly ready: string;
    readonly sha256: string;
} | {
    readonly refused: string;
};
/** How much of the artifact verification one resolution repeats. */
export type VerifyMode = 'stamped' | 'always';
/** The two facts about a file that every rewrite changes, and that a stamp therefore compares. */
export interface FileIdentity {
    /** Size in bytes. */
    readonly bytes: number;
    /** Last modification time, in milliseconds since the epoch. */
    readonly mtimeMs: number;
}
/** The filesystem and hashing this module needs, injected so its rules are testable without a binary. */
export interface ArtifactIo {
    /** @param path - candidate path. @returns whether it is an existing regular file. */
    isFile(path: string): boolean;
    /** @param path - existing file. @returns its content as UTF-8 text. */
    readText(path: string): string;
    /** @param path - candidate path. @returns its identity, or null when it is absent or unreadable. */
    stat(path: string): FileIdentity | null;
    /** @param path - existing file. @returns its lowercase SHA-256 hex digest. */
    sha256(path: string): string;
    /** Creates a directory and its parents. */
    makeDirectory(path: string): void;
    /** Writes text to a file, replacing it. */
    writeText(path: string, text: string): void;
}
/** Inputs the executor contributes to {@link preparePackagedEngine}. */
export interface PrepareOptions {
    /** The installed package root, i.e. the directory holding `engine/` and `engine.lock.json`. */
    readonly packageRoot: string;
    /** Environment providing `LOCALAPPDATA`, where the stamps live. */
    readonly env: {
        readonly [name: string]: string | undefined;
    };
    /** How much of the verification to repeat. Omitted means `stamped`. */
    readonly verify?: VerifyMode;
    /** Filesystem and hashing, overridable in tests. */
    readonly io?: ArtifactIo;
}
/**
 * The package root of the running module.
 *
 * `lib/artifact.js` sits one directory below the root, in the source tree and in the published tarball
 * alike, so the same relative hop works for a linked checkout, a Git install and an npm install.
 * @returns the absolute package root.
 */
export declare function packageRoot(): string;
/**
 * Prepare the packaged engine for execution.
 *
 * The artifact's size and hash are checked against `engine.lock.json` before it is run, so a truncated or
 * tampered file is refused rather than executed. With the default `stamped` verification those hashes are
 * skipped while the stamp still describes the file: its recorded size and modification time are compared
 * with the ones just measured, and every rewrite changes at least one of them. `always` restores hashing on
 * every resolution, and an install whose `LOCALAPPDATA` cannot name a stamp directory simply hashes.
 * @param options - package root, environment, verification mode and I/O seams.
 * @returns the path to run, or the reason the packaged engine cannot be used.
 */
export declare function preparePackagedEngine(options: PrepareOptions): PackagedEngine;
/**
 * Whether the file at one path still carries the identity a stamp recorded for it.
 * @param io - filesystem seam.
 * @param path - the file the stamp is about.
 * @param recorded - the identity the stamp carries, if any.
 * @returns whether the file exists and still has that identity.
 */
export declare function identityMatches(io: ArtifactIo, path: string, recorded: FileIdentity | undefined): boolean;
/**
 * Whether a stamp's recorded file identity still describes the file on disk.
 *
 * An absent record never matches, so a stamp written by another version of this plugin — or one that was
 * damaged — costs one full verification and is then replaced.
 * @param recorded - the identity the stamp carries, if any.
 * @param observed - the identity just measured.
 * @returns whether they are the same file, as far as a stat can tell.
 */
export declare function sameIdentity(recorded: FileIdentity | undefined, observed: FileIdentity): boolean;
/**
 * The stamp file one kind of artifact uses.
 *
 * The digest is what names it, so a rebuilt engine or a repacked toolchain gets a new stamp instead of
 * reusing a verdict about different bytes, and the stamp store itself holds only verdicts — never a
 * binary — which is why it is a few hundred bytes per build.
 * @param env - environment providing `LOCALAPPDATA`.
 * @param kind - the artifact kind, e.g. `engine`.
 * @param digest - the sha256 the stamp is about.
 * @returns the absolute stamp path, or null when `LOCALAPPDATA` cannot name one.
 */
export declare function stampPathFor(env: {
    readonly [name: string]: string | undefined;
}, kind: string, digest: string): string | null;
/**
 * Read one stamp record as parsed JSON.
 * @param io - filesystem seam.
 * @param path - the stamp file.
 * @returns the parsed value, or null when the file is absent, unreadable or not JSON.
 */
export declare function readStampJson(io: ArtifactIo, path: string): unknown;
/**
 * Write one stamp record.
 *
 * Best effort by design: the artifact has already been verified by the time this runs, so a stamp that
 * cannot be written costs the next resolution one hash and nothing else, and turning it into a refusal
 * would fail an install over a cache-warming detail.
 * @param io - filesystem seam.
 * @param path - the stamp file.
 * @param value - the record to serialize.
 */
export declare function writeStampJson(io: ArtifactIo, path: string, value: unknown): void;
/** The per-user directory holding verification stamps, or null when `LOCALAPPDATA` cannot name one. */
export declare function stampDirectory(env: {
    readonly [name: string]: string | undefined;
}): string | null;
