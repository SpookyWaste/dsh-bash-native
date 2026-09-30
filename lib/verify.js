/**
 * Asking one candidate binary whether it is the engine this plugin runs.
 *
 * The plugin accepts only brush (`brush-shell`), so a configured `bashPath` cannot be taken at face
 * value: `bash.exe` from Git for Windows, MSYS2 or Cygwin, and `wsl.exe`, are the binaries a user is
 * most likely to point at, and each reports itself differently. One bounded `--version` spawn settles
 * it, and the first line of that output also names the engine in the model-visible contract.
 * @module dsh-bash-native/verify
 */
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * The facts only this repository's engine build has, asked as two commands.
 *
 * `verify` answers "is this brush at all"; these answer "is it the build the model-visible contract
 * describes". Every fact is a consequence of this repository's patches and of nothing else: `/tmp` is a
 * real directory only because of `0002`/`0004`, `kill` is a builtin only because of `0008`, and a
 * `/q/x` argument reaches a child as `Q:\x` only because of `0009`. An unpatched
 * `cargo install brush-shell` fails all of them, and running it would make the contract lie, so a
 * candidate that fails is refused rather than accepted.
 */
const BUILD_SIGNATURE = 'test -d /tmp; echo "tmp=$?"; type -t kill';
/** What the shell-side signature prints on a build that carries this repository's patches. */
const SIGNATURE_EXPECTED = ['tmp=0', 'builtin'];
/** The argument-side signature: a foreign program prints the argument it actually received. */
const ARG_EXPECTED = 'Q:\\x';
/**
 * The argument-side signature command.
 *
 * `Q:` need not exist: nothing here touches the filesystem. A patched engine rewrites the operand to the
 * drive mount `Q:\x` before spawning, and an unpatched one hands over the literal `/q/x`, so the string
 * the child prints is the entire difference. The host's own Node runs the child, which is the only
 * interpreter this plugin can be sure exists.
 * @param node - absolute path to the Node executable.
 * @returns the command to run through the candidate engine.
 */
export function argumentSignature(node) {
    return `'${node.replaceAll("'", `'\\''`)}' -e 'console.log(process.argv[1])' /q/x`;
}
/**
 * Ask one candidate binary to identify itself, then to prove it is this build.
 * @param path - an existing absolute executable.
 * @param run - the spawn seam; production passes {@link spawnVersion}.
 * @param node - the Node executable the argument signature runs (`process.execPath` in production).
 * @returns the verdict resolution reads.
 */
export function readBrushVersion(path, run = spawnVersion, node = process.execPath) {
    const observed = run(path, ['--version']);
    if (observed.failure !== null)
        return { version: '', refused: observed.failure };
    const line = observed.line.trim().split('\n')[0]?.trim() ?? '';
    // brush prints e.g. `brush 0.4.0 (git:08db87a6-modified)`, so the name has to lead the line: a
    // binary whose banner merely mentions brush (a wrapper, or a shell that echoes it) cannot pass.
    if (!/^brush\b/i.test(line)) {
        return { version: '', refused: line === '' ? 'it reported no version' : `it reports "${line}", which is not brush` };
    }
    const missing = [];
    const signature = run(path, ['-c', BUILD_SIGNATURE]);
    if (signature.failure !== null)
        return { version: '', refused: `it is brush but could not be asked: ${signature.failure}` };
    const printed = signature.line
        .replace(/\r/g, '')
        .split('\n')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const tail = printed.slice(-SIGNATURE_EXPECTED.length);
    for (const [index, fact] of SIGNATURE_EXPECTED.entries()) {
        if (tail[index] !== fact)
            missing.push(fact);
    }
    const argument = run(path, ['-c', argumentSignature(node)]);
    if (argument.failure !== null)
        return { version: '', refused: `it is brush but could not be asked: ${argument.failure}` };
    if (argument.line.replace(/\r/g, '').trim() !== ARG_EXPECTED)
        missing.push(`the argument ${ARG_EXPECTED}`);
    if (missing.length > 0) {
        return {
            version: '',
            refused: `it is brush (${line}) but not the build this contract describes: ${missing.join(' and ')} did not hold ` +
                `(the build needs this repository's patches; see engine.lock.json)`,
        };
    }
    return { version: line, refused: null };
}
/**
 * The stdio shape a child launched from inside a session can actually use.
 *
 * A process started under the harness's restricted token cannot open a named pipe, so asking for pipes
 * (`spawnSync(..., { encoding: 'utf8' })`) fails with `EPERM` before the engine starts. That would refuse
 * every candidate — including the engine this package ships — and, with `requireEngineOnLoad: true`, take
 * the plugin down in exactly the tiers it exists to serve. The verifier therefore redirects both streams
 * to files, the same shape the test harness uses for its own runs, and one file per stream because a
 * refusal must be able to quote what the candidate wrote.
 *
 * Exported so a unit test can pin the property that matters: the array handed to `spawnSync` never
 * contains `'pipe'`.
 * @param stdoutPath - capture file for the child's stdout.
 * @param stderrPath - capture file for the child's stderr.
 * @returns the `stdio` value and the disposer that closes both descriptors.
 */
export function captureStdio(stdoutPath, stderrPath) {
    const stdout = openSync(stdoutPath, 'w');
    const stderr = openSync(stderrPath, 'w');
    return {
        stdio: ['ignore', stdout, stderr],
        close() {
            closeSync(stdout);
            closeSync(stderr);
        },
    };
}
/** The production spawn: one bounded run, at resolution time, in the session's own confinement tier. */
function spawnVersion(path, args) {
    let directory;
    try {
        directory = mkdtempSync(join(tmpdir(), 'dsh-bash-native-verify-'));
        const stdoutPath = join(directory, 'stdout.txt');
        const stderrPath = join(directory, 'stderr.txt');
        const capture = captureStdio(stdoutPath, stderrPath);
        let result;
        try {
            result = spawnSync(path, [...args], { stdio: capture.stdio, timeout: 10_000, windowsHide: true });
        }
        finally {
            capture.close();
        }
        if (result.error !== undefined)
            return { line: '', failure: `it could not be run: ${result.error.message}` };
        // Both streams are read, and they are read after the descriptors are closed so nothing is buffered.
        const text = `${readFileSync(stdoutPath, 'utf8')}${readFileSync(stderrPath, 'utf8')}`.trim();
        return { line: text, failure: null };
    }
    catch (error) {
        // A synchronously throwing spawn (a NUL in the path, an aborted call, an unwritable temporary
        // directory) is the same verdict as a failed run: this candidate cannot be the engine, and the
        // reason is what the probe list shows.
        return { line: '', failure: `it could not be run: ${String(error)}` };
    }
    finally {
        if (directory !== undefined)
            rmSync(directory, { recursive: true, force: true });
    }
}
