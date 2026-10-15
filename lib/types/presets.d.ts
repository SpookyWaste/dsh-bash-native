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
import type { HostFacts, PresetId } from './preset-data.js';
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
 * Ask the host the facts one composition is built from: which packages a row could mount here, and
 * whether its subagent tool still understands the reminder-tool denial's field.
 *
 * Every package is looked up with the call the Loader tree itself makes for a row naming it, and the
 * subagent question is answered from the `Config` schema the module exports — the declaration a row's
 * config is validated against when it mounts. A package name or a version cannot answer it: the
 * reminder-tool package still ships on 0.2.1-alpha.3 while `toolFilter` was removed from the subagent.
 *
 * A lookup that fails because the package is absent reads as an absence. Any other failure is a broken
 * package and propagates, except for the subagent module: there the denial is left out on an unreadable
 * config, which cannot break a mount, so it is reported as `unknown` with a warning instead.
 * @param ctx - this entry's context, for the Loader service.
 * @param base - the registry entry's base URL, when it exposes one.
 * @param specifiers - the packages to look for.
 * @returns what this host can mount and which subagent config generation it speaks.
 * @throws when a row-gate lookup fails for any reason other than a missing package.
 */
export declare function probeHostFacts(ctx: Context, base: string | undefined, specifiers: readonly string[]): Promise<HostFacts>;
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
