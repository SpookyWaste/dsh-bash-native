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
 * The file tool whose own exported config decides whether the alpha.3 `minimal` rows can be carried.
 *
 * 0.2.1-alpha.3 added the `read`/`readImage`/`write`/`edit` toggles to this module's config, and added
 * the image-only file tool and the compaction group to the shipped `minimal` preset. Older lines ship
 * the same package with only the read caps: a row that sets the toggles there is accepted and ignored,
 * which would register the full read/write/edit suite — the opposite of what the row states.
 */
export declare const TOOL_FS_PACKAGE = "@deepseek-ai/dsh-tool-fs";
/** One `Config` field group a host module has to declare before a host-dependent change applies. */
export interface ConfigRequirement {
    /** The package whose exported `Config` is read; the probe asks it even when no row names it. */
    readonly package: string;
    /** Every field named here has to be a key of that exported `Config`'s field map. */
    readonly fields: readonly string[];
}
/**
 * The host facts one composition is built from.
 *
 * `configs` carries what each probed module's own exported `Config` declared: the field names, `null`
 * for a module that exposes no readable field map, and no entry for a package this host cannot import.
 * Reading the declaration rather than guessing a version is what lets one published composition follow
 * the harness line it runs on; `requires` on a gated row or amendment names exactly what it needs.
 */
export interface HostFacts {
    /** Package names a row naming one could import from the base a registered preset resolves against. */
    readonly packages: ReadonlySet<string>;
    /** Per probed package, the field names its exported `Config` declared, or null when unreadable. */
    readonly configs: ReadonlyMap<string, ReadonlySet<string> | null>;
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
/** The two packages the alpha.3 `minimal` compaction group mounts; both gate the run that carries it. */
export declare const COMPACTION_BASIC_PACKAGE = "@deepseek-ai/dsh-compaction-basic";
export declare const COMPACTION_COMMAND_PACKAGE = "@deepseek-ai/dsh-command-compact";
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
export declare function composePreset(id: PresetId, facts: HostFacts): PresetDefinition;
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
export declare function gatePackages(id: PresetId): readonly string[];
/**
 * Every exported-config requirement one preset's composition tests, for its probe and its log.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the requirements in first-use order, duplicates removed.
 */
export declare function configRequirements(id: PresetId): readonly ConfigRequirement[];
/**
 * The packages whose own exported configuration decides how this preset is composed.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct capability package names, in first-use order.
 */
export declare function capabilityPackages(id: PresetId): readonly string[];
/**
 * Every package one host probe has to answer for this preset: its gates and its config packages.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct package names, gates first.
 */
export declare function probePackages(id: PresetId): readonly string[];
