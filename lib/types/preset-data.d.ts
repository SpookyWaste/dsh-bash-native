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
/** The preset ids this bundle registers. Sessions pin an id, so these values are a compatibility surface. */
export declare const PRESET_IDS: readonly ['bash-native', 'bash-native-minimal'];
/** One of the ids in `PRESET_IDS`. */
export type PresetId = (typeof PRESET_IDS)[number];
/** One row of a composition, in the shape the Loader's own entry list accepts. */
export interface PresetRow {
    readonly id: string;
    readonly name: string;
    readonly group?: true;
    /** A literal switch, or the `!!js` node a shipped row carries; the Loader evaluates the latter. */
    readonly disabled?: boolean | Readonly<{
        readonly __jsExpr: string;
    }>;
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
/** One shipped composition this bundle follows. */
export interface PresetSource {
    /** The shipped preset file to read, without its `.patch.yml` suffix. */
    readonly file: 'standard' | 'minimal';
    /** The preset id that file declares, which the read composition is checked against. */
    readonly upstreamId: 'standard' | 'minimal';
    /** The shell rows it carries, by id, wherever they sit; this bundle mounts its realm group in their place. */
    readonly replaced: readonly string[];
}
/** A shipped composition as it was read: the file it came from, and the rows it declares. */
export interface ShippedPreset {
    /** Absolute path of the file the rows were read from, for diagnostics. */
    readonly path: string;
    /** The declared rows, with `!!js` nodes left for the Loader. */
    readonly rows: readonly PresetRow[];
}
/**
 * Which shipped preset each id follows.
 *
 * `bash-native` follows `standard` and `bash-native-minimal` follows `minimal`, in both spellings the
 * shipped files use: the file name and the `config.id` it declares are checked against these values, so a
 * file that was replaced by another preset's body is refused rather than mounted under this bundle's id.
 */
export declare const SHIPPED_SOURCES: Readonly<Record<PresetId, PresetSource>>;
/** The row id of the realm group this bundle mounts in place of a shipped shell surface. */
export declare const SHELL_GROUP_IDS: Readonly<Record<PresetId, string>>;
/**
 * Build this bundle's definition for one shipped composition.
 *
 * Pure: the same shipped rows always compose the same definition.
 * @param id - which of `PRESET_IDS` to compose.
 * @param shipped - the shipped composition this id follows, as read from the host's own installation.
 * @returns the definition to hand to `ctx.agentPresets.register`.
 * @throws when the shipped composition no longer carries the shell surface this bundle replaces.
 */
export declare function composePreset(id: PresetId, shipped: ShippedPreset): PresetDefinition;
