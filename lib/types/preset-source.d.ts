/**
 * Locating, reading and shape-checking the shipped preset body this bundle follows.
 *
 * The two presets this bundle registers are the shipped `standard` and `minimal` compositions of the
 * host's **own** harness line, with the shell surface replaced; the file read here is what makes that
 * follow the line instead of a copy taken at release time. The package that carries the file is the
 * same one that mounts the agent-preset registry whose rows these compositions are registered into, so
 * the file and the modules those rows name come from one installation.
 *
 * The lookup asks the launcher-owned package service first — the call its own row preflight uses, which
 * is documented as locating a package "without requiring a package export" — and falls back to a
 * `createRequire` resolve from the same base, which is the call the Loader's degraded path already uses.
 * Both answer a package directory; a request that resolves but names no directory is a broken answer,
 * not an absence, so it is reported instead of being treated as one.
 *
 * The file is the Loader's own YAML dialect: `!!js` scalars become `{ __jsExpr }` nodes and are left
 * unevaluated, exactly as the Loader leaves them for a row it mounts, so a shipped expression keeps the
 * deferral it has in the shipped preset. Only the container is checked here — the registry validates
 * every row when the definition is registered.
 * @module dsh-bash-native/preset-source
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PresetRow, PresetSource, ShippedPreset } from './preset-data.js';
/** The package that ships the preset bodies this bundle follows. */
export declare const SHIPPED_PRESET_PACKAGE = "@deepseek-ai/dsh-web-app";
/** The one platform this bundle's engine exists on: the shipped artifact is the Windows rubash build. */
export declare const SUPPORTED_PLATFORM = "win32";
/**
 * Whether the presets can serve a host at all.
 *
 * Not a configuration switch: the executor this bundle registers resolves the Windows brush build it
 * ships and declares no candidate on any other platform, so a preset mounted elsewhere would advertise
 * a shell that cannot start.
 * @param platform - the platform to answer for, normally `process.platform`.
 * @returns whether this bundle may register its presets there.
 */
export declare function isSupportedPlatform(platform: string): boolean;
/**
 * Parse one shipped patch file with the Loader's own dialect.
 * @param text - the file's contents.
 * @param at - the path to name in a diagnostic.
 * @returns the parsed document.
 * @throws when the text is not YAML this dialect accepts.
 */
export declare function parseShippedPreset(text: string, at: string): unknown;
/**
 * Read the composition one shipped patch file declares.
 *
 * The declaration is looked up among every row the file inserts rather than at a fixed position, so a
 * file that grows another patch entry does not move it. The declared preset id is checked against the
 * id this file is supposed to carry: a file that declares another preset is a different composition,
 * and mounting it under this bundle's id would hand a session a preset nobody asked for.
 * @param document - the parsed patch file.
 * @param source - which shipped preset the file is expected to declare.
 * @param at - the path to name in a diagnostic.
 * @returns the rows of that preset's composition.
 * @throws when the file carries no single preset declaration, declares a different id, or declares no rows.
 */
export declare function presetRowsOf(document: unknown, source: PresetSource, at: string): readonly PresetRow[];
/**
 * Read one preset file at a known path.
 * @param path - the file to read.
 * @param source - which shipped preset it is expected to declare.
 * @returns the path and the rows it declares.
 * @throws when the file cannot be read, or declares something other than this source's composition.
 */
export declare function readPresetFile(path: string, source: PresetSource): Promise<ShippedPreset>;
/**
 * Locate and read the shipped preset one of this bundle's ids follows.
 * @param ctx - this entry's context, for the launcher-owned package service when it is mounted.
 * @param base - the resolution base of the registry the definition is registered into.
 * @param source - which shipped preset to read.
 * @returns the resolved path and the rows it declares.
 * @throws when the package that carries the file cannot be located, or the file cannot be read as that preset.
 */
export declare function readShippedPreset(ctx: Context, base: string | undefined, source: PresetSource): Promise<ShippedPreset>;
