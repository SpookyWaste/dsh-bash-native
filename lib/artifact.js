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
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** The lock file, relative to the package root. */
const LOCK_FILE = 'engine.lock.json';
/** The stamp format this module writes. `1` described the copy that no longer exists. */
const STAMP_VERSION = 2;
/**
 * The package root of the running module.
 *
 * `lib/artifact.js` sits one directory below the root, in the source tree and in the published tarball
 * alike, so the same relative hop works for a linked checkout, a Git install and an npm install.
 * @returns the absolute package root.
 */
export function packageRoot() {
    return fileURLToPath(new URL('..', import.meta.url));
}
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
export function preparePackagedEngine(options) {
    const io = options.io ?? nodeIo;
    const lockPath = join(options.packageRoot, LOCK_FILE);
    if (!io.isFile(lockPath))
        return { refused: `this install carries no ${LOCK_FILE} (looked at ${lockPath})` };
    const artifact = readArtifact(io, lockPath);
    if (artifact === null)
        return { refused: `${LOCK_FILE} carries no usable artifact record (${lockPath})` };
    const source = join(options.packageRoot, artifact.path);
    const sourceIdentity = io.stat(source);
    if (sourceIdentity === null)
        return { refused: `the packaged engine is missing (${source})` };
    const stamp = options.verify === 'always' ? null : stampPathFor(options.env, 'engine', artifact.sha256);
    if (stamp !== null && engineStampHolds(io, stamp, source, sourceIdentity))
        return { ready: source, sha256: artifact.sha256 };
    // The package is the authority: its size and hash are checked on every resolution the stamp cannot answer,
    // because a stamp cannot see a rewrite that preserved both size and modification time.
    if (sourceIdentity.bytes !== artifact.bytes) {
        return {
            refused: `the packaged engine is not the size ${LOCK_FILE} records: ${artifact.bytes} bytes expected, ${sourceIdentity.bytes} found (${source})`,
        };
    }
    const observed = io.sha256(source);
    if (observed !== artifact.sha256) {
        return {
            refused: `the packaged engine does not match ${LOCK_FILE}: it records ${artifact.sha256}, the file hashes to ${observed} (${source})`,
        };
    }
    if (stamp !== null) {
        writeStampJson(io, stamp, { version: STAMP_VERSION, path: source, identity: sourceIdentity });
    }
    return { ready: source, sha256: artifact.sha256 };
}
/**
 * Whether a stamp still describes this artifact, which is what lets the hashing be skipped.
 *
 * One file is both what was verified and what runs, so the identity measured a moment ago is the whole
 * comparison: a rewrite that changed either size or modification time fails it and re-hashes.
 * @param io - filesystem seam.
 * @param path - the stamp file.
 * @param enginePath - the file this resolution would run.
 * @param identity - the identity just measured for that file.
 * @returns whether the stamp names that path and records that identity.
 */
function engineStampHolds(io, path, enginePath, identity) {
    const stamp = readStampJson(io, path);
    if (stamp === null || stamp.version !== STAMP_VERSION)
        return false;
    return stamp.path === enginePath && sameIdentity(stamp.identity, identity);
}
/**
 * Whether the file at one path still carries the identity a stamp recorded for it.
 * @param io - filesystem seam.
 * @param path - the file the stamp is about.
 * @param recorded - the identity the stamp carries, if any.
 * @returns whether the file exists and still has that identity.
 */
export function identityMatches(io, path, recorded) {
    const observed = io.stat(path);
    return observed !== null && sameIdentity(recorded, observed);
}
/**
 * Whether a stamp's recorded file identity still describes the file on disk.
 *
 * An absent record never matches, so a stamp written by another version of this plugin — or one that was
 * damaged — costs one full verification and is then replaced.
 * @param recorded - the identity the stamp carries, if any.
 * @param observed - the identity just measured.
 * @returns whether they are the same file, as far as a stat can tell.
 */
export function sameIdentity(recorded, observed) {
    return recorded !== undefined && recorded.bytes === observed.bytes && recorded.mtimeMs === observed.mtimeMs;
}
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
export function stampPathFor(env, kind, digest) {
    const directory = stampDirectory(env);
    return directory === null ? null : join(directory, `${kind}-${digest}.json`);
}
/**
 * Read one stamp record as parsed JSON.
 * @param io - filesystem seam.
 * @param path - the stamp file.
 * @returns the parsed value, or null when the file is absent, unreadable or not JSON.
 */
export function readStampJson(io, path) {
    let text;
    try {
        text = io.readText(path);
    }
    catch {
        // An absent stamp is the normal first run, and an unreadable one is indistinguishable from it: both
        // mean "verify again", which is what the caller does with a null.
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        // A damaged stamp is the same verdict as an absent one; the caller re-verifies and rewrites it.
        return null;
    }
}
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
export function writeStampJson(io, path, value) {
    try {
        io.makeDirectory(dirname(path));
        io.writeText(path, JSON.stringify(value));
    }
    catch (error) {
        // Deliberately swallowed for the reason above; the message would have nowhere to go but a log this
        // module does not own.
        void error;
    }
}
/** The per-user directory holding verification stamps, or null when `LOCALAPPDATA` cannot name one. */
export function stampDirectory(env) {
    const local = localAppData(env);
    return local === null ? null : join(local, 'dsh-bash-native', 'verified');
}
/** The local application data directory, spelled the two ways Windows environment blocks spell it. */
function localAppData(env) {
    const local = env.LOCALAPPDATA ?? env.LocalAppData;
    return local === undefined || local.length === 0 ? null : local;
}
/** Read and validate the artifact record, or null when the lock cannot provide one. */
function readArtifact(io, lockPath) {
    let parsed;
    try {
        parsed = JSON.parse(io.readText(lockPath));
    }
    catch {
        // An unparsable lock is the same verdict as a missing record: the packaged engine cannot be trusted,
        // and the refusal text names the file.
        return null;
    }
    const record = parsed.artifact;
    if (typeof record !== 'object' || record === null)
        return null;
    const { path, sha256, bytes } = record;
    if (typeof path !== 'string' || path.length === 0)
        return null;
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256))
        return null;
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0)
        return null;
    return { path, sha256, bytes };
}
/** The production filesystem and hashing, kept last so the rules above read as the module's content. */
const nodeIo = {
    isFile: (path) => {
        try {
            return statSync(path).isFile();
        }
        catch {
            return false;
        }
    },
    readText: (path) => readFileSync(path, 'utf8'),
    stat: (path) => {
        try {
            const stats = statSync(path);
            return { bytes: stats.size, mtimeMs: stats.mtimeMs };
        }
        catch {
            return null;
        }
    },
    sha256: (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
    makeDirectory: (path) => {
        mkdirSync(path, { recursive: true });
    },
    writeText: (path, text) => writeFileSync(path, text),
};
