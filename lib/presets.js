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
import { PRESET_IDS, capabilityPackages, composePreset, configRequirements, gatePackages, probePackages } from './preset-data.js';
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
 * The loader's import loads the module, so a *missing dependency* inside it reports the same codes and
 * would read as this package being absent. TODO: tell the two apart by requiring the message to name
 * the specifier — measured to work on Node 24 for both a missing package and a missing dependency —
 * once the same check is measured on every Node line this bundle supports (>= 22.12).
 */
const ABSENT_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND']);
/**
 * Ask the host the facts one composition is built from: which packages a row could mount here, and
 * which fields the probed modules' own exported `Config` schemas declare.
 *
 * Every package is looked up with the call the Loader tree itself makes for a row naming it, and a
 * capability question is answered from the module's exported `Config` — the declaration its row's
 * config is validated against when it mounts. Names or versions cannot answer it: the reminder-tool
 * package still ships on 0.2.1-alpha.3 while `toolFilter` was removed from the subagent, and
 * `dsh-tool-fs` still ships while its `read`/`readImage`/`write`/`edit` toggles were added there.
 *
 * A lookup that fails because the package is absent reads as an absence; any other failure is a broken
 * package and propagates. The exception is a package listed in `capabilities`, which is probed only for
 * its config: a failure or an unreadable field map there answers `null` with a warning, because leaving
 * the dependent rows out cannot break a mount while writing them against an unproven declaration can.
 * @param ctx - this entry's context, for the Loader service.
 * @param base - the registry entry's base URL, when it exposes one.
 * @param specifiers - the packages to look for.
 * @param capabilities - which specifiers are read for their exported config and degrade on failure.
 * @returns what this host can mount, and the config field map each probed module declared.
 * @throws when a row-gate lookup fails for any reason other than a missing package.
 */
export async function probeHostFacts(ctx, base, specifiers, capabilities) {
    const packages = new Set();
    const configs = new Map();
    for (const specifier of specifiers) {
        let imported;
        try {
            imported = await importFromHost(ctx, base, specifier);
        }
        catch (error) {
            if (!capabilities.has(specifier))
                throw error;
            configs.set(specifier, null);
            ctx.logger.warn(`dsh-bash-native: could not import ${specifier} to read its config (${messageOf(error)}); host-dependent rows that need its fields are left out`);
            continue;
        }
        if (imported === null)
            continue;
        packages.add(specifier);
        if (imported.namespace != null) {
            const fields = configFieldsOf(imported.namespace);
            configs.set(specifier, fields);
            if (fields === null && capabilities.has(specifier)) {
                ctx.logger.warn(`dsh-bash-native: ${specifier} exposes no readable Config field map; host-dependent rows that need its fields are left out`);
            }
        }
        else if (capabilities.has(specifier)) {
            configs.set(specifier, null);
            ctx.logger.warn(`dsh-bash-native: ${specifier} could only be resolved, not loaded; host-dependent rows that need its fields are left out`);
        }
    }
    return { packages, configs };
}
/**
 * Look one package up with the call the Loader tree would make for a row naming it.
 *
 * A Loader without internals falls back to a synchronous package resolve from the same base, and a
 * caller with no base at all falls back to this module's own base: that answer can say the package is
 * there, but it did not load it, so a capability read from the namespace is not available.
 * @param ctx - this entry's context, for the Loader service.
 * @param base - the base URL a registered preset's rows resolve against.
 * @param specifier - the package to look for.
 * @returns the loaded namespace, a resolve-only answer, or null when the package is absent.
 * @throws when the lookup fails for any reason other than a missing package.
 */
async function importFromHost(ctx, base, specifier) {
    const internals = ctx.loader?.internal;
    try {
        if (internals !== undefined && base !== undefined) {
            return { namespace: await internals.import(specifier, base, {}) };
        }
        createRequire(base ?? import.meta.url).resolve(specifier);
        return { namespace: null };
    }
    catch (error) {
        const code = error.code;
        if (code !== undefined && ABSENT_CODES.has(code))
            return null;
        throw error;
    }
}
/**
 * Read the field map of a module's exported `Config` schema.
 *
 * A module that exposes no `Config`, or a `Config` whose `dict` is not a plain field map, answers
 * `null`: the caller has to compose the safe direction, never guess that a field is declared. That is
 * also the answer to anything the read throws — a getter or a proxy — so an unreadable declaration
 * cannot take the registration entry down.
 * @param namespace - the module namespace the loader's import returned.
 * @returns the `Config` field names, or null when they cannot be read.
 */
function configFieldsOf(namespace) {
    try {
        const config = namespace.Config;
        const dict = config?.dict;
        if (dict === null || typeof dict !== 'object' || Array.isArray(dict) || dict instanceof Map || dict instanceof Set)
            return null;
        // Own enumerable keys only: a field on the dict's prototype was not declared by the schema.
        return new Set(Object.keys(dict));
    }
    catch (error) {
        // The dependent rows are optional, so an unreadable declaration composes the side that cannot
        // break a mount; `probeHostFacts` reports the null answer as a warning, so nothing is silent.
        void error;
        return null;
    }
}
/**
 * @param error - a failed lookup. @returns its message, for one warning line.
 */
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
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
    const probed = [...new Set(config.presets.flatMap((id) => probePackages(id)))];
    const capabilities = new Set(config.presets.flatMap((id) => capabilityPackages(id)));
    const facts = await probeHostFacts(ctx, registry.ctx?.baseUrl, probed, capabilities);
    const registered = [];
    let disposed = false;
    ctx.effect(() => () => {
        disposed = true;
        for (const unregister of registered)
            void unregister();
    }, 'dsh-bash-native: agent preset registrations');
    for (const id of config.presets) {
        const definition = composePreset(id, facts);
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
        ctx.logger.info(`dsh-bash-native: preset '${id}' registered (${describeShape(definition, id, facts)})`);
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
 * @param facts - the host facts the composition was built from.
 * @returns the row count, the host-dependent rows, and the config verdicts behind them.
 */
function describeShape(definition, id, facts) {
    const parts = [];
    const gates = gatePackages(id);
    if (gates.length > 0) {
        const carried = gates.filter((gate) => facts.packages.has(gate));
        const dropped = gates.filter((gate) => !facts.packages.has(gate));
        parts.push(`host rows ${carried.length === 0 ? 'none' : carried.join(', ')}`);
        if (dropped.length > 0)
            parts.push(`not shipped by this harness: ${dropped.join(', ')}`);
    }
    const requirements = configRequirements(id);
    if (requirements.length > 0) {
        const verdicts = [...new Set(requirements.map((requirement) => requirement.package))].map((pkg) => {
            const fields = facts.configs.get(pkg);
            const needed = [...new Set(requirements.filter((requirement) => requirement.package === pkg).flatMap((requirement) => requirement.fields))];
            const verdict = fields == null ? 'unknown' : needed.every((field) => fields.has(field)) ? 'declared' : 'missing';
            return `${pkg}.{${needed.join(',')}}=${verdict}`;
        });
        parts.push(`config fields ${verdicts.join('; ')}`);
    }
    return parts.length === 0 ? `${definition.plugins.length} rows; no host-dependent rows` : `${definition.plugins.length} rows; ${parts.join('; ')}`;
}
