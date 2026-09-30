/**
 * The Windows bash environment contract this plugin contributes to the system prompt.
 *
 * Two sentences: this is bash running natively on Windows, and the spelling that follows from it for
 * variables and paths. The earlier shapes stated every measured deviation line by line — the drive-mount
 * and `/tmp` rewrites, descriptor and process-substitution boundaries, background-job and broken-pipe
 * behaviour, the toolchain inventory — and the owner's decision was that a section of that size is skimmed
 * rather than used. What is left is the part a model cannot derive at all: without the first sentence it
 * may write PowerShell or cmd (`%VAR%`, `$env:VAR`), and without the second it may pass `/tmp/...` or an
 * unquoted `C:\...` and produce a wrong path instead of a failed command. Everything else is discoverable
 * from the command's own error, and the measurements behind the removed lines stay in `docs/research.md`.
 * @module dsh-bash-native/prompt
 */
/**
 * Render the environment contract.
 *
 * @returns the model-facing section text: two sentences, one per line.
 */
export function describeShellEnvironment() {
    return [
        "This session's `bash` tool runs a bash-compatible shell natively on Windows; use bash syntax.",
        'Use `$VAR` names such as `$TMP`; prefer real Windows paths (`"C:\\..."` quoted, or `C:/...`) over POSIX shorthands.',
    ].join('\n');
}
