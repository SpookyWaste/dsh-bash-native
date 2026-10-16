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
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
/** The package that ships the preset bodies this bundle follows. */
export const SHIPPED_PRESET_PACKAGE = '@deepseek-ai/dsh-web-app';
/** The one platform this bundle's engine exists on: the shipped artifact is the Windows brush build. */
export const SUPPORTED_PLATFORM = 'win32';
/** The row name a shipped preset file declares its composition with. */
const PRESET_DECLARATION = '@deepseek-ai/dsh-agent-preset';
/** The service the launcher mounts to answer "which copy of a package does this profile resolve". */
const PACKAGE_SERVICE = 'pluginPackages';
/**
 * The shipped YAML dialect's `!!js` tag.
 *
 * The node shape is the Loader's own contract (`isJsExpr` reads the `__jsExpr` key alone), so a
 * carried expression is evaluated by the Loader against the row's own context with the same semantics
 * the shipped preset gets, and the raw form survives until then.
 */
const JS_EXPRESSION_TAG = {
    tag: 'tag:yaml.org,2002:js',
    resolve: (expression) => ({ __jsExpr: expression }),
};
/**
 * Whether the presets can serve a host at all.
 *
 * Not a configuration switch: the executor this bundle registers resolves the Windows brush build it
 * ships and declares no candidate on any other platform, so a preset mounted elsewhere would advertise
 * a shell that cannot start.
 * @param platform - the platform to answer for, normally `process.platform`.
 * @returns whether this bundle may register its presets there.
 */
export function isSupportedPlatform(platform) {
    return platform === SUPPORTED_PLATFORM;
}
/**
 * Parse one shipped patch file with the Loader's own dialect.
 * @param text - the file's contents.
 * @param at - the path to name in a diagnostic.
 * @returns the parsed document.
 * @throws when the text is not YAML this dialect accepts.
 */
export function parseShippedPreset(text, at) {
    try {
        return parse(text, { customTags: [JS_EXPRESSION_TAG] });
    }
    catch (error) {
        throw new Error(`dsh-bash-native: the shipped preset at ${at} is not valid YAML: ${messageOf(error)}`);
    }
}
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
export function presetRowsOf(document, source, at) {
    const row = insertedRows(document, at).find((candidate) => candidate.name === PRESET_DECLARATION);
    if (row === undefined) {
        throw new Error(`dsh-bash-native: the shipped preset at ${at} inserts no ${PRESET_DECLARATION} row`);
    }
    const config = row.config;
    if (!isRecord(config)) {
        throw new Error(`dsh-bash-native: the ${PRESET_DECLARATION} row at ${at} carries no configuration object`);
    }
    if (config.id !== source.upstreamId) {
        throw new Error(`dsh-bash-native: the shipped preset at ${at} declares the id ${JSON.stringify(config.id)}, not ${JSON.stringify(source.upstreamId)}`);
    }
    const plugins = config.plugins;
    if (!Array.isArray(plugins) || plugins.length === 0) {
        throw new Error(`dsh-bash-native: the shipped preset at ${at} declares no rows`);
    }
    // Every row is carried as the file declares it; the registry validates each one at registration, which
    // is the only place the full entry contract is known. What this module needs from a row is its id.
    return plugins;
}
/**
 * Read one preset file at a known path.
 * @param path - the file to read.
 * @param source - which shipped preset it is expected to declare.
 * @returns the path and the rows it declares.
 * @throws when the file cannot be read, or declares something other than this source's composition.
 */
export async function readPresetFile(path, source) {
    let text;
    try {
        text = await readFile(path, 'utf8');
    }
    catch (error) {
        throw new Error(`dsh-bash-native: cannot read the shipped preset at ${path}: ${messageOf(error)}`);
    }
    return { path, rows: presetRowsOf(parseShippedPreset(text, path), source, path) };
}
/**
 * Locate and read the shipped preset one of this bundle's ids follows.
 * @param ctx - this entry's context, for the launcher-owned package service when it is mounted.
 * @param base - the resolution base of the registry the definition is registered into.
 * @param source - which shipped preset to read.
 * @returns the resolved path and the rows it declares.
 * @throws when the package that carries the file cannot be located, or the file cannot be read as that preset.
 */
export async function readShippedPreset(ctx, base, source) {
    const dir = resolveShippedPresetDir(ctx, base);
    return readPresetFile(join(dir, 'presets', `${source.file}.patch.yml`), source);
}
/**
 * The directory of the package that carries the shipped preset files.
 *
 * `pluginPackages.packageOf` is asked first because it answers from the same runtime resolution the
 * Loader's own rows are resolved through and needs no package export to do it; `createRequire` from the
 * same base is the fallback for a host that launches without the launcher-owned service.
 * @param ctx - this entry's context.
 * @param base - the registry's resolution base, or undefined when the registry exposes none.
 * @returns the package directory.
 * @throws when neither question resolves the package, naming what each one answered.
 */
function resolveShippedPresetDir(ctx, base) {
    const parent = base ?? import.meta.url;
    const problems = [];
    const packages = ctx.get(PACKAGE_SERVICE);
    let found;
    try {
        found = packages?.packageOf(SHIPPED_PRESET_PACKAGE, parent);
    }
    catch (error) {
        // A throwing lookup is reported below with everything else that failed; the fallback still runs, so
        // a broken service cannot be the reason the presets disappear while a working resolve exists.
        problems.push(`${PACKAGE_SERVICE}.packageOf threw: ${messageOf(error)}`);
    }
    if (found !== undefined) {
        const dir = found.dir ?? (found.manifestPath === undefined ? undefined : dirname(found.manifestPath));
        if (dir !== undefined)
            return dir;
        problems.push(`${PACKAGE_SERVICE}.packageOf named no directory for ${SHIPPED_PRESET_PACKAGE}`);
    }
    else if (problems.length === 0) {
        problems.push(packages === undefined ? `${PACKAGE_SERVICE} is not mounted` : `${PACKAGE_SERVICE}.packageOf found no ${SHIPPED_PRESET_PACKAGE}`);
    }
    try {
        return dirname(createRequire(parent).resolve(`${SHIPPED_PRESET_PACKAGE}/package.json`));
    }
    catch (error) {
        problems.push(`the module resolve could not resolve ${SHIPPED_PRESET_PACKAGE}/package.json: ${messageOf(error)}`);
    }
    throw new Error(`dsh-bash-native: cannot locate ${SHIPPED_PRESET_PACKAGE}, which carries the shipped preset this bundle follows, from ${parent}: ${problems.join('; ')}`);
}
/**
 * Every row the patch file inserts, in file order.
 * @param document - the parsed patch file.
 * @param at - the path to name in a diagnostic.
 * @returns the inserted rows, as parsed mappings.
 * @throws when the file is not a list of patch entries, or inserts nothing.
 */
function insertedRows(document, at) {
    if (!Array.isArray(document)) {
        throw new Error(`dsh-bash-native: the shipped preset at ${at} is not a list of patch entries`);
    }
    const rows = [];
    for (const entry of document) {
        if (!isRecord(entry) || !Array.isArray(entry.insert))
            continue;
        for (const row of entry.insert)
            if (isRecord(row))
                rows.push(row);
    }
    if (rows.length === 0)
        throw new Error(`dsh-bash-native: the shipped preset at ${at} inserts no row`);
    return rows;
}
/**
 * Whether a parsed value is a mapping.
 * @param value - the value to inspect.
 * @returns whether it is a non-null, non-array object.
 */
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * @param error - a failed step. @returns its message, for one diagnostic line.
 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
