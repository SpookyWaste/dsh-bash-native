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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { PresetId } from './preset-data.js';
/** Plugin name, as the Loader tree and its diagnostics show it. */
export declare const name = "bash-native-presets";
/** The registry service this entry registers with. */
export declare const inject: string[];
/** Registration switches of this entry. */
export interface Config {
    /** Which of `PRESET_IDS` to register. A session pins a preset id, so an id left out here serves no new session. */
    presets: PresetId[];
}
export declare const Config: Schema<Config>;
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
export declare function probeHostPackages(ctx: Context, base: string | undefined, specifiers: readonly string[]): Promise<Set<string>>;
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
export declare function apply(ctx: Context, config: Config): Promise<void>;
