/**
 * The registration entry: it contributes this bundle's two agent presets to the harness's registry.
 *
 * A bundle patch cannot carry a preset body any more. A preset row's modules are resolved against the
 * base of the Loader entry that declares the row, so rows declared by this bundle's patch resolve from
 * this package's directory inside the profile — which sees the profile's dependency tree and nothing
 * else — while `register()` mounts a definition with the registry entry's own base inside the harness
 * installation. That second base is the one that sees the harness's own packages, and it is what lets
 * one published composition follow the harness line it is installed on instead of failing the mount
 * audit on every row at once.
 *
 * The composition itself is not this bundle's copy of a preset: `./preset-source.ts` reads the shipped
 * `standard`/`minimal` preset of the installation the registry lives in, and `./preset-data.ts` replaces
 * only its shell surface. That is what makes a released package equal to the preset its host ships —
 * every other row, and every platform branch the shipped file carries, arrives from that file — instead
 * of a mirror that has to be re-cut for every upstream release.
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
 * Register this bundle's presets, each one composed from the shipped preset of the host's own harness line.
 *
 * Registration failures propagate: a shipped preset this host does not carry, a file whose shell surface
 * has been reshaped, or a definition the registry rejects outright are all conditions the deployment has
 * to see, and the alternative — losing both presets silently, or mounting one whose shell cannot start —
 * is worse than a failed entry. The one failure that is *not* a misconfiguration is a taken id, which an
 * upgrade in place produces on purpose: see `takenByEarlierRegistration` below.
 * @param ctx - the entry's context; `agentPresets` is present by `inject`.
 * @param config - which presets to register.
 * @throws when a shipped preset cannot be read as the composition it must be, or the registry rejects it.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
/**
 * Register this bundle's presets for one platform.
 *
 * The platform is a parameter for the same reason it is one in `./resolve.ts`: the shipped engine exists
 * on exactly one of them, and what the entry does elsewhere is a contract worth asking about without
 * being on it. `apply` passes the running process's own.
 * @param ctx - the entry's context; `agentPresets` is present by `inject`.
 * @param config - which presets to register.
 * @param platform - the platform to serve, normally `process.platform`.
 * @throws when a shipped preset cannot be read as the composition it must be, or the registry rejects it.
 */
export declare function registerPresets(ctx: Context, config: Config, platform: string): Promise<void>;
