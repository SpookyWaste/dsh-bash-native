/**
 * Reports — and with `--yes`, removes — the per-user caches an upgrade leaves behind.
 *
 * The classification lives in `lib/state.js` (`src/state.ts`), because the executor runs the same pass at
 * run time: it deletes a superseded cache directory only when none of its bytes are shared with a name
 * outside it, so an installed package or another live cache keeps its own files. This script is the wider
 * tool: it also reports what the automatic pass leaves alone, and it can delete the source-built toolchain or
 * the development leftovers when the operator says so.
 *
 * Usage:
 *   node bin/clean-state.mjs                 report; change nothing
 *   node bin/clean-state.mjs --yes           delete every superseded cache directory
 *   node bin/clean-state.mjs --dir=DIR       use another per-user directory
 *   node bin/clean-state.mjs --json          machine-readable report
 *   node bin/clean-state.mjs --tools         also delete the source-built toolchain under tools/
 *   node bin/clean-state.mjs --dev           also delete the development leftovers
 *
 * Run it with DSH stopped: a running shell may still be executing a program from the directory being removed.
 * @module dsh-bash-native/bin/clean-state
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { currentDigests, defaultStateRoot, formatBytes, formatReport, inspectState, removable, removeEntries } from '../lib/state.js'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Read `--name=value` and `--name` flags out of argv. */
function parseArgs(argv) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
  return {
    dir: value('dir'),
    yes: argv.includes('--yes'),
    json: argv.includes('--json'),
    tools: argv.includes('--tools'),
    dev: argv.includes('--dev'),
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(process.argv.slice(2))
  const root = args.dir !== undefined && args.dir.length > 0 ? args.dir : defaultStateRoot(process.env)
  if (root.length === 0) {
    console.error('LOCALAPPDATA is not set, so the per-user state directory cannot be derived (pass --dir=DIR)')
    process.exit(2)
  }
  const digests = currentDigests(PACKAGE_ROOT)
  const report = inspectState({ root, engine: digests.engine, toolchain: digests.toolchain })
  if (args.json) {
    console.log(JSON.stringify(report, null, 2))
    process.exit(0)
  }
  console.log(formatReport(report))
  if (!args.yes) process.exit(0)
  if (digests.engine === null || digests.toolchain === null) {
    console.error('refusing to delete: this package could not name the engine and toolchain caches it uses')
    process.exit(2)
  }
  const doomed = removable(report.entries, { superseded: true, tools: args.tools, dev: args.dev })
  const { removed, bytes } = removeEntries(doomed)
  console.log(`removed ${removed} entr${removed === 1 ? 'y' : 'ies'} (${formatBytes(bytes)}); the next resolution recreates what it needs`)
}