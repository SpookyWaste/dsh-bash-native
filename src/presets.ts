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

import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { PRESET_IDS, SUBAGENT_PACKAGE, capabilityPackages, composePreset, gatePackages } from './preset-data.js'
import type { HostFacts, PresetDefinition, PresetId, ToolFilterSupport } from './preset-data.js'

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

/** The Loader's internal import, the same call the tree makes for every row it mounts. */
interface LoaderInternals {
  import(specifier: string, parentURL: string, attributes: Record<string, never>): Promise<unknown>
}

/**
 * Resolution failures that mean this host does not ship the package, as opposed to a broken one.
 *
 * `ERR_MODULE_NOT_FOUND` is the import path's answer, `MODULE_NOT_FOUND` the fallback resolve's, and
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` an installed package that does not expose the subpath a row names.
 * Only a resolution can produce them here: the fallback resolves without loading anything, so a
 * missing dependency of the probed package cannot be mistaken for the package itself being absent.
 */
const ABSENT_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'])

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
export async function probeHostFacts(ctx: Context, base: string | undefined, specifiers: readonly string[]): Promise<HostFacts> {
  const packages = new Set<string>()
  let subagentToolFilter: ToolFilterSupport = 'unknown'
  for (const specifier of specifiers) {
    let imported: HostImport | null
    try {
      imported = await importFromHost(ctx, base, specifier)
    } catch (error) {
      if (specifier !== SUBAGENT_PACKAGE) throw error
      ctx.logger.warn(
        `dsh-bash-native: could not read ${SUBAGENT_PACKAGE}'s config (${messageOf(error)}); the reminder-tool denial is left out`,
      )
      continue
    }
    if (imported === null) continue
    packages.add(specifier)
    if (specifier === SUBAGENT_PACKAGE && imported.namespace !== null) {
      subagentToolFilter = toolFilterSupportOf(imported.namespace)
    }
  }
  return { packages, subagentToolFilter }
}

/** One package's answer from the host: its module namespace, or null when only its resolution was checked. */
interface HostImport {
  readonly namespace: unknown | null
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
async function importFromHost(ctx: Context, base: string | undefined, specifier: string): Promise<HostImport | null> {
  const internals = (ctx as unknown as { loader?: { internal?: LoaderInternals } }).loader?.internal
  try {
    if (internals !== undefined && base !== undefined) {
      return { namespace: await internals.import(specifier, base, {}) }
    }
    createRequire(base ?? import.meta.url).resolve(specifier)
    return { namespace: null }
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== undefined && ABSENT_CODES.has(code)) return null
    throw error
  }
}

/**
 * Read the subagent module's own config declaration for the field the denial needs.
 * @param namespace - the module namespace the loader's import returned.
 * @returns whether the exported `Config` schema declares `toolFilter`, or `unknown` when it exposes no
 *   readable field map — a shape this probe does not recognize must never write the field.
 */
function toolFilterSupportOf(namespace: unknown): ToolFilterSupport {
  const config = (namespace as { readonly Config?: { readonly dict?: unknown } }).Config
  const dict = config?.dict
  if (dict === null || dict === undefined || typeof dict !== 'object') return 'unknown'
  return 'toolFilter' in dict ? 'supported' : 'rejected'
}

/**
 * @param error - a failed lookup. @returns its message, for one warning line.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
export async function apply(ctx: Context, config: Config): Promise<void> {
  const registry = (ctx as unknown as { agentPresets: PresetRegistry }).agentPresets
  const facts = await probeHostFacts(
    ctx,
    registry.ctx?.baseUrl,
    [...new Set(config.presets.flatMap((id) => [...gatePackages(id), ...capabilityPackages(id)]))],
  )

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
    const definition = composePreset(id, facts)
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
    ctx.logger.info(`dsh-bash-native: preset '${id}' registered (${describeShape(definition, id, facts)})`)
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
function takenByEarlierRegistration(error: unknown, id: string): boolean {
  return error instanceof Error && error.message === `Duplicate agent preset: ${id}`
}

/**
 * Describe what one registration carried, so a boot log answers "did this host get the reminder tools".
 * @param definition - the definition that was registered.
 * @param id - which preset it is.
 * @param facts - the host facts the composition was built from.
 * @returns the row count, the host-dependent rows, and the subagent config verdict.
 */
function describeShape(definition: PresetDefinition, id: PresetId, facts: HostFacts): string {
  const gates = gatePackages(id)
  if (gates.length === 0) return `${definition.plugins.length} rows; no host-dependent rows`
  const carried = gates.filter((gate) => facts.packages.has(gate))
  const dropped = gates.filter((gate) => !facts.packages.has(gate))
  const shape = `${definition.plugins.length} rows; host rows ${carried.length === 0 ? 'none' : carried.join(', ')}`
  const tail = dropped.length === 0 ? shape : `${shape}; not shipped by this harness: ${dropped.join(', ')}`
  return capabilityPackages(id).length === 0 ? tail : `${tail}; subagent config toolFilter: ${facts.subagentToolFilter}`
}