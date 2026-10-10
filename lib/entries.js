/**
 * Entry-level building blocks shared by the two things this bundle contributes: the agent presets and
 * the interactive terminal component.
 *
 * Both compose Cordis children, and both need the same two primitives to do it — a URL that names this
 * package's own entry from wherever the package happens to sit, and a deferred configuration
 * expression. They live here rather than in either composition so the two cannot drift apart, because a
 * drift would show up as one of them silently reading nothing from `ctx.shell`.
 * @module dsh-bash-native/entries
 */
/**
 * This bundle's own entry, as a URL resolved at run time.
 *
 * No harness installation carries this package, so a row or a child that has to reach it cannot name it
 * by package. A URL is resolved by URL rules instead of by a `node_modules` lookup and is computed from
 * this module's own location, so it is correct for a profile install, a linked checkout, and a global
 * install alike. `./index.js` is the package's own entry point.
 */
export const SELF_ENTRY = new URL('./index.js', import.meta.url).href;
/**
 * A `!!js` expression node, the value the YAML tag produces.
 *
 * The Loader recognizes one by the `__jsExpr` key alone (`isJsExpr`), evaluates it against the entry's
 * context in the same `with (ctx)` scope the YAML form gets, and leaves the raw node in the options so
 * write-back keeps the form. Declaring a row or a child this way therefore keeps exactly the semantics
 * the patch file had, including the deferral that lets an injected service resolve first.
 * @param expression - the expression source the Loader evaluates.
 * @returns the node the Loader interpolates.
 */
export const jsExpr = (expression) => ({ __jsExpr: expression });
/**
 * Evaluate one `!!js` expression against a context.
 *
 * Not exported for reuse by a Loader row: rows get this from the Loader itself, in exactly this form.
 * It exists here because a child mounted programmatically through `ctx.plugin` does not pass through the
 * Loader's interpolation, so a composition that builds its own children has to apply the same step or
 * its deferred expressions arrive as `{ __jsExpr }` objects and fail the child's own validator.
 * @param ctx - the context the expression's scope reads services from.
 * @param expression - the expression source.
 * @returns the expression's value.
 */
export function evaluateExpression(ctx, expression) {
    return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(ctx, expression);
}
/**
 * Replace every `!!js` node in a value tree, the way the Loader does before mounting a row.
 * @param ctx - the context the expressions' scope reads services from.
 * @param value - a configuration value, possibly containing expression nodes at any depth.
 * @returns the value with every expression replaced by its result.
 */
export function interpolate(ctx, value) {
    if (isJsExpr(value))
        return evaluateExpression(ctx, value.__jsExpr);
    if (!value || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map((item) => interpolate(ctx, item));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(ctx, item)]));
}
/**
 * Whether a value is a deferred `!!js` node.
 * @param value - the value to inspect.
 * @returns whether it carries the `__jsExpr` key the Loader recognizes.
 */
function isJsExpr(value) {
    return typeof value === 'object' && value !== null && '__jsExpr' in value;
}
/**
 * The six tool names the harness's terminal tool package registers, which the interactive terminal
 * component mounts.
 *
 * Pinned here so a rename on the harness side is reported as a drift alarm rather than reaching a
 * session as a missing capability. Nothing reads this at run time; `test-terminal-component.mjs`
 * compares it against the names the mounted runtime actually accepted, because that package exports no
 * name list of its own.
 */
export const TERMINAL_TOOL_NAMES = [
    'terminal_open',
    'terminal_send',
    'terminal_read',
    'terminal_signal',
    'terminal_close',
    'terminal_list',
];
