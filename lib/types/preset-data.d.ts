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
export declare const PRESET_IDS: readonly ['bash-native', 'bash-native-minimal'];
/** One of the ids in `PRESET_IDS`. */
export type PresetId = (typeof PRESET_IDS)[number];
/** The harness package that carries the preset-scoped clock, and the gate for its row. */
export declare const TIME_CONTEXT_PACKAGE = "@deepseek-ai/dsh-time-context";
/**
 * The harness package that carries the four reminder tools, and the gate for its row and for the
 * subagent denials that arrived with it.
 *
 * Both are 0.2.1-alpha additions, they landed in one upstream release, and a package is the only
 * release-level signal a host exposes here: a preset row's configuration cannot be probed without
 * mounting it. A host that shipped one without the other would be reported by the mount audit
 * instead of being silently accommodated.
 */
export declare const TOOL_SCHEDULE_PACKAGE = "@deepseek-ai/dsh-tool-schedule";
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
 * Pure: the answer depends only on the id and the set of packages the caller found importable, so the
 * same host facts always compose the same rows.
 * @param id - which of `PRESET_IDS` to compose.
 * @param available - the harness packages the host's preset base can import.
 * @returns the definition to hand to `ctx.agentPresets.register`.
 * @throws when a gated run is anchored to a row the mirrored data no longer carries.
 */
export declare function composePreset(id: PresetId, available: ReadonlySet<string>): PresetDefinition;
/**
 * The packages `composePreset` asks this host about, so a caller probes exactly what it needs.
 * @param id - which of `PRESET_IDS` to inspect.
 * @returns the distinct gate package names, in first-use order.
 */
export declare function gatePackages(id: PresetId): readonly string[];
