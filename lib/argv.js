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
import { ENV_OVERRIDES } from '@deepseek-ai/dsh-bash-local';
import { delimiter } from 'node:path';
import { prependPaths } from './toolchain.js';
/**
 * The flag that keeps the engine's own diagnostics plain text.
 *
 * The engine colors part of its own error reporting (`ESC[31merror:ESC[39m …`, measured for `command not
 * found` and parse errors) and nothing else turns that off: measured with `NO_COLOR=1`, `TERM=dumb`,
 * `CLICOLOR=0`, and with stdout and stderr redirected to files, every one of those still produced the SGR
 * sequences, while `--disable-color` removes them in command, script and refusal paths alike.
 * `dsh-tool-bash` hands stdout and a `[stderr]` section to the model verbatim, so without the flag a
 * failure an agent reads can carry escape bytes it has to ignore.
 */
const DISABLE_COLOR = '--disable-color';
/**
 * Build the argv that runs one command string through the engine.
 * @param engine - the resolved engine.
 * @param command - the caller's command text, passed verbatim as the shell's operand.
 * @returns the exact argv to spawn.
 */
export function buildCommandArgv(engine, command) {
    return [engine.path, DISABLE_COLOR, ...engine.args, command];
}
/**
 * Build the argv that starts an interactive session on the engine.
 * @param engine - the resolved engine.
 * @returns the exact argv a PTY backend would spawn.
 */
export function buildInteractiveArgv(engine) {
    return [engine.path, DISABLE_COLOR, ...engine.interactiveArgs];
}
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
export function interactiveArgsWithRcFile(engine, rcFile) {
    const args = [DISABLE_COLOR, ...engine.interactiveArgs];
    const norc = args.indexOf('--norc');
    if (norc < 0 || rcFile.length === 0)
        return args;
    args.splice(norc, 1, '--rcfile', rcFile);
    return args;
}
/**
 * Layer one execution's environment.
 *
 * The subprocess seam merges these entries over a scrubbed copy of the parent environment, so `PATH`
 * survives on its own; the toolchain and shell-name directories therefore have to be prepended to the
 * *inherited* value, which is why the base `PATH` is an input rather than something read here.
 * @param layers - the executor overrides, the directories to prepend, the request environment, and the managed facts.
 * @returns the explicit environment entries to hand the subprocess seam.
 */
export function buildShellEnv(layers) {
    const dirs = (layers.toolsDirs ?? []).filter((dir) => dir.length > 0);
    const path = dirs.length === 0 ? undefined : prependPaths(dirs, layers.basePath ?? '', delimiter);
    return {
        ...ENV_OVERRIDES,
        // Below a caller's own entries: a request that sets `PATH` deliberately still wins.
        ...(path === undefined ? {} : { PATH: path }),
        ...layers.overrides,
        ...layers.env,
        ...layers.dshEnv,
    };
}
