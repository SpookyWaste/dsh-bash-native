/**
 * Validated configuration for the `dsh-bash-native` executor.
 *
 * The execution budgets are inherited from `@deepseek-ai/dsh-bash-local` by reuse of its exact
 * field schemas, so their defaults and caps keep exactly one home; this module adds only the
 * engine-selection and composition switches. The inheritance goes through
 * `LocalBashExecutor.Config.dict` rather than `Schema.intersect` because schemastery rejects a
 * volatile field nested under an intersection (`volatile fields require a fixed object path`),
 * and the inherited budgets are volatile by design so a settings write reaches a live instance.
 * @module dsh-bash-native/config
 */

import Schema from '@deepseek-ai/schemastery'
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalBashConfig } from '@deepseek-ai/dsh-bash-local'

/** Engine-selection and composition switches this executor adds to the local bash budgets. */
export interface BashNativeFields {
  /**
   * Absolute path to a brush build to run instead of the probed ones; empty means "resolve".
   *
   * A configured path is not taken at face value: the binary is asked for its version, and anything
   * that does not answer as brush is refused with the reason (see `./verify.ts`).
   */
  bashPath: string
  /** Directory of a packaged engine, probed as `brush.exe` and then `bin/brush.exe`. */
  bundledEngineDir: string
  /**
   * Whether commands run under `ctx.sandbox`. Disabling this drops the file policy and the
   * model's escalation fields; it exists for deployments that deliberately mount the
   * unconfined variant, mirroring the shipped `dsh-bash-local` / `dsh-bash-sandbox` split.
   */
  confine: boolean
  /** Whether an unresolvable engine fails plugin load instead of only failing each command. */
  requireEngineOnLoad: boolean
  /** Whether this plugin contributes the Windows bash environment section to the system prompt. */
  promptSection: boolean
  /**
   * How much of that section this instance states.
   *
   * Retained for compatibility: the two shapes collapsed into one when the contract was cut down to two
   * sentences, so both values render the same text and a preset that sets either one behaves identically.
   * `test-executor.mjs` pins that they are equal, so the key cannot quietly start meaning something again.
   * TODO: give the key a second shape again, or remove it with its schema entry and documentation.
   */
  promptDetail: 'full' | 'minimal'
  /**
   * Directory holding the POSIX toolchain (`grep`, `sed`, `awk`, `find`, `xargs`, `diff`, `which`
   * and the rest: see `toolchain.ts`). It is put at the front of `PATH` so those names shadow the
   * unrelated Windows programs of the same name. Empty means the per-user directory, whether or not
   * a toolchain was built there, which is what an unconfigured install gets.
   */
  toolsDir: string
  /**
   * Absolute path of the startup file a persistent PTY session reads, with its parent directory
   * created when absent. Empty means the per-user path next to the engine state
   * (`%LOCALAPPDATA%\dsh-bash-native\bash-native-rc.sh`), which is what an unconfigured install
   * gets. A deployment that manages its own startup file — or a test that must not touch the
   * machine's — points this at a directory it owns.
   */
  rcFile: string
  /**
   * Extra stderr signatures that classify a settled run as a file-policy denial, merged into the
   * sandbox provider's own dialect. The shipped Windows backend matches the English string
   * `access is denied`, while a non-English host prints the localized system message plus
   * `(os error 5)`; the default keeps the denial marker and its escalation hint working for the
   * shapes that carry it. The engine does not word every refusal the same way, so this dialect is
   * a heuristic and not a complete report — the README's limitations state which shapes it misses.
   */
  denialSignatureAdditions: string[]
  /** Extra environment entries for every command, layered above the model-friendly defaults. */
  shellEnvOverrides: Record<string, string>
  /**
   * How much of the engine and toolchain verification a resolution repeats.
   *
   * `stamped` (the default) hashes the packaged artifacts once and afterwards compares the size and
   * modification time a stamp recorded for them, which is what a session stops paying per executor
   * instance (measured: 31 MB of hashing for the engine and 76 MB for the toolchain, about 120 ms).
   * Anything that rewrites an artifact — a rebuild, `npm install`, a `git checkout`, an editor — changes
   * one of those two facts and brings the full hash back, and `always` re-hashes on every resolution for
   * deployments that will not accept that trade.
   */
  verifyArtifacts: 'stamped' | 'always'
}

/** The complete validated configuration: inherited execution budgets plus this executor's switches. */
export type BashNativeConfig = LocalBashConfig & BashNativeFields

/**
 * The inherited budget schemas, reused verbatim so their defaults, caps and volatile markers
 * cannot drift from `dsh-bash-local`.
 */
const inheritedBudgets = LocalBashExecutor.Config.dict
if (inheritedBudgets === undefined) {
  throw new Error(
    'dsh-bash-native: @deepseek-ai/dsh-bash-local exposes no Config field dict, so the execution budgets cannot be inherited; ' +
      'redeclare the six budget fields in this schema instead of silently loading without them.',
  )
}

/** Validated configuration schema: the inherited bash budgets plus this executor's switches. */
export const Config = Schema.object({
  ...inheritedBudgets,
  bashPath: Schema.string().default(''),
  bundledEngineDir: Schema.string().default(''),
  confine: Schema.boolean().default(true),
  requireEngineOnLoad: Schema.boolean().default(false),
  promptSection: Schema.boolean().default(true),
  promptDetail: Schema.union(['full', 'minimal']).default('full'),
  toolsDir: Schema.string().default(''),
  rcFile: Schema.string().default(''),
  denialSignatureAdditions: Schema.array(Schema.string()).default(['os error 5']),
  shellEnvOverrides: Schema.dict(Schema.string()).default({}),
  verifyArtifacts: Schema.union(['stamped', 'always']).default('stamped'),
})
