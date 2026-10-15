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
import { SELF_ENTRY, jsExpr } from './entries.js';
/**
 * A `!!js` expression node and this bundle's own entry URL, shared with the interactive terminal
 * component through `./entries.js`.
 *
 * Re-exported rather than defined here so the two compositions cannot drift: a second copy would show up
 * as one of them silently reading nothing from `ctx.shell`, and no alarm compares the two copies.
 */
export { SELF_ENTRY, jsExpr };
/** The preset ids this bundle registers. Sessions pin an id, so these values are a compatibility surface. */
export const PRESET_IDS = ['bash-native', 'bash-native-minimal'];
/** The harness package that carries the preset-scoped clock, and the gate for its row. */
export const TIME_CONTEXT_PACKAGE = '@deepseek-ai/dsh-time-context';
/**
 * The harness package that carries the four reminder tools, and the gate for its row.
 *
 * The tools and the subagent denial arrived in one 0.2.1-alpha release, but they are not the same
 * host fact: 0.2.1-alpha.3 still ships this package while the subagent tool dropped the field the
 * denial is written with, so the row gate and the denial's capability are asked separately
 * ({@link SUBAGENT_PACKAGE}).
 */
export const TOOL_SCHEDULE_PACKAGE = '@deepseek-ai/dsh-tool-schedule';
/**
 * The subagent tool whose own exported config decides whether a subagent row can carry the
 * reminder-tool denial.
 *
 * The package is present on every line of this bundle's window, so its presence cannot answer that
 * question: 0.2.1-alpha.3 removed `persona` and `toolFilter` from its config — a child now selects an
 * Agent Preset through `agentPreset` — and rejects either key at mount. The fact this bundle reads
 * instead is the `Config` schema the module itself exports, the declaration a row's config is
 * validated against when it mounts.
 */
export const SUBAGENT_PACKAGE = '@deepseek-ai/dsh-tool-subagent';
/**
 * The file tool whose own exported config decides whether the alpha.3 `minimal` rows can be carried.
 *
 * 0.2.1-alpha.3 added the `read`/`readImage`/`write`/`edit` toggles to this module's config, and added
 * the image-only file tool and the compaction group to the shipped `minimal` preset. Older lines ship
 * the same package with only the read caps: a row that sets the toggles there is accepted and ignored,
 * which would register the full read/write/edit suite — the opposite of what the row states.
 */
export const TOOL_FS_PACKAGE = '@deepseek-ai/dsh-tool-fs';
// >>> generated: preset metadata and row data ported from cordis.patch.yml
/** The plan section the shipped `standard` preset hands `plan-mode`. */
const PLAN_MODE_SECTION = `You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.
`;
/** The description the shipped presets give the persistent shell tool. */
const PERSISTENT_DESCRIPTION = `Run commands in a persistent bash shell
* State is persistent across command calls and discussions with the user.
* This is a bash (POSIX) shell on Windows, not PowerShell; use bash syntax and POSIX paths.
* \`stty\` does not exist in this environment, so input echo stays on.
* Please avoid commands that may produce a very large amount of output.
* Please run long lived commands in the background, e.g. 'sleep 10 &' or start a server in the background.`;
/** The clock row the shipped `standard` preset adds after `agent-instructions`. */
const TIME_CONTEXT_ROW = { id: 'time-context', name: TIME_CONTEXT_PACKAGE };
/** The reminder-tool row it adds after `tool-jobs`, which the rows mirrored here therefore lack. */
const TOOL_SCHEDULE_ROW = { id: 'tool-schedule', name: TOOL_SCHEDULE_PACKAGE };
/** Display metadata of both presets, mirroring the shipped presets they follow. */
const PRESET_META = {
    'bash-native': {
        name: 'Native Bash (Windows)',
        description: 'A native POSIX bash on Windows (the brush engine this bundle ships and verifies; no MSYS runtime) with the harness file sandbox, background jobs, and spill-backed output.',
        order: 5,
    },
    'bash-native-minimal': {
        name: 'Native Bash (Windows, minimal)',
        description: 'The lean Native Bash preset — a persona, an image-only file tool, a compaction group and one persistent bash shell on the brush engine this bundle ships and verifies, with the short environment contract.',
        order: 6,
    },
};
/** The full preset's rows, in the shipped `standard` preset's order. */
const FULL_ROWS = [
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
];
/** The lean preset's rows, in the shipped `minimal` preset's order. */
const MINIMAL_ROWS = [
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
];
/** The image-only file tool the shipped `minimal` preset gained in 0.2.1-alpha.3. */
const TOOL_FS_ROW = {
    id: 'tool-fs',
    name: TOOL_FS_PACKAGE,
    config: { read: false, readImage: true, write: false, edit: false },
};
/** The compaction group it gained in the same release. */
const COMPACTION_ROW = {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true },
    config: [
        { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
        { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    ],
};
/**
 * The two rows alpha.3 added to the shipped `minimal` preset, held behind one capability gate.
 *
 * Both landed in the same release, and the only release-level fact this bundle can read is the
 * tool-fs toggle family that arrived with them: a host whose `dsh-tool-fs` config declares all four
 * toggles can express the image-only row, and gets compaction beside it; an older line gets neither,
 * keeping its pre-0.1.8 composition (persona + one persistent shell) instead of a row whose toggles
 * schemastery would silently drop while the full read/write/edit suite registers.
 */
const MINIMAL_INSERTS = [
    {
        after: 'persona',
        gates: [],
        requires: [{ package: TOOL_FS_PACKAGE, fields: ['read', 'readImage', 'write', 'edit'] }],
        rows: [TOOL_FS_ROW, COMPACTION_ROW],
    },
];
// <<< generated
/**
 * Rows this preset adds only where the host can mount them, anchored to the upstream row each one
 * follows in the shipped `standard` preset.
 *
 * The anchor is asserted when a composition is built, because a run whose anchor disappeared from the
 * mirrored rows would otherwise drop out of the composition silently.
 */
const FULL_INSERTS = [
    { after: 'agent-instructions', gates: [TIME_CONTEXT_PACKAGE], requires: [], rows: [TIME_CONTEXT_ROW] },
    { after: 'tool-jobs', gates: [TOOL_SCHEDULE_PACKAGE], requires: [], rows: [TOOL_SCHEDULE_ROW] },
];
/** The reminder tools a subagent must not reach, as the shipped preset denies them. */
const SCHEDULE_TOOLS = ['schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update'];
/** The subagent rows the shipped preset denies those tools to; its disabled providers carry no filter. */
const SCHEDULE_DENIED_ROWS = new Set(['tool-subagent', 'tool-subagent-fork']);
/**
 * Apply the shipped preset's reminder-tool denial to the delegation group.
 * @param rows - the composed rows.
 * @returns the rows with `toolFilter.deny` on the two enabled subagent providers.
 */
function denyScheduleTools(rows) {
    return rows.map((row) => row.id !== 'delegation' || !Array.isArray(row.config)
        ? row
        : {
            ...row,
            config: row.config.map((child) => !SCHEDULE_DENIED_ROWS.has(child.id)
                ? child
                : { ...child, config: { ...child.config, toolFilter: { deny: [...SCHEDULE_TOOLS] } } }),
        });
}
/**
 * Changes this preset makes where the host ships the generation that introduced them.
 *
 * The reminder-tool denial needs two facts, not one: the tools have to exist (the gate), and the
 * subagent tool has to accept the field that denies them. 0.2.1-alpha.3 ships both the tools and a
 * subagent that rejects `toolFilter`, and the shipped preset dropped the denial there instead.
 */
const FULL_AMENDMENTS = [
    {
        gates: [TOOL_SCHEDULE_PACKAGE],
        requires: [{ package: SUBAGENT_PACKAGE, fields: ['toolFilter'] }],
        apply: denyScheduleTools,
    },
];
/** The composition each preset id is built from. */
const COMPOSITIONS = {
    'bash-native': { rows: FULL_ROWS, inserts: FULL_INSERTS, amendments: FULL_AMENDMENTS },
    'bash-native-minimal': { rows: MINIMAL_ROWS, inserts: MINIMAL_INSERTS, amendments: [] },
};
/**
 * Build one preset's definition for a host.
 *
 * Pure: the answer depends only on the id and the host facts, so the same host facts always compose
 * the same rows.
 * @param id - which of `PRESET_IDS` to compose.
 * @param facts - what this host can import, and which fields its modules' exported configs declare.
 * @returns the definition to hand to `ctx.agentPresets.register`.
 * @throws when a gated run is anchored to a row the mirrored data no longer carries.
 */
export function composePreset(id, facts) {
    const meta = PRESET_META[id];
    return {
        id,
        name: meta.name,
        description: meta.description,
        order: meta.order,
        plugins: composeRows(id, COMPOSITIONS[id], facts),
    };
}
/**
 * The package gates `composePreset` and its amendments consult for one preset.
 *
 * The union includes the amendments' gates, not only the inserts': an amendment whose gate is never
 * probed can never apply, and that failure would be silent — the composition would just miss the
 * change. Keeping this list a superset of every gate the composition tests is pinned by the
 * table-driven case in `test-presets.mjs`.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct gate package names, in first-use order.
 */
export function gatePackages(id) {
    const { inserts, amendments } = COMPOSITIONS[id];
    return [...new Set([...inserts.flatMap((insert) => insert.gates), ...amendments.flatMap((amendment) => amendment.gates)])];
}
/**
 * Every exported-config requirement one preset's composition tests, for its probe and its log.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the requirements in first-use order, duplicates removed.
 */
export function configRequirements(id) {
    const { inserts, amendments } = COMPOSITIONS[id];
    const all = [...inserts.flatMap((insert) => insert.requires), ...amendments.flatMap((amendment) => amendment.requires)];
    return [...new Map(all.map((requirement) => [requirement.package + "." + requirement.fields.join(","), requirement])).values()];
}
/**
 * The packages whose own exported configuration decides how this preset is composed.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct capability package names, in first-use order.
 */
export function capabilityPackages(id) {
    return [...new Set(configRequirements(id).map((requirement) => requirement.package))];
}
/**
 * Every package one host probe has to answer for this preset: its gates and its config packages.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct package names, gates first.
 */
export function probePackages(id) {
    return [...new Set([...gatePackages(id), ...capabilityPackages(id)])];
}
/**
 * Whether every named package is importable and every required config field is declared.
 *
 * No `configs` entry means the package is absent (or was never probed) and a `null` entry means its
 * config was unreadable; both answer false, so a requirement this host cannot prove leaves its rows
 * out instead of assuming the field is there.
 * @param gates - package names that have to be importable.
 * @param requires - exported-config requirements that have to hold.
 * @param facts - the host facts the composition is built from.
 * @returns whether the gated rows or the amendment apply to this host.
 */
function applies(gates, requires, facts) {
    if (!gates.every((gate) => facts.packages.has(gate)))
        return false;
    return requires.every((requirement) => {
        const fields = facts.configs.get(requirement.package);
        return fields != null && requirement.fields.every((field) => fields.has(field));
    });
}
/**
 * Compose one preset's rows for a host.
 * @param id - which preset the rows belong to, for the anchor error.
 * @param composition - the base rows and the host-dependent changes declared for the preset.
 * @param facts - what this host can import, and which fields its modules' exported configs declare.
 * @returns the rows in the shipped preset's order, with every host-supported addition in place.
 * @throws when a gated run is anchored to a row the mirrored data no longer carries.
 */
function composeRows(id, composition, facts) {
    const { rows: base, inserts, amendments } = composition;
    const anchors = new Set(base.map((row) => row.id));
    for (const insert of inserts) {
        if (!anchors.has(insert.after)) {
            throw new Error(`preset ${id}: gated rows are anchored to "${insert.after}", which the mirrored rows do not carry`);
        }
    }
    const rows = [];
    for (const row of base) {
        rows.push(row);
        for (const insert of inserts) {
            if (insert.after === row.id && applies(insert.gates, insert.requires, facts))
                rows.push(...insert.rows);
        }
    }
    return amendments.reduce((acc, amendment) => (applies(amendment.gates, amendment.requires, facts) ? amendment.apply(acc) : acc), rows);
}
