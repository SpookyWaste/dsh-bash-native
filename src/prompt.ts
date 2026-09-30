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
 * How much of the contract one instance states.
 *
 * Retained because it validates and because presets and deployments may still set it, but both values now
 * render the same two sentences: the shapes collapsed into one when the contract was cut down.
 * TODO: either give the key a second shape again or remove it, its schema entry and its documentation.
 */
export type PromptDetail = 'full' | 'minimal'

/**
 * Render the environment contract.
 *
 * @returns the model-facing section text: two sentences, one per line.
 */
export function describeShellEnvironment(): string {
  return [
    "This session's `bash` tool runs a bash-compatible shell natively on Windows; use bash syntax.",
    'Use `$VAR` names such as `$TMP`; prefer real Windows paths (`"C:\\..."` quoted, or `C:/...`) over POSIX shorthands.',
  ].join('\n')
}
