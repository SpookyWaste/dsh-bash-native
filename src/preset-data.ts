/**
 * The composition this bundle contributes: which shipped preset each of its ids follows, and what it
 * replaces in that preset.
 *
 * Each id is the shipped composition of the host's own harness line — every row carried exactly as the
 * file declares it, `!!js` nodes included — with one change: the shipped shell surface is replaced by a
 * realm group that mounts this bundle's executor, the harness's persistent-terminal pair over that
 * executor, and its bash tool rows. The shipped preset's own platform branches live on exactly the rows
 * this bundle replaces, so a carried composition inherits no expression this bundle would have to
 * interpret, and a future shipped expression is carried unevaluated for the Loader, as it is upstream.
 *
 * The replaced surface is declared as row ids, never as a position: the file found at boot is the one
 * the running host ships, and a release that reshapes its shell surface has to be seen rather than
 * guessed at. A composition whose declared ids are not all present, whose shell group gained a row this
 * bundle does not replace, or which carries the surface both ways at once, throws instead of mounting a
 * preset with two shells in it. `test/test-preset-parity.mjs` runs the same rule against the shipped
 * files themselves, so a reshape is reported on the release that first sees it.
 *
 * The realm group itself — its id, its `isolate` realms, and every child except the carried bash tool row
 * — is this bundle's own contract with `@deepseek-ai/dsh-terminal` and the harness's tool packages, not a
 * derivation from the shipped file: deriving `isolate` would drop the `shell` realm the executor needs,
 * and the shipped preset's shell rows are separate rows and a pwsh group, neither of which is a realm this
 * executor can serve.
 * @module dsh-bash-native/preset-data
 */

import { SELF_ENTRY, jsExpr } from './entries.js'

/** The preset ids this bundle registers. Sessions pin an id, so these values are a compatibility surface. */
export const PRESET_IDS = ['bash-native', 'bash-native-minimal'] as const

/** One of the ids in `PRESET_IDS`. */
export type PresetId = (typeof PRESET_IDS)[number]

/** One row of a composition, in the shape the Loader's own entry list accepts. */
export interface PresetRow {
  readonly id: string
  readonly name: string
  readonly group?: true
  /** A literal switch, or the `!!js` node a shipped row carries; the Loader evaluates the latter. */
  readonly disabled?: boolean | Readonly<{ readonly __jsExpr: string }>
  readonly inject?: readonly string[]
  readonly isolate?: Readonly<Record<string, boolean>>
  /** A row's own configuration, or the child rows of a group. */
  readonly config?: unknown
}

/** A preset definition as `ctx.agentPresets.register` takes it. */
export interface PresetDefinition {
  readonly id: PresetId
  readonly name: string
  readonly description: string
  readonly order: number
  readonly plugins: readonly PresetRow[]
}

/** One shipped composition this bundle follows. */
export interface PresetSource {
  /** The shipped preset file to read, without its `.patch.yml` suffix. */
  readonly file: 'standard' | 'minimal'
  /** The preset id that file declares, which the read composition is checked against. */
  readonly upstreamId: 'standard' | 'minimal'
  /** The shell rows it carries, by id, wherever they sit; this bundle mounts its realm group in their place. */
  readonly replaced: readonly string[]
}

/** A shipped composition as it was read: the file it came from, and the rows it declares. */
export interface ShippedPreset {
  /** Absolute path of the file the rows were read from, for diagnostics. */
  readonly path: string
  /** The declared rows, with `!!js` nodes left for the Loader. */
  readonly rows: readonly PresetRow[]
}

/**
 * Which shipped preset each id follows.
 *
 * `bash-native` follows `standard` and `bash-native-minimal` follows `minimal`, in both spellings the
 * shipped files use: the file name and the `config.id` it declares are checked against these values, so a
 * file that was replaced by another preset's body is refused rather than mounted under this bundle's id.
 */
export const SHIPPED_SOURCES: Readonly<Record<PresetId, PresetSource>> = {
  'bash-native': { file: 'standard', upstreamId: 'standard', replaced: ['tool-bash', 'tool-pwsh'] },
  'bash-native-minimal': {
    file: 'minimal',
    upstreamId: 'minimal',
    replaced: ['pty', 'terminal-bash', 'persistent-bash', 'terminal-pwsh', 'persistent-pwsh'],
  },
}

/** The row id of the realm group this bundle mounts in place of a shipped shell surface. */
export const SHELL_GROUP_IDS: Readonly<Record<PresetId, string>> = {
  'bash-native': 'bash-native-shell',
  'bash-native-minimal': 'bash-native-shell-minimal',
}

/** Display metadata of both presets. `name` is published, so display copy is this bundle's, not a locale key. */
const PRESET_META: Readonly<Record<PresetId, Readonly<{ name: string; description: string; order: number }>>> = {
  'bash-native': {
    name: 'Native Bash (Windows)',
    description:
      'A native POSIX bash on Windows (the brush engine this bundle ships and verifies; no MSYS runtime) with the harness file sandbox, background jobs, and spill-backed output.',
    order: 5,
  },
  'bash-native-minimal': {
    name: 'Native Bash (Windows, minimal)',
    description:
      'The lean Native Bash preset — a persona, an image-only file tool, a compaction group and one persistent bash shell on the brush engine this bundle ships and verifies, with the short environment contract.',
    order: 6,
  },
}

/** The description this bundle gives the persistent shell tool, in place of the shipped preset's own. */
const PERSISTENT_DESCRIPTION =
  `Run commands in a persistent bash shell
* State is persistent across command calls and discussions with the user.
* This is a bash (POSIX) shell on Windows, not PowerShell; use bash syntax and POSIX paths.
* \`stty\` does not exist in this environment, so input echo stays on.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`

/** The shipped presets' one-shot bash tool row, which the realm group mounts on this bundle's engine. */
const BASH_TOOL_ROW = 'tool-bash'

/** This bundle's executor row: its own entry, resolved by URL because no harness installation carries it. */
const EXECUTOR_ROW: PresetRow = { id: 'bash-native', name: SELF_ENTRY, config: { confine: true, requireEngineOnLoad: true } }

/** The harness terminal registry the persistent bash tool runs over, inside the same realm. */
const TERMINAL_ROW: PresetRow = { id: 'bash-native-terminal', name: '@deepseek-ai/dsh-terminal' }

/**
 * The PTY backend, configured to run on the realm's own executor.
 *
 * `shellPath` and `shellArgs` are deferred expressions read from the realm's `shell` service, so the
 * backend starts the engine this bundle resolved instead of whichever executor the root plane carries.
 */
const TERMINAL_PTY_ROW: PresetRow = {
  id: 'bash-native-terminal-pty',
  name: '@deepseek-ai/dsh-terminal-bash',
  inject: ['shell'],
  config: {
    backendType: 'shell',
    shellDialect: 'bash',
    shellPath: jsExpr("ctx.get('shell')?.enginePath ?? ''"),
    shellArgs: jsExpr("ctx.get('shell')?.engineArgs ?? []"),
    timeoutMs: 300000,
  },
}

/** The harness's persistent bash tool, which this bundle's realm serves from its own engine. */
const PERSISTENT_ROW: PresetRow = {
  id: 'bash-native-persistent',
  name: '@deepseek-ai/dsh-tool-bash-persistent',
  config: { timeoutMs: 300000, description: PERSISTENT_DESCRIPTION },
}

/** The realm keys both groups isolate: the executor, and the terminal registry its backend publishes. */
const SHELL_REALMS: Readonly<Record<string, boolean>> = { shell: true, terminals: true }

/**
 * Build this bundle's definition for one shipped composition.
 *
 * Pure: the same shipped rows always compose the same definition.
 * @param id - which of `PRESET_IDS` to compose.
 * @param shipped - the shipped composition this id follows, as read from the host's own installation.
 * @returns the definition to hand to `ctx.agentPresets.register`.
 * @throws when the shipped composition no longer carries the shell surface this bundle replaces.
 */
export function composePreset(id: PresetId, shipped: ShippedPreset): PresetDefinition {
  const source = SHIPPED_SOURCES[id]
  const meta = PRESET_META[id]
  const surface = collectShellSurface(shipped.rows, source, shipped.path)
  const group = shellGroupFor(id, surface.rows, shipped.path)
  return { id, name: meta.name, description: meta.description, order: meta.order, plugins: replaceShellSurface(shipped.rows, surface, group) }
}

/** Where one shipped composition's shell surface sits, and which rows it consists of. */
interface ShellSurface {
  /** The top-level index of the group holding the surface, or -1 when the surface is top-level rows. */
  readonly groupIndex: number
  /** The top-level indices of the replaced rows; empty when one group holds the whole surface. */
  readonly rowIndices: readonly number[]
  /** Every replaced row by id. */
  readonly rows: ReadonlyMap<string, PresetRow>
}

/**
 * Locate the shell surface one shipped composition carries, and check that it is exactly the declared set.
 *
 * Two shapes are accepted, because both spell the same surface: the rows at the top level (the shipped
 * `standard` preset) and the children of one group (the shipped `minimal` preset). Anything else — a
 * declared row that is gone, a group that gained a row this bundle would leave enabled beside its own
 * shell, or the two shapes at once — throws, because the alternative is a preset that mounts two shells
 * or silently loses a capability the shipped composition had.
 * @param rows - the shipped composition's rows.
 * @param source - which shipped preset they belong to.
 * @param at - the file to name in a diagnostic.
 * @returns the surface's position and the rows it consists of.
 * @throws when the declared surface is not carried exactly once and in one shape.
 */
function collectShellSurface(rows: readonly PresetRow[], source: PresetSource, at: string): ShellSurface {
  const declared = new Set(source.replaced)
  const replaced = new Map<string, PresetRow>()
  const rowIndices: number[] = []
  let groupIndex = -1
  let groupRows: readonly PresetRow[] = []
  for (const [index, row] of rows.entries()) {
    if (declared.has(row.id)) {
      replaced.set(row.id, row)
      rowIndices.push(index)
      continue
    }
    const children = Array.isArray(row.config) ? (row.config as readonly PresetRow[]) : []
    const mine = children.filter((child) => declared.has(child.id))
    if (mine.length === 0) continue
    const foreign = children.filter((child) => !declared.has(child.id))
    if (foreign.length > 0) {
      throw new Error(
        `dsh-bash-native: the shipped preset at ${at} keeps ${foreign.map((child) => child.id).join(', ')} beside the shell rows this bundle replaces in ${row.id}; those rows would mount next to this bundle's own shell`,
      )
    }
    if (groupIndex >= 0) {
      throw new Error(`dsh-bash-native: the shipped preset at ${at} carries the shell surface in two groups (${rows[groupIndex].id}, ${row.id})`)
    }
    groupIndex = index
    groupRows = children
    for (const child of children) replaced.set(child.id, child)
  }
  if (groupIndex >= 0 && rowIndices.length > 0) {
    throw new Error(
      `dsh-bash-native: the shipped preset at ${at} carries the shell rows this bundle replaces both top-level and inside ${rows[groupIndex].id}`,
    )
  }
  const missing = source.replaced.filter((id) => !replaced.has(id))
  if (missing.length > 0) {
    throw new Error(
      `dsh-bash-native: the shipped preset at ${at} no longer declares ${missing.join(', ')} as ${source.file === 'minimal' ? 'the children of one group' : 'top-level rows'}; the shell surface this bundle replaces has changed`,
    )
  }
  return { groupIndex, rowIndices, rows: replaced }
}

/**
 * Replace one composition's shell surface with this bundle's realm group.
 * @param rows - the shipped composition's rows.
 * @param surface - where the surface sits, as {@link collectShellSurface} located it.
 * @param group - the realm group to mount in its place.
 * @returns the composed rows, in the shipped preset's order.
 */
function replaceShellSurface(rows: readonly PresetRow[], surface: ShellSurface, group: PresetRow): readonly PresetRow[] {
  if (surface.groupIndex >= 0) return rows.map((row, index) => (index === surface.groupIndex ? group : row))
  const first = surface.rowIndices[0]
  const dropped = new Set(surface.rowIndices)
  const kept = rows.filter((_row, index) => !dropped.has(index))
  // No replaced row precedes `first`, so every row before it is a kept one and keeps its position.
  return [...kept.slice(0, first), group, ...kept.slice(first)]
}

/**
 * Build the realm group that replaces one shipped shell surface.
 *
 * The two presets differ in what the shell is for: `standard` carries a one-shot bash tool and no
 * persistent one, so this bundle mounts the shipped tool row (see {@link realmBashRow}) and keeps its own
 * persistent tool switched off as a switchable extra; `minimal` carries one persistent shell and no
 * one-shot tool, so it mounts that one enabled and nothing else. Neither group carries the shipped pwsh
 * rows: the group isolates `shell`, so a pwsh tool inside it would run on this bundle's bash.
 * @param id - which preset the group belongs to.
 * @param replaced - the shipped rows being replaced, by id.
 * @param at - the file to name in a diagnostic.
 * @returns the group row.
 * @throws when the shipped composition carries no one-shot bash row for the group to mount.
 */
function shellGroupFor(id: PresetId, replaced: ReadonlyMap<string, PresetRow>, at: string): PresetRow {
  const full = id === 'bash-native'
  const children: PresetRow[] = [EXECUTOR_ROW, TERMINAL_ROW, TERMINAL_PTY_ROW]
  if (full) children.push(realmBashRow(replaced, at))
  children.push(full ? { ...PERSISTENT_ROW, disabled: true } : PERSISTENT_ROW)
  return { id: SHELL_GROUP_IDS[id], name: 'cordis:group', group: true, isolate: SHELL_REALMS, config: children }
}

/**
 * The shipped one-shot bash tool row, mounted inside the realm group.
 *
 * Its own configuration is carried, so a shipped option this bundle does not know about is not dropped
 * silently. `disabled` is not: the condition it carries decides which of the shipped preset's two shells
 * is the enabled one, and inside this group the row runs on this bundle's engine — which the group mounts
 * only on the platform this bundle supports.
 * @param replaced - the shipped rows being replaced, by id.
 * @param at - the file to name in a diagnostic.
 * @returns the row to mount in the group.
 * @throws when the shipped composition carries no such row, which the shape check has already refused.
 */
function realmBashRow(replaced: ReadonlyMap<string, PresetRow>, at: string): PresetRow {
  const shipped = replaced.get(BASH_TOOL_ROW)
  if (shipped === undefined) {
    throw new Error(`dsh-bash-native: the shipped preset at ${at} declares no ${BASH_TOOL_ROW} row for the realm group to mount`)
  }
  // Dropped deliberately: see this function's contract.
  const { disabled: _platformCondition, ...carried } = shipped
  return carried
}