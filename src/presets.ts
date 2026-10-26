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

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { PRESET_IDS, SHELL_GROUP_IDS, SHIPPED_SOURCES, composePreset } from './preset-data.js'
import type { PresetDefinition, PresetId, ShippedPreset } from './preset-data.js'
import { isSupportedPlatform, readShippedPreset } from './preset-source.js'

/** Plugin name, as the Loader tree and its diagnostics show it. */
export const name = 'bash-native-presets'

/** The registry service this entry registers with. */
export const inject = ['agentPresets']

/** Registration switches of this entry. */
export interface Config {
  /** Which of `PRESET_IDS` to register. A session pins a preset id, so an id left out here serves no new session. */
  presets: PresetId[]
}

export const Config: Schema<Config> = Schema.object({
  presets: Schema.array(Schema.union([...PRESET_IDS])).default([...PRESET_IDS]),
})

/**
 * The slice of the agent-preset registry this entry uses.
 *
 * Declared structurally because the registry is a peer of this bundle rather than a dependency it
 * installs: this module must stay importable wherever the bundle is, including on the older end of the
 * harness window. The method named here is the registry's documented one; `ctx` is the public context
 * a Cordis service carries, and its base URL is the one a registered preset's rows resolve against.
 */
interface PresetRegistry {
  /** Register and eagerly mount a definition; resolves to the disposer that retires it again. */
  register(definition: PresetDefinition): Promise<() => Promise<void>>
  /** The registry entry's own context. */
  readonly ctx?: { readonly baseUrl?: string }
}

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
export async function apply(ctx: Context, config: Config): Promise<void> {
  return registerPresets(ctx, config, process.platform)
}

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
export async function registerPresets(ctx: Context, config: Config, platform: string): Promise<void> {
  if (!isSupportedPlatform(platform)) {
    // The presets advertise a shell this bundle can only serve on Windows: its executor resolves the
    // Windows rubash build it ships and contributes no candidate anywhere else, so registering them would
    // hand every new session a preset whose bash cannot start.
    ctx.logger.warn(
      `dsh-bash-native: not registering the agent presets: this bundle drives the Windows rubash engine and platform '${platform}' is not supported`,
    )
    return
  }
  const registry = (ctx as unknown as { agentPresets: PresetRegistry }).agentPresets
  const registered: Array<() => Promise<void>> = []
  let disposed = false
  ctx.effect(
    () => () => {
      disposed = true
      for (const unregister of registered) void unregister()
    },
    'dsh-bash-native: agent preset registrations',
  )

  for (const id of config.presets) {
    const shipped = await readShippedPreset(ctx, registry.ctx?.baseUrl, SHIPPED_SOURCES[id])
    const definition = composePreset(id, shipped)
    let unregister: () => Promise<void>
    try {
      unregister = await registry.register(definition)
    } catch (error) {
      if (!takenByEarlierRegistration(error, id)) throw error
      // An app that was upgraded in place still has the previous version's preset declaration mounted:
      // a bundle's layers are read when the process starts, so removing the old package does not unmount
      // its rows, and enabling this one in the same process collides on the id. The registry exposes no
      // handle on another plugin's registration, so the definition cannot be replaced from here — and the
      // id is served either way, by the older composition, until the app restarts. Failing this entry
      // would turn a normal upgrade into "1 entry did not activate" with no way forward but the same
      // restart, so it is reported as the artifact it is.
      ctx.logger.warn(
        `dsh-bash-native: preset '${id}' is already registered in this process — an older copy of this plugin is still mounted, so this app keeps that copy's composition until it restarts`,
      )
      continue
    }
    // The activation can be disposed while a definition is still mounting; leaving that one behind
    // would keep a preset in the roster that nothing owns.
    if (disposed) {
      await unregister()
      continue
    }
    registered.push(unregister)
    ctx.logger.info(`dsh-bash-native: preset '${id}' registered (${describeRegistration(id, definition, shipped)})`)
  }
}

/**
 * Describe what one registration carried, so a boot log answers "which composition did this host get".
 * @param id - which preset was registered.
 * @param definition - the definition that was registered.
 * @param shipped - the shipped composition it was built from.
 * @returns the row count, what was carried, what was replaced, and the file it came from.
 */
function describeRegistration(id: PresetId, definition: PresetDefinition, shipped: ShippedPreset): string {
  const source = SHIPPED_SOURCES[id]
  // The replaced surface is always exactly one row of the composed list — this bundle's realm group — so
  // counting the rows beside it is the carried count whatever shape the shipped file spells the surface in.
  const carried = definition.plugins.length - 1
  return [
    `${definition.plugins.length} rows`,
    `${carried} carried from ${source.file}.patch.yml`,
    `${source.replaced.join(' + ')} replaced by ${SHELL_GROUP_IDS[id]}`,
    shipped.path,
  ].join('; ')
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
function takenByEarlierRegistration(error: unknown, id: string): boolean {
  return error instanceof Error && error.message === `Duplicate agent preset: ${id}`
}