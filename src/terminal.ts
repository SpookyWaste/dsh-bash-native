/**
 * The interactive persistent-terminal component for `dsh-bash-native`.
 *
 * One Loader entry, independently switchable from the presets entry beside it in
 * `cordis.patch.yml`, that contributes the six model-facing `terminal_*` tools over this bundle's own
 * brush engine. It is deliberately not a preset: a preset's rows belong to the realm its own group
 * declares, and the registry exposes no way to amend a registered definition (`register` refuses a
 * duplicate id and `recompose` re-mounts the same rows), so a separately switchable component cannot
 * add rows to one. Instead this component is a composition in its own right, mounted on the host plane
 * exactly like the harness's own `@deepseek-ai/dsh-experimental-terminal-bundle` — and it is mutually
 * exclusive with that bundle, because both register the same six tool names globally.
 *
 * The `shell` isolate is what keeps that self-containment harmless. Every composition that already
 * provides `ctx.shell` — the shipped presets, and this bundle's own presets — also isolates it, so a
 * second provider on the host plane neither displaces nor is displaced by any of them. Everything the
 * children need from the host plane (`sandboxPolicy`, `subprocess`, `workingDirectory`, `tools`,
 * `jobs`) is inherited from the root scope, because only `shell` is named in the isolate list.
 *
 * Only `shellDialect` is written into the backend's configuration. `shellPath` and `shellArgs` are
 * deferred expressions that read this component's own executor, which is the arrangement the presets
 * use and the reason no engine path ever has to be written down. The remaining backend budgets keep
 * their schema defaults: a value restated here would be a second home for it, and a harness release
 * that raised one would silently stop reaching this component.
 * @module dsh-bash-native/terminal
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { SELF_ENTRY, interpolate, jsExpr } from './entries.js'

/** Plugin name, as the Loader tree and its diagnostics show it. */
export const name = 'bash-native-terminal'

/** The executor configuration the presets also use: confined, and verified before the plane serves a shell. */
const EXECUTOR_CONFIG = { confine: true, requireEngineOnLoad: true } as const

/** How long one terminal send may wait for readiness before it settles as a timeout. */
const SEND_TIMEOUT_MS = 300_000

/** The backend type the terminal tools open, matching the presets' choice. */
const BACKEND_TYPE = 'shell'

/**
 * The `shell` isolate this component's children share.
 *
 * A fresh namespace rather than a shared label: this component must not join another composition's
 * realm, because joining one would make its executor displace that composition's. Nothing outside the
 * component reads this `shell` — the six tools reach it only through the backend row below.
 */
const SHELL_SCOPE = Symbol('bash-native-terminal')

/** One child to mount, in activation order: the engine first, then what reads it. */
interface Child {
  /** The harness package, or this package's own entry. */
  readonly name: string
  /** The child's configuration. */
  readonly config?: unknown
}

/**
 * The child composition, in the order it has to come up.
 *
 * The executor precedes everything because the backend's `shellPath` expression reads it; the backend
 * precedes the tools because the tools open sessions through the registry the middle row provides.
 * `@deepseek-ai/dsh-tool-terminal` is named rather than reimplemented: its six tools, their schemas,
 * their result rendering and their background-job handling are the harness's, and this component's
 * only contribution is the engine underneath them.
 */
const CHILDREN: readonly Child[] = [
  { name: SELF_ENTRY, config: EXECUTOR_CONFIG },
  { name: '@deepseek-ai/dsh-terminal' },
  {
    name: '@deepseek-ai/dsh-terminal-bash',
    config: {
      backendType: BACKEND_TYPE,
      shellDialect: 'bash',
      shellPath: jsExpr("ctx.get('shell')?.enginePath ?? ''"),
      shellArgs: jsExpr("ctx.get('shell')?.engineArgs ?? []"),
      timeoutMs: SEND_TIMEOUT_MS,
    },
  },
  { name: '@deepseek-ai/dsh-tool-terminal', config: { enableRunInBackground: true } },
]

/** Registration switches of this component. */
export interface Config {
  /**
   * Whether one `terminal_send` may be handed off to a background job and collected later.
   *
   * On by default, matching the shipped tool package: a long build or a server started in a terminal is
   * the case the interactive surface exists for, and without this the model can only wait it out.
   */
  runInBackground: boolean
}

export const Config: Schema<Config> = Schema.object({
  runInBackground: Schema.boolean().default(true),
})

/** One mounted child, held only for the cleanup the component's own disposal runs. */
interface MountedChild {
  /** Unload the child and everything it registered. */
  dispose(): Promise<void>
}

/**
 * Mount the component's children under one isolated `shell` scope.
 *
 * The children are mounted through `ctx.plugin` rather than declared as Loader rows because a
 * component's child rows cannot be reached by the plugin controls: `listPlugins` skips rows marked
 * `group: true`, so the switchable unit has to be this one entry.
 *
 * Mounting is transactional against the switch: every child is awaited, and a failure unloads the ones
 * that already came up rather than leaving a half-mounted component behind. Failing loudly is the
 * contract here — a component the user switched on that silently contributed no tools would present as
 * the model lacking a capability nobody can see the reason for.
 * @param ctx - the entry's host-plane context.
 * @param config - this component's registration switches.
 * @throws when a child cannot be resolved or does not activate.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const scoped = ctx.isolate('shell', SHELL_SCOPE)
  const mounted: MountedChild[] = []
  try {
    for (const child of CHILDREN) {
      const plugin = await importPlugin(child.name)
      const childConfig = child.name === '@deepseek-ai/dsh-tool-terminal' ? { enableRunInBackground: config.runInBackground } : child.config
      // The Loader interpolates a row's `!!js` nodes before mounting it; a programmatic mount skips that
      // step, so it is applied here. It reads the child's own scope, which is what makes the backend's
      // `shellPath` expression resolve against the executor mounted on the iteration before it.
      const fiber = scoped.plugin(plugin as Parameters<typeof scoped.plugin>[0], interpolate(scoped, childConfig))
      await fiber
      mounted.push({ dispose: () => fiber.dispose() })
    }
    ctx.logger.info(`dsh-bash-native: interactive terminal mounted (${CHILDREN.length} children on the ${BACKEND_TYPE} backend)`)
  } catch (error) {
    for (const fiber of mounted.reverse()) await fiber.dispose().catch(() => undefined)
    // A missing harness package is the failure this component actually meets in the field, and the bare
    // module error does not say which capability is unavailable or what to do about it: the tools ship
    // with the harness, so a line that predates them cannot be made to run this component at all.
    if (isMissingModule(error)) {
      throw new Error(
        `dsh-bash-native: the interactive terminal needs the harness packages ${CHILDREN.map((child) => child.name).join(', ')}, ` +
          `and this harness does not ship ${describeMissing(error)}. The tools belong to the harness rather than to this bundle, so ` +
          `this component cannot run on this harness line — update DSH, or leave the component switched off.`,
        { cause: error },
      )
    }
    throw error
  }
  ctx.effect(
    () => () => {
      for (const fiber of mounted.reverse()) void fiber.dispose()
    },
    'dsh-bash-native: interactive terminal children',
  )
}

/**
 * The plugin shape a child module may expose.
 *
 * Declared structurally because the children are imported by name at run time: their own types are not
 * dependencies of this package's compilation, and a Cordis plugin module is either this shape at the
 * top level or the same shape under `default`. The module's own `Config` is carried through to the
 * registry untouched — this interface names only what this component has to look at, because restating
 * a validator's type here would be a second declaration of a contract the child owns.
 */
interface ChildPlugin {
  /** The plugin's own name, as diagnostics show it. */
  readonly name?: string
  /** The plugin body. */
  readonly apply: (...args: never[]) => unknown
}

/**
 * The plugin object a child row names, imported at mount time.
 *
 * Deferred rather than a top-level import so this component stays loadable on a host that ships none of
 * these packages: the switch being off must not make the whole bundle fail to load, and a host without
 * them reports the missing package by name instead of failing inside this module's import graph.
 * @param specifier - the package or entry URL the child names.
 * @returns the module's plugin shape.
 * @throws when the module exposes no `apply`, which means it is not a Cordis plugin at all.
 */
async function importPlugin(specifier: string): Promise<ChildPlugin> {
  const module = (await import(specifier)) as { default?: unknown; apply?: unknown }
  const candidate = (typeof module.apply === 'function' ? module : module.default) as ChildPlugin | undefined
  if (candidate === undefined || typeof candidate.apply !== 'function') {
    throw new Error(`dsh-bash-native: "${specifier}" is not a Cordis plugin (it exports no apply function)`)
  }
  return candidate
}

/**
 * Whether a failure is Node reporting that a module could not be resolved at all.
 *
 * Both the code and the message are read: the code is exact but does not survive a wrapper that only
 * forwards text, and the wording is what a wrapped rethrow carries.
 * @param error - the failure to inspect.
 * @returns whether it reports an unresolvable package or subpath.
 */
function isMissingModule(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return true
  const message = error instanceof Error ? error.message : ''
  return message.includes('Cannot find package') || message.includes('Cannot find module') || message.includes('is not defined by "exports"')
}

/**
 * Name the package a resolution failure was about, so the message can say what this harness lacks.
 * @param error - the resolution failure.
 * @returns the package or subpath specifier Node reported, or a phrase when none could be read.
 */
function describeMissing(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  const quoted = /Cannot find (?:package|module) '([^']+)'/.exec(message)
  if (quoted !== null) return `"${quoted[1]}"`
  const subpath = /Package subpath '([^']+)' is not defined/.exec(message)
  if (subpath !== null) return `the subpath "${subpath[1]}"`
  return 'one of them'
}
