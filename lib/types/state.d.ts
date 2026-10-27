/**
 * The per-user state directory: what this plugin materializes there, what an upgrade leaves behind, and the
 * pass that reclaims it.
 *
 * Everything under `%LOCALAPPDATA%\dsh-bash-native` that an install writes is content-addressed: one
 * `shim/<engine sha256>` directory per engine build (the `bash`/`sh` names, hard links to the engine when the
 * volume allows it) and one `toolchain/<manifest digest>` directory per packaged toolchain (the materialized
 * programs plus their `bin/` names). An upgrade whose engine or toolchain bytes changed lands in a new
 * directory and leaves the old one behind. Two things use this module: `bin/clean-state.mjs`, which reports
 * and deletes on request, and the executor's own background pass, which removes a superseded directory only
 * when doing so actually frees its bytes.
 *
 * Sizes are counted the way `du` counts them: names that share one file (hard links) are counted once, which
 * is why a directory whose listing is a gigabyte of applet names can really occupy one 16 MB binary. The same
 * link count is what separates "deleting this frees the bytes" from "the bytes live on through a name
 * elsewhere" — an installed package's own copy of the same binary, for example.
 * @module dsh-bash-native/state
 */
/** One child of a directory, as `readdir` reports it.
 *
 * The type has to come from the directory entry rather than from `lstat`, because Windows reports a junction
 * as a plain directory through `lstat` while `readdir` flags it as a link. Measurement and deletion both care:
 * a junction inside a cache would otherwise be measured through its target.
 */
export interface StateDirEntry {
    readonly name: string;
    /** Whether the name is a link or junction, which is never followed. */
    readonly link: boolean;
    /** Whether it is a directory (false for links, even ones that point at directories). */
    readonly directory: boolean;
}
/** One file as the classification needs it. */
export interface StateFile {
    /** Size in bytes. */
    readonly bytes: number;
    /** Whether this is a regular file rather than a directory. */
    readonly file: boolean;
    /** Hard-link key (`device:inode`), or null when the platform cannot name one. */
    readonly identity: string | null;
    /** How many names this file has in total. */
    readonly links: number;
    /** Whether the name itself is a link or junction, which is never followed or descended into. */
    readonly link: boolean;
}
/** The filesystem questions this module asks, injected so the classification is testable without a tree. */
export interface StateIo {
    /** @param path - candidate path. @returns whether it is a directory. */
    isDirectory(path: string): boolean;
    /** @param path - directory. @returns its entries with the type `readdir` reports, or null when unreadable. */
    names(path: string): readonly StateDirEntry[] | null;
    /** @param path - candidate path. @returns its identity, or null when it is absent. */
    stat(path: string): StateFile | null;
    /** Deletes a file or a directory tree, ignoring absence. */
    remove(path: string): void;
}
/** What an entry is, which decides what may be done to it. */
export type StateKind = 'shim' | 'toolchain' | 'tools' | 'dev' | 'other';
/** Which flag or pass would delete an entry; null means nothing offers to. */
export type StateRemoval = 'superseded' | 'tools' | 'dev' | null;
/** One child of the state directory, with what it costs and what may be done to it. */
export interface StateEntry {
    readonly kind: StateKind;
    readonly name: string;
    readonly path: string;
    /** Bytes this entry is the first to account for, counted once per inode. */
    readonly bytes: number;
    /** Part of `bytes` whose inode has another name outside this entry, so deleting it frees nothing. */
    readonly shared: number;
    /** Whether the tree holds a link or junction; deleting it could reach outside, so the automatic pass refuses. */
    readonly linked: boolean;
    /** Whether this is the directory the current package would materialize. */
    readonly current: boolean;
    readonly removable: StateRemoval;
}
/** The whole directory, classified. */
export interface StateReport {
    readonly root: string;
    readonly present: boolean;
    readonly engine: string | null;
    readonly toolchain: string | null;
    readonly entries: readonly StateEntry[];
    readonly bytes: number;
    readonly removableBytes: number;
}
/** The production filesystem: four reads and one delete, so the classification above is the module's content. */
export declare const nodeIo: StateIo;
/**
 * Where an install keeps its per-user state.
 * @param env - the environment providing `LOCALAPPDATA`.
 * @returns the directory, or an empty string when it cannot be derived.
 */
export declare function defaultStateRoot(env: {
    readonly [name: string]: string | undefined;
}): string;
/**
 * The two digests this package would materialize, which is what makes a cache directory "current".
 *
 * The engine digest comes from the shipped `engine.lock.json`; the toolchain digest is the sha256 of the
 * shipped manifest text, which is exactly how `preparePackagedToolchain` names its cache. Either can be null
 * — an incomplete tree, an unreadable manifest — and then nothing is deleted rather than guessing which
 * directory the running package uses.
 * @param packageRoot - the installed package root.
 * @returns the engine digest and the toolchain digest, null when they cannot be derived.
 */
export declare function currentDigests(packageRoot: string): {
    engine: string | null;
    toolchain: string | null;
};
/**
 * Inspect the per-user directory.
 * @param options - `root`, the two digests this package uses, and the filesystem seam.
 * @returns the report: entries, totals, and whether the directory exists at all.
 */
export declare function inspectState(options: {
    readonly root: string;
    readonly engine: string | null;
    readonly toolchain: string | null;
    readonly io?: StateIo;
}): StateReport;
/**
 * The entries one deletion pass would remove.
 * @param entries - the report's entries.
 * @param options - which classes are allowed: `superseded`, `tools`, `dev`.
 * @returns the entries to remove.
 */
export declare function removable(entries: readonly StateEntry[], options: {
    superseded?: boolean;
    tools?: boolean;
    dev?: boolean;
}): StateEntry[];
/**
 * The bytes one deletion pass would actually free.
 * @param entries - the report's entries.
 * @param options - which classes are allowed: `superseded`, `tools`, `dev`.
 * @returns the bytes the pass would free.
 */
export declare function reclaimable(entries: readonly StateEntry[], options: {
    superseded?: boolean;
    tools?: boolean;
    dev?: boolean;
}): number;
/**
 * Delete the selected entries.
 * @param entries - entries from {@link removable}.
 * @param io - filesystem seam.
 * @returns how many entries were removed and how many bytes that actually freed.
 */
export declare function removeEntries(entries: readonly StateEntry[], io?: StateIo): {
    removed: number;
    bytes: number;
};
/**
 * Render a byte count in the unit a reader cares about.
 * @param bytes - the count.
 * @returns the text, e.g. `36 MB`.
 */
export declare function formatBytes(bytes: number): string;
/**
 * Render the report as text, grouping entries by kind and marking what a deletion pass would take.
 * @param report - a value from {@link inspectState}.
 * @returns the text.
 */
export declare function formatReport(report: StateReport): string;
