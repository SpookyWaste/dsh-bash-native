/**
 * The names this plugin puts on `PATH`: `bash` and `sh`.
 *
 * A script, a Makefile, an npm lifecycle hook or any tool that shells out to `bash` should find one, and
 * `bash script.sh`, `bash -c …` and `sh -c …` all work once the name resolves — the difference between "there
 * is a bash tool" and "there is a bash". Nothing else is published here: the engine's built-in utilities are
 * in-process commands a child cannot exec, so the programs a child needs come from the toolchain's `bin/`
 * directory (which is what publishes those command names and carries their own path rules), and the two names
 * Windows has no applet for (`chmod`, `mkfifo`) stay commands inside the shell only.
 *
 * The engine is not installed under those names — a second 10.9 MB binary would be waste, and `PATH` is not
 * the package's to write — so every name is a hard link to the verified engine in a per-user directory,
 * content-addressed by the engine's own sha256: a new engine build gets a new directory, so a stale name can
 * never point at the previous build, and the directory sits outside the workspace, so a confined session
 * cannot rewrite it. Hard links share one file's bytes, so the whole set occupies what the engine occupies. A
 * volume that cannot link the engine — the development install keeps the package on another drive — costs
 * one copy rather than one per name: the first name made becomes that copy and every later name links to it.
 * A name that cannot be created at all costs only that name; `bash` failing before `sh` is the normal state
 * of a read-only profile, and the caller simply gets no names.
 * @module dsh-bash-native/shim
 */
import { copyFileSync, linkSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
/** The command names a shell install is expected to answer to, in the order they are created. */
export const SHELL_NAMES = ['bash', 'sh'];
/**
 * Every name the shim directory answers to.
 *
 * Only the shell faces are published: rubash decides `bash`/`sh` from its own invocation name and has no
 * multi-call utility dispatch, so a hard link named `cat.exe` would run a *shell* called cat. The
 * utilities a child process can exec live in the toolchain directory instead.
 */
export const SHIM_NAMES = [...SHELL_NAMES];
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
export function prepareShellNames(options) {
    const io = options.io ?? nodeIo;
    const directory = shellNamesDirectory(options.env, options.sha256);
    if (directory === null)
        return '';
    const engine = io.stat(options.engine);
    if (engine === null)
        return '';
    const names = SHIM_NAMES.map((name) => join(directory, `${name}.exe`));
    if (names.every((path) => holdsEngine(io, path, engine)))
        return directory;
    let seed = null;
    try {
        io.makeDirectory(directory);
        for (const path of names) {
            if (holdsEngine(io, path, engine))
                continue;
            const source = seed ?? options.engine;
            try {
                io.link(source, path);
            }
            catch {
                // Cross-volume and link-less filesystems are both "copy instead", never a failure: the name still
                // resolves to the verified bytes. The copy this makes becomes the source for every later name, so a
                // volume that cannot link the engine pays for one copy rather than one per name.
                io.copy(source, path);
                if (seed === null)
                    seed = path;
            }
        }
    }
    catch (error) {
        // A name that cannot be created costs that name and nothing else, so it is reported as "no shim"
        // rather than thrown, and the caller's logger is the only place the reason could go.
        void error;
        return '';
    }
    return directory;
}
/**
 * Whether one name already stands for the engine.
 *
 * Size is the half of the identity a hard link shares and a copy reproduces; the digest that names the
 * directory is the other half, which is what makes this check sufficient without hashing 15.7 MB again.
 * @param io - filesystem seam.
 * @param path - the name to check.
 * @param engine - the engine's identity.
 * @returns whether the name is present with the engine's size.
 */
function holdsEngine(io, path, engine) {
    const found = io.stat(path);
    return found !== null && found.bytes === engine.bytes;
}
/** The per-user directory holding the shim names for one engine build, or null when `LOCALAPPDATA` is unset. */
export function shellNamesDirectory(env, sha256) {
    const local = env.LOCALAPPDATA ?? env.LocalAppData;
    if (local === undefined || local.length === 0)
        return null;
    return join(local, 'dsh-bash-native', 'shim', sha256);
}
/** The production filesystem, kept last so the rules above read as the module's content. */
const nodeIo = {
    stat: (path) => {
        try {
            const stats = statSync(path);
            return { bytes: stats.size, mtimeMs: stats.mtimeMs };
        }
        catch {
            return null;
        }
    },
    link: (from, to) => linkSync(from, to),
    copy: (from, to) => copyFileSync(from, to),
    makeDirectory: (path) => {
        mkdirSync(path, { recursive: true });
    },
};
