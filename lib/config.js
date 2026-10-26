/**
 * Validated configuration for the `dsh-bash-native` executor.
 *
 * The execution budgets are inherited from `@deepseek-ai/dsh-bash-local` by reuse of its exact
 * field schemas, so their defaults and caps keep exactly one home; this module adds only the
 * engine-selection and composition switches. The inheritance goes through
 * `LocalBashExecutor.Config.dict` rather than `Schema.intersect` because schemastery rejects a
 * volatile field nested under an intersection (`volatile fields require a fixed object path`),
 * and the inherited budgets are volatile by design so a settings write reaches a live instance.
 * @module dsh-bash-native/config
 */
import Schema from '@deepseek-ai/schemastery';
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local';
/**
 * The inherited budget schemas, reused verbatim so their defaults, caps and volatile markers
 * cannot drift from `dsh-bash-local`.
 */
const inheritedBudgets = LocalBashExecutor.Config.dict;
if (inheritedBudgets === undefined) {
    throw new Error('dsh-bash-native: @deepseek-ai/dsh-bash-local exposes no Config field dict, so the execution budgets cannot be inherited; ' +
        'redeclare the six budget fields in this schema instead of silently loading without them.');
}
/** Validated configuration schema: the inherited bash budgets plus this executor's switches. */
export const Config = Schema.object({
    ...inheritedBudgets,
    bashPath: Schema.string().default(''),
    bundledEngineDir: Schema.string().default(''),
    confine: Schema.boolean().default(true),
    requireEngineOnLoad: Schema.boolean().default(false),
    promptSection: Schema.boolean().default(true),
    promptDetail: Schema.union(['full', 'minimal']).default('full'),
    toolsDir: Schema.string().default(''),
    rcFile: Schema.string().default(''),
    denialSignatureAdditions: Schema.array(Schema.string()).default(['os error 5']),
    shellEnvOverrides: Schema.dict(Schema.string()).default({}),
    verifyArtifacts: Schema.union(['stamped', 'always']).default('stamped'),
});
