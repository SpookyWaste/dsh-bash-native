/**
 * Composition data for the two agent presets this bundle registers.
 *
 * The rows live here rather than in `cordis.patch.yml` because a preset row's module is resolved
 * against the base of the Loader entry that declares it. Rows declared by this bundle's patch resolve
 * from this package's directory inside the profile, which sees the profile's dependency tree and
 * nothing else; a *registered* preset is mounted with the registry's own base inside the harness
 * installation (`activate` mounts with `record.context.baseUrl`, the registry entry's own base), and
 * that is the only base which sees the harness's own packages. The second base is what lets one
 * published composition follow the harness line it runs on: a row whose package the installation does
 * not ship is left out of the composition instead of failing the mount audit, which would mark the
 * whole preset broken. Measured on both ends of this bundle's harness window in docs/research.md
 * section 58.
 *
 * The shell group is why both mechanisms are needed at once. Its executor row has to reach this
 * package, which no harness installation carries, so it is named by a URL computed from this module's
 * own location; every other row names a harness package by its published name and resolves from the
 * registry's base.
 *
 * The row data mirrors the shipped `standard` and `minimal` presets and is checked against them by
 * `test/test-preset-parity.mjs`; the gated rows are the part that mirror stops at, because which of
 * them a host can mount is a property of that host rather than of this bundle.
 * @module dsh-bash-native/preset-data
 */

/** The preset ids this bundle registers. Sessions pin an id, so these values are a compatibility surface. */
export const PRESET_IDS = ['bash-native', 'bash-native-minimal'] as const

/** One of the ids in `PRESET_IDS`. */
export type PresetId = (typeof PRESET_IDS)[number]

/** The harness package that carries the preset-scoped clock, and the gate for its row. */
export const TIME_CONTEXT_PACKAGE = '@deepseek-ai/dsh-time-context'

/**
 * The harness package that carries the four reminder tools, and the gate for its row and for the
 * subagent denials that arrived with it.
 *
 * Both are 0.2.1-alpha additions, they landed in one upstream release, and a package is the only
 * release-level signal a host exposes here: a preset row's configuration cannot be probed without
 * mounting it. A host that shipped one without the other would be reported by the mount audit
 * instead of being silently accommodated.
 */
export const TOOL_SCHEDULE_PACKAGE = '@deepseek-ai/dsh-tool-schedule'

/** One row of a composition, in the shape the Loader's own entry list accepts. */
export interface PresetRow {
  readonly id: string
  readonly name: string
  readonly group?: true
  readonly disabled?: boolean
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

/** Display metadata of one preset, mirroring the shipped preset it follows. */
interface PresetMeta {
  readonly name: string
  readonly description: string
  readonly order: number
}

/**
 * A `!!js` expression node, the value the YAML tag produces.
 *
 * The Loader recognizes one by the `__jsExpr` key alone (`isJsExpr`), evaluates it against the
 * entry's context in the same `with (ctx)` scope the YAML form gets, and leaves the raw node in the
 * options so write-back keeps the form. Declaring the shell rows here therefore keeps exactly the
 * semantics the patch file had, including the deferral that lets `inject: [shell]` resolve first.
 * @param expression - the expression source the Loader evaluates.
 * @returns the node the Loader interpolates.
 */
const jsExpr = (expression: string): Readonly<{ __jsExpr: string }> => ({ __jsExpr: expression })

/**
 * This bundle's own executor entry, as a URL resolved at registration time.
 *
 * A registered preset's rows resolve against the registry's base, and no harness installation carries
 * this package; a URL is resolved by URL rules instead of by `node_modules` lookup, and it is computed
 * from this module's own location, so it is correct for a profile install, a linked checkout, and a
 * global install alike. `./index.js` is the package's own entry point, the same module the patch
 * file named as `dsh-bash-native`.
 */
const SELF_ENTRY = new URL('./index.js', import.meta.url).href

/** A run of rows a host must be able to import before the composition carries them. */
interface GatedInsert {
  /** The id of the row this run follows, which is how the composed list keeps the shipped preset's order. */
  readonly after: string
  /** The harness package whose absence from this host removes the run. */
  readonly gate: string
  readonly rows: readonly PresetRow[]
}

/** A change a host's harness line makes to rows this preset always carries. */
interface GatedAmendment {
  /** The harness package whose absence from this host leaves the rows as they are. */
  readonly gate: string
  /** @param rows - the composed rows, unamended. @returns the rows for a host that ships the gate. */
  readonly apply: (rows: readonly PresetRow[]) => readonly PresetRow[]
}

// >>> generated: preset metadata and row data ported from cordis.patch.yml
/** The plan section the shipped `standard` preset hands `plan-mode`. */
const PLAN_MODE_SECTION =
  `You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
`

/** The description the shipped presets give the persistent shell tool. */
const PERSISTENT_DESCRIPTION =
  `Run commands in a persistent bash shell
* State is persistent across command calls and discussions with the user.
* This is a bash (POSIX) shell on Windows, not PowerShell; use bash syntax and POSIX paths.
* \`stty\` does not exist in this environment, so input echo stays on.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`

/** The clock row the shipped `standard` preset adds after `agent-instructions`. */
const TIME_CONTEXT_ROW: PresetRow = { id: 'time-context', name: TIME_CONTEXT_PACKAGE }

/** The reminder-tool row it adds after `tool-jobs`, which the rows mirrored here therefore lack. */
const TOOL_SCHEDULE_ROW: PresetRow = { id: 'tool-schedule', name: TOOL_SCHEDULE_PACKAGE }

/** Display metadata of both presets, mirroring the shipped presets they follow. */
const PRESET_META: Readonly<Record<PresetId, PresetMeta>> = {
  'bash-native': {
    name: 'Native Bash (Windows)',
    description: 'A native POSIX bash on Windows (the brush engine this bundle ships and verifies; no MSYS runtime) with the harness file sandbox, background jobs, and spill-backed output.',
    order: 5,
  },
  'bash-native-minimal': {
    name: 'Native Bash (Windows, minimal)',
    description: 'The lean Native Bash preset — a persona and one persistent bash shell on the brush engine this bundle ships and verifies, with the short environment contract.',
    order: 6,
  },
}

/** The full preset's rows, in the shipped `standard` preset's order. */
const FULL_ROWS: readonly PresetRow[] = [
  {
    id: 'persona',
    name: '@deepseek-ai/dsh-persona',
    config: {
      prefix: 'You are a coding agent powered by the {{model}} model.',
    },
  },
  { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
  {
    id: 'bash-native-shell',
    name: 'cordis:group',
    group: true,
    isolate: { shell: true, terminals: true },
    config: [
      { id: 'bash-native', name: SELF_ENTRY, config: { confine: true, requireEngineOnLoad: true } },
      { id: 'bash-native-terminal', name: '@deepseek-ai/dsh-terminal' },
      {
        id: 'bash-native-terminal-pty',
        name: '@deepseek-ai/dsh-terminal-bash',
        inject: ['shell'],
        config: {
          backendType: 'shell',
          shellDialect: 'bash',
          shellPath: jsExpr('ctx.get(\'shell\')?.enginePath ?? \'\''),
          shellArgs: jsExpr('ctx.get(\'shell\')?.engineArgs ?? []'),
          timeoutMs: 300000,
        },
      },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      {
        id: 'bash-native-persistent',
        name: '@deepseek-ai/dsh-tool-bash-persistent',
        disabled: true,
        config: { timeoutMs: 300000, description: PERSISTENT_DESCRIPTION },
      },
    ],
  },
  { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
  {
    id: 'tool-fs-search',
    name: '@deepseek-ai/dsh-tool-fs-search',
    config: { sampleOverCapGlobResults: false },
  },
  { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
  { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
  { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
  { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
  { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
  {
    id: 'planning',
    name: 'cordis:group',
    group: true,
    isolate: { planMode: true },
    config: [{ id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: PLAN_MODE_SECTION } }],
  },
  {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true, toolResultPruner: true },
    config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
      {
        id: 'tool-result-pruner',
        name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
        config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
      },
    ],
  },
  {
    id: 'delegation',
    name: 'cordis:group',
    group: true,
    isolate: { workflowEngine: true },
    config: [
      { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
      { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
      {
        id: 'tool-subagent',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: {
          provider: 'spawn',
          toolName: 'subagent',
          modelSelectionSettings: true,
        },
      },
      {
        id: 'tool-subagent-fork',
        name: '@deepseek-ai/dsh-tool-subagent',
        config: { provider: 'fork', toolName: 'subagent_fork' },
      },
      { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
      { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
    ],
  },
  { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
  { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
  { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
  { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
  { id: 'tool-plugin-manager', name: '@deepseek-ai/dsh-plugin-manager/tools', disabled: true },
]

/** The lean preset's rows, in the shipped `minimal` preset's order. */
const MINIMAL_ROWS: readonly PresetRow[] = [
  {
    id: 'persona',
    name: '@deepseek-ai/dsh-persona',
    config: { prefix: 'You are a helpful software engineer assistant.', complete: true, includeRuntimeContext: false },
  },
  {
    id: 'bash-native-shell-minimal',
    name: 'cordis:group',
    group: true,
    isolate: { shell: true, terminals: true },
    config: [
      { id: 'bash-native', name: SELF_ENTRY, config: { confine: true, requireEngineOnLoad: true } },
      { id: 'bash-native-terminal', name: '@deepseek-ai/dsh-terminal' },
      {
        id: 'bash-native-terminal-pty',
        name: '@deepseek-ai/dsh-terminal-bash',
        inject: ['shell'],
        config: {
          backendType: 'shell',
          shellDialect: 'bash',
          shellPath: jsExpr('ctx.get(\'shell\')?.enginePath ?? \'\''),
          shellArgs: jsExpr('ctx.get(\'shell\')?.engineArgs ?? []'),
          timeoutMs: 300000,
        },
      },
      {
        id: 'bash-native-persistent',
        name: '@deepseek-ai/dsh-tool-bash-persistent',
        config: { timeoutMs: 300000, description: PERSISTENT_DESCRIPTION },
      },
    ],
  },
]
// <<< generated

/**
 * Rows this preset adds only where the host can mount them, anchored to the upstream row each one
 * follows in the shipped `standard` preset.
 *
 * The anchor is asserted when a composition is built, because a run whose anchor disappeared from the
 * mirrored rows would otherwise drop out of the composition silently.
 */
const FULL_INSERTS: readonly GatedInsert[] = [
  { after: 'agent-instructions', gate: TIME_CONTEXT_PACKAGE, rows: [TIME_CONTEXT_ROW] },
  { after: 'tool-jobs', gate: TOOL_SCHEDULE_PACKAGE, rows: [TOOL_SCHEDULE_ROW] },
]

/** The reminder tools a subagent must not reach, as the shipped preset denies them. */
const SCHEDULE_TOOLS = ['schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update'] as const

/** The subagent rows the shipped preset denies those tools to; its disabled providers carry no filter. */
const SCHEDULE_DENIED_ROWS = new Set(['tool-subagent', 'tool-subagent-fork'])

/**
 * Apply the shipped preset's reminder-tool denial to the delegation group.
 * @param rows - the composed rows.
 * @returns the rows with `toolFilter.deny` on the two enabled subagent providers.
 */
function denyScheduleTools(rows: readonly PresetRow[]): readonly PresetRow[] {
  return rows.map((row) =>
    row.id !== 'delegation' || !Array.isArray(row.config)
      ? row
      : {
          ...row,
          config: row.config.map((child: PresetRow) =>
            !SCHEDULE_DENIED_ROWS.has(child.id)
              ? child
              : { ...child, config: { ...(child.config as object), toolFilter: { deny: [...SCHEDULE_TOOLS] } } },
          ),
        },
  )
}

/** Changes this preset makes where the host ships the generation that introduced them. */
const FULL_AMENDMENTS: readonly GatedAmendment[] = [
  { gate: TOOL_SCHEDULE_PACKAGE, apply: denyScheduleTools },
]

/**
 * Build one preset's definition for a host.
 *
 * Pure: the answer depends only on the id and the set of packages the caller found importable, so the
 * same host facts always compose the same rows.
 * @param id - which of `PRESET_IDS` to compose.
 * @param available - the harness packages the host's preset base can import.
 * @returns the definition to hand to `ctx.agentPresets.register`.
 * @throws when a gated run is anchored to a row the mirrored data no longer carries.
 */
export function composePreset(id: PresetId, available: ReadonlySet<string>): PresetDefinition {
  const meta = PRESET_META[id]
  return {
    id,
    name: meta.name,
    description: meta.description,
    order: meta.order,
    plugins: id === 'bash-native' ? composeFull(available) : [...MINIMAL_ROWS],
  }
}

/**
 * The packages `composePreset` asks this host about, so a caller probes exactly what it needs.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct gate package names, in first-use order.
 */
export function gatePackages(id: PresetId): readonly string[] {
  if (id !== 'bash-native') return []
  return [...new Set([...FULL_INSERTS.map((insert) => insert.gate), ...FULL_AMENDMENTS.map((amendment) => amendment.gate)])]
}

/**
 * Compose the full preset's rows for a host.
 * @param available - the harness packages the host's preset base can import.
 * @returns the rows in the shipped preset's order, with every host-supported addition in place.
 */
function composeFull(available: ReadonlySet<string>): readonly PresetRow[] {
  const anchors = new Set(FULL_ROWS.map((row) => row.id))
  for (const insert of FULL_INSERTS) {
    if (!anchors.has(insert.after)) {
      throw new Error(`preset bash-native: gated rows are anchored to "${insert.after}", which the mirrored rows do not carry`)
    }
  }
  const rows: PresetRow[] = []
  for (const row of FULL_ROWS) {
    rows.push(row)
    for (const insert of FULL_INSERTS) {
      if (insert.after === row.id && available.has(insert.gate)) rows.push(...insert.rows)
    }
  }
  return FULL_AMENDMENTS.reduce<readonly PresetRow[]>(
    (acc, amendment) => (available.has(amendment.gate) ? amendment.apply(acc) : acc),
    rows,
  )
}