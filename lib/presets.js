/**
 * The registration entry: it contributes this bundle's two agent presets to the harness's registry.
 *
 * A bundle patch cannot carry a preset body any more. A preset row's modules are resolved against the
 * base of the Loader entry that declares the row, so rows declared by this bundle's patch resolve from
 * this package's directory inside the profile — which sees the profile's dependency tree and nothing
 * else — while `register()` mounts a definition with the registry entry's own base inside the harness
 * installation. That second base is the one that sees the harness's own packages, and it is what lets
 * one published composition follow the harness line it is installed on instead of failing the mount
 * audit on every row at once. Which rows a host can mount is asked here, once per activation, before
 * the definition is built; `./preset-data.ts` owns the rows themselves.
 *
 * The entry is exposed as the `dsh-bash-native/presets` subpath and mounted by one row in
 * `cordis.patch.yml`. It is a separate plugin from the executor because the executor provides
 * `ctx.shell` and belongs inside a preset, while this entry depends on the registry and belongs on the
 * plane that declares presets.
 * @module dsh-bash-native/presets
 */
import { createRequire } from 'node:module';
import Schema from '@deepseek-ai/schemastery';
import { PRESET_IDS, composePreset, gatePackages } from './preset-data.js';
/** Plugin name, as the Loader tree and its diagnostics show it. */
export const name = 'bash-native-presets';
/** The registry service this entry registers with. */
export const inject = ['agentPresets'];
export const Config = Schema.object({
    presets: Schema.array(Schema.union([...PRESET_IDS])).default([...PRESET_IDS]),
});
/**
 * Resolution failures that mean this host does not ship the package, as opposed to a broken one.
 *
 * `ERR_MODULE_NOT_FOUND` is the import path's answer, `MODULE_NOT_FOUND` the fallback resolve's, and
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` an installed package that does not expose the subpath a row names.
 * Only a resolution can produce them here: the fallback resolves without loading anything, so a
 * missing dependency of the probed package cannot be mistaken for the package itself being absent.
 */
const ABSENT_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND']);
/**
 * Ask the host which of these packages are importable from the base a registered preset resolves against.
 *
 * The loader's own import is used, with the registry's base, because that is exactly what mounting the
 * row would do; a resolver of our own would answer a different question (measured: a `createRequire`
 * from any profile directory reports the reminder-tool package absent even on a host that mounts it,
 * because the installation's `node_modules` is not on the profile's search path). The import loads the
 * module, which the mount would do anyway and Node caches.
 *
 * A Loader without internals falls back to a synchronous package resolve from the same base, and a
 * caller with no base at all falls back to this module's own base: the answer is then the conservative
 * one, which is what the patch file's static rows used to give.
 * @param ctx - this entry's context, for the Loader service.
 * @param base - the registry entry's base URL, when it exposes one.
 * @param specifiers - the packages to look for.
 * @returns the subset a row naming it could mount here.
 * @throws when a lookup fails for any reason other than a missing package: an unreadable or broken
 *   package has to surface as a failure rather than as a silent absence.
 */
export async function probeHostPackages(ctx, base, specifiers) {
    const available = new Set();
    for (const specifier of specifiers) {
        if (await canImport(ctx, base, specifier))
            available.add(specifier);
    }
    return available;
}
/**
 * Look one package up with the call the Loader tree would make for a row naming it.
 * @param ctx - this entry's context, for the Loader service.
 * @param base - the base URL a registered preset's rows resolve against.
 * @param specifier - the package to look for.
 * @returns whether a row naming that package would mount on this host.
 * @throws when the lookup fails for any reason other than a missing package.
 */
async function canImport(ctx, base, specifier) {
    const internals = ctx.loader?.internal;
    try {
        if (internals !== undefined && base !== undefined) {
            await internals.import(specifier, base, {});
            return true;
        }
        createRequire(base ?? import.meta.url).resolve(specifier);
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code !== undefined && ABSENT_CODES.has(code))
            return false;
        throw error;
    }
}
/**
 * Register this bundle's presets, reading the host once to decide which optional rows they carry.
 *
 * Registration failures propagate: a definition the registry rejects outright (a composition it cannot
 * parse, a conflict with a definition this entry did not replace) is a misconfiguration, and the
 * deployment needs to see it rather than lose the presets silently. A definition that mounts but fails
 * its audit does not throw here — the registry keeps that visible in its own roster and logs it — so
 * this entry reports the shape it registered and leaves the verdict to the registry. The one failure
 * that is *not* a misconfiguration is a taken id, which an upgrade in place produces on purpose: see
 * `takenByEarlierRegistration` below.
 * @param ctx - the entry's context; `agentPresets` is present by `inject`.
 * @param config - which presets to register.
 */
export async function apply(ctx, config) {
    const registry = ctx.agentPresets;
    const available = await probeHostPackages(ctx, registry.ctx?.baseUrl, [...new Set(config.presets.flatMap((id) => gatePackages(id)))]);
    const registered = [];
    let disposed = false;
    ctx.effect(() => () => {
        disposed = true;
        for (const unregister of registered)
            void unregister();
    }, 'dsh-bash-native: agent preset registrations');
    for (const id of config.presets) {
        const definition = composePreset(id, available);
        let unregister;
        try {
            unregister = await registry.register(definition);
        }
        catch (error) {
            if (!takenByEarlierRegistration(error, id))
                throw error;
            // An app that was upgraded in place still has the previous version's preset declaration mounted:
            // a bundle's layers are read when the process starts, so removing the old package does not unmount
            // its rows, and enabling this one in the same process collides on the id. The registry exposes no
            // handle on another plugin's registration, so the definition cannot be replaced from here — and the
            // id is served either way, by the older composition, until the app restarts. Failing this entry
            // would turn a normal upgrade into "1 entry did not activate" with no way forward but the same
            // restart, so it is reported as the artifact it is.
            ctx.logger.warn(`dsh-bash-native: preset '${id}' is already registered in this process — an older copy of this plugin is still mounted, so this app keeps that copy's composition until it restarts`);
            continue;
        }
        // The activation can be disposed while a definition is still mounting; leaving that one behind
        // would keep a preset in the roster that nothing owns.
        if (disposed) {
            await unregister();
            continue;
        }
        registered.push(unregister);
        ctx.logger.info(`dsh-bash-native: preset '${id}' registered (${describeShape(definition, id, available)})`);
    }
}
/**
 * Whether the registry refused a definition because another registration already holds its id.
 *
 * The registry reports this as a plain `Error` whose message is the only signal — there is no code and no
 * typed error to branch on — so the message is matched in full against this id, which keeps a conflict on
 * a different id from being read as an upgrade artifact. `test-presets.mjs` pins the wording this matches,
 * so a change on the registry side shows up as a failing case rather than as a silent skip.
 * @param error - the rejection from `register`.
 * @param id - the preset id this entry tried to register.
 * @returns whether the id was already taken.
 */
function takenByEarlierRegistration(error, id) {
    return error instanceof Error && error.message === `Duplicate agent preset: ${id}`;
}
/**
 * Describe what one registration carried, so a boot log answers "did this host get the reminder tools".
 * @param definition - the definition that was registered.
 * @param id - which preset it is.
 * @param available - the host packages the probe found.
 * @returns the row count and the host-dependent rows, named by package.
 */
function describeShape(definition, id, available) {
    const gates = gatePackages(id);
    if (gates.length === 0)
        return `${definition.plugins.length} rows; no host-dependent rows`;
    const carried = gates.filter((gate) => available.has(gate));
    const dropped = gates.filter((gate) => !available.has(gate));
    const shape = `${definition.plugins.length} rows; host rows ${carried.length === 0 ? 'none' : carried.join(', ')}`;
    return dropped.length === 0 ? shape : `${shape}; not shipped by this harness: ${dropped.join(', ')}`;
}
