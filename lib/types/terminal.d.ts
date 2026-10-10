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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
/** Plugin name, as the Loader tree and its diagnostics show it. */
export declare const name = "bash-native-terminal";
/** Registration switches of this component. */
export interface Config {
    /**
     * Whether one `terminal_send` may be handed off to a background job and collected later.
     *
     * On by default, matching the shipped tool package: a long build or a server started in a terminal is
     * the case the interactive surface exists for, and without this the model can only wait it out.
     */
    runInBackground: boolean;
}
export declare const Config: Schema<Config>;
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
export declare function apply(ctx: Context, config: Config): Promise<void>;
