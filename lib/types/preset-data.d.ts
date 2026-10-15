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
export declare const PRESET_IDS: readonly ['bash-native', 'bash-native-minimal'];
/** One of the ids in `PRESET_IDS`. */
export type PresetId = (typeof PRESET_IDS)[number];
/** The harness package that carries the preset-scoped clock, and the gate for its row. */
export declare const TIME_CONTEXT_PACKAGE = "@deepseek-ai/dsh-time-context";
/**
 * The harness package that carries the four reminder tools, and the gate for its row.
 *
 * The tools and the subagent denial arrived in one 0.2.1-alpha release, but they are not the same
 * host fact: 0.2.1-alpha.3 still ships this package while the subagent tool dropped the field the
 * denial is written with, so the row gate and the denial's capability are asked separately
 * ({@link SUBAGENT_PACKAGE}).
 */
export declare const TOOL_SCHEDULE_PACKAGE = "@deepseek-ai/dsh-tool-schedule";
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
export declare const SUBAGENT_PACKAGE = "@deepseek-ai/dsh-tool-subagent";
/**
 * Whether a host's subagent tool still understands the `toolFilter` config key.
 *
 * `supported` means the module's exported `Config` schema declares the key (every line through
 * 0.2.1-alpha.2, including the 0.2.0 desktop line), `rejected` means the schema was readable and does
 * not (0.2.1-alpha.3 onward), and `unknown` means the question could not be asked — the package is
 * absent, the module exposes no field map, or only its resolution could be checked.
 */
export type ToolFilterSupport = 'supported' | 'rejected' | 'unknown';
/** The host facts one composition is built from. */
export interface HostFacts {
    /** Package names a row naming one could import from the base a registered preset resolves against. */
    readonly packages: ReadonlySet<string>;
    /** What this host's subagent config says about the field the reminder-tool denial needs. */
    readonly subagentToolFilter: ToolFilterSupport;
}
/** One row of a composition, in the shape the Loader's own entry list accepts. */
export interface PresetRow {
    readonly id: string;
    readonly name: string;
    readonly group?: true;
    readonly disabled?: boolean;
    readonly inject?: readonly string[];
    readonly isolate?: Readonly<Record<string, boolean>>;
    /** A row's own configuration, or the child rows of a group. */
    readonly config?: unknown;
}
/** A preset definition as `ctx.agentPresets.register` takes it. */
export interface PresetDefinition {
    readonly id: PresetId;
    readonly name: string;
    readonly description: string;
    readonly order: number;
    readonly plugins: readonly PresetRow[];
}
/**
 * Build one preset's definition for a host.
 *
 * Pure: the answer depends only on the id and the host facts, so the same host facts always compose
 * the same rows.
 * @param id - which of `PRESET_IDS` to compose.
 * @param facts - what this host can import, and which subagent config generation it speaks.
 * @returns the definition to hand to `ctx.agentPresets.register`.
 * @throws when a gated run is anchored to a row the mirrored data no longer carries.
 */
export declare function composePreset(id: PresetId, facts: HostFacts): PresetDefinition;
/**
 * The row-gate packages `composePreset` asks this host about, so a caller probes exactly what it needs.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct gate package names, in first-use order.
 */
export declare function gatePackages(id: PresetId): readonly string[];
/**
 * The packages whose own exported configuration decides how this preset is amended.
 *
 * Separate from `gatePackages`: an amendment's gate decides whether the rows it changes exist, while
 * this package is the one asked whether the change can be expressed at all.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct capability package names, in first-use order.
 */
export declare function capabilityPackages(id: PresetId): readonly string[];
