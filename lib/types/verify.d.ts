/**
 * Asking one candidate binary whether it is the engine this plugin runs.
 *
 * The plugin accepts only brush (`brush-shell`), so a configured `bashPath` cannot be taken at face
 * value: `bash.exe` from Git for Windows, MSYS2 or Cygwin, and `wsl.exe`, are the binaries a user is
 * most likely to point at, and each reports itself differently. One bounded `--version` spawn settles
 * it, and the first line of that output also names the engine in the model-visible contract.
 * @module dsh-bash-native/verify
 */
import type { EngineVerdict } from './resolve.js';
/** The spawn this module needs, injected so the identification parse is testable without a binary. */
export interface VersionRun {
    /**
     * @param path - executable to run.
     * @param args - arguments for that run.
     * @returns its first output line and, when it could not be run, the reason.
     */
    (path: string, args: readonly string[]): {
        readonly line: string;
        readonly failure: string | null;
    };
}
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
export declare function argumentSignature(node: string): string;
/**
 * Ask one candidate binary to identify itself, then to prove it is this build.
 * @param path - an existing absolute executable.
 * @param run - the spawn seam; production passes {@link spawnVersion}.
 * @param node - the Node executable the argument signature runs (`process.execPath` in production).
 * @returns the verdict resolution reads.
 */
export declare function readBrushVersion(path: string, run?: VersionRun, node?: string): EngineVerdict;
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
export declare function captureStdio(stdoutPath: string, stderrPath: string): {
    readonly stdio: ['ignore', number, number];
    close(): void;
};
