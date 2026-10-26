/**
 * Reports — and with `--yes`, removes — the per-user caches an upgrade leaves behind.
 *
 * The state under `%LOCALAPPDATA%\dsh-bash-native` is content-addressed: one `shim/<engine sha256>` directory
 * per engine build (the `bash`/`sh` names, hard links to the engine when the volume allows it) and one
 * `toolchain/<manifest digest>` directory per packaged toolchain (the materialized programs plus their
 * `bin/` names). An upgrade whose engine or toolchain bytes changed lands in a new directory and leaves the
 * old one behind, which is deliberate at run time: another installed version, or a live process, may still be
 * using the previous directory. Nothing prunes them automatically, so this is the explicit way to do it.
 *
 * Sizes are reported the way `du` reports them: names that share one file (hard links) are counted once, which
 * is why a directory whose listing is 1 GB of applet names can really occupy one 16 MB binary.
 *
 * Everything this script classifies as removable is regenerated from the installed package on the next
 * resolution. The one thing that is not cheap to regenerate is a toolchain built from source under `tools/`
 * (Rust and a long build), which is why it needs its own flag, and why the development leftovers of
 * `scripts/build-engine.mjs` (`build/`, `engine-backup/`, the per-user engine copy) need another.
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

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** A cache directory name: the 64 lowercase hex characters of a sha256 digest. */
const DIGEST_NAME = /^[0-9a-f]{64}$/

/** Subdirectories of the per-user directory whose children are content-addressed caches. */
const CACHE_DIRECTORIES = ['shim', 'toolchain']

/** Development leftovers of `scripts/build-engine.mjs`, none of which an install needs. */
const DEVELOPMENT_ENTRIES = ['build', 'engine-backup', 'rubash.exe']

/** The source-built toolchain directory `scripts/build-toolchain.mjs` writes by default. */
const BUILT_TOOLCHAIN_ENTRY = 'tools'

/**
 * The production filesystem: four reads and one delete, so the classification below is the module's content.
 * `identity` is the hard-link key (`device:inode` on Windows, where Node reports both), which is what makes a
 * hundred applet names count as one binary.
 * @type {{ isDirectory(path: string): boolean, names(path: string): readonly string[] | null, stat(path: string): { bytes: number, file: boolean, identity: string | null } | null, remove(path: string): void }}
 */
export const nodeIo = {
  isDirectory: (path) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  names: (path) => {
    try {
      return readdirSync(path)
    } catch {
      return null
    }
  },
  stat: (path) => {
    try {
      const found = statSync(path)
      if (!found.isFile()) return { bytes: 0, file: false, identity: null }
      return { bytes: found.size, file: true, identity: `${found.dev}:${found.ino}` }
    } catch {
      return null
    }
  },
  remove: (path) => rmSync(path, { recursive: true, force: true }),
}

/**
 * The two digests this package would materialize, which is what makes a cache directory "current".
 *
 * The engine digest comes from the shipped `engine.lock.json`; the toolchain digest is the sha256 of the
 * shipped manifest text, which is exactly how `preparePackagedToolchain` names its cache. Either can be null
 * — an incomplete tree, an unreadable manifest — and then this script refuses to delete anything rather than
 * guessing which directory the running package uses.
 * @param packageRoot - the installed package root.
 * @returns the engine digest and the toolchain digest, null when they cannot be derived.
 */
export function currentDigests(packageRoot) {
  let engine = null
  try {
    const lock = JSON.parse(readFileSync(join(packageRoot, 'engine.lock.json'), 'utf8'))
    const digest = lock?.artifact?.sha256
    if (typeof digest === 'string' && DIGEST_NAME.test(digest)) engine = digest
  } catch {
    // An unreadable lock is reported as "unknown", which turns deletion off in the CLI below.
    engine = null
  }
  let toolchain = null
  try {
    const text = readFileSync(join(packageRoot, 'toolchain', 'win32-x64', 'manifest.json'), 'utf8')
    toolchain = createHash('sha256').update(text, 'utf8').digest('hex')
  } catch {
    toolchain = null
  }
  return { engine, toolchain }
}

/**
 * Sum the bytes one path occupies, counting a file shared through several names once.
 * @param path - a file or directory.
 * @param io - filesystem seam.
 * @param seen - the file identities already counted by this report.
 * @returns its size in bytes.
 */
function directoryBytes(path, io, seen) {
  const found = io.stat(path)
  if (found === null) return 0
  if (found.file) {
    if (found.identity !== null) {
      if (seen.has(found.identity)) return 0
      seen.add(found.identity)
    }
    return found.bytes
  }
  let total = 0
  for (const name of io.names(path) ?? []) total += directoryBytes(join(path, name), io, seen)
  return total
}

/**
 * Classify one cache root's children.
 *
 * A child named by a 64-hex digest is a materialized version: the one this package uses is current, the
 * rest are superseded. Anything else in there was not written by this package's cache layout, so it is
 * reported and left alone. When the current digest is unknown nothing is marked removable.
 * @param root - the per-user directory.
 * @param kind - `shim` or `toolchain`.
 * @param current - the digest this package materializes, or null when unknown.
 * @param io - filesystem seam.
 * @param seen - the file identities already counted by this report.
 * @returns one entry per child.
 */
function cacheEntries(root, kind, current, io, seen) {
  const entries = []
  for (const name of [...(io.names(join(root, kind)) ?? [])].sort()) {
    const path = join(root, kind, name)
    const isVersion = io.isDirectory(path) && DIGEST_NAME.test(name)
    if (!isVersion) {
      entries.push({ kind: 'other', name: `${kind}/${name}`, path, bytes: 0, current: false, removable: null })
      continue
    }
    const isCurrent = current !== null && name === current
    entries.push({
      kind,
      name,
      path,
      bytes: directoryBytes(path, io, seen),
      current: isCurrent,
      removable: current === null || isCurrent ? null : 'superseded',
    })
  }
  return entries
}

/**
 * Classify a top-level entry that is not a cache root.
 * @param path - its absolute path.
 * @param name - its name.
 * @param io - filesystem seam.
 * @param seen - the file identities already counted by this report.
 * @returns the entry, with `removable` naming the flag that would delete it.
 */
function topLevelEntry(path, name, io, seen) {
  const bytes = directoryBytes(path, io, seen)
  if (DEVELOPMENT_ENTRIES.includes(name)) return { kind: 'dev', name, path, bytes, current: false, removable: 'dev' }
  if (name === BUILT_TOOLCHAIN_ENTRY) return { kind: 'tools', name, path, bytes, current: false, removable: 'tools' }
  return { kind: 'other', name, path, bytes, current: false, removable: null }
}

/**
 * Inspect the per-user directory.
 * @param options - `root`, the two digests this package uses, and the filesystem seam.
 * @returns the report: entries, totals, and whether the directory exists at all.
 */
export function inspectState({ root, engine, toolchain, io = nodeIo }) {
  if (!io.isDirectory(root)) {
    return { root, present: false, engine, toolchain, entries: [], bytes: 0, removableBytes: 0 }
  }
  const seen = new Set()
  const entries = [...cacheEntries(root, 'shim', engine, io, seen), ...cacheEntries(root, 'toolchain', toolchain, io, seen)]
  for (const name of [...(io.names(root) ?? [])].sort()) {
    if (CACHE_DIRECTORIES.includes(name)) continue
    entries.push(topLevelEntry(join(root, name), name, io, seen))
  }
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0)
  const removableBytes = removable(entries, { superseded: true }).reduce((total, entry) => total + entry.bytes, 0)
  return { root, present: true, engine, toolchain, entries, bytes, removableBytes }
}

/**
 * The entries one deletion pass would remove.
 * @param entries - the report's entries.
 * @param options - which classes are allowed: `superseded`, `tools`, `dev`.
 * @returns the entries to remove.
 */
export function removable(entries, options) {
  const allowed = new Set()
  if (options.superseded === true) allowed.add('superseded')
  if (options.tools === true) allowed.add('tools')
  if (options.dev === true) allowed.add('dev')
  return entries.filter((entry) => entry.removable !== null && allowed.has(entry.removable))
}

/**
 * Delete the selected entries.
 * @param entries - entries from {@link removable}.
 * @param io - filesystem seam.
 * @returns how many entries were removed and how many bytes they held.
 */
export function removeEntries(entries, io = nodeIo) {
  for (const entry of entries) io.remove(entry.path)
  return { removed: entries.length, bytes: entries.reduce((total, entry) => total + entry.bytes, 0) }
}

/**
 * Render a byte count in the unit a reader cares about.
 * @param bytes - the count.
 * @returns the text, e.g. `36 MB`.
 */
export function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/**
 * Where an install keeps its per-user state.
 * @param env - the environment providing `LOCALAPPDATA`.
 * @returns the directory, or an empty string when it cannot be derived.
 */
export function defaultStateRoot(env) {
  const local = env.LOCALAPPDATA ?? env.LocalAppData
  return local === undefined || local.length === 0 ? '' : join(local, 'dsh-bash-native')
}

/** What one entry's state column says. */
function stateLabel(entry) {
  if (entry.current) return 'in use'
  if (entry.removable === 'superseded') return 'superseded'
  if (entry.removable === null) return 'keep'
  return `delete with --${entry.removable}`
}

/**
 * Render the report as text, grouping entries by kind and marking what a deletion pass would take.
 * @param report - a value from {@link inspectState}.
 * @returns the text.
 */
export function formatReport(report) {
  if (!report.present) return `no per-user state at ${report.root}`
  const lines = [`state: ${report.root} (${formatBytes(report.bytes)})`]
  const groups = [
    ['shim', 'the bash/sh names for one engine build'],
    ['toolchain', 'one packaged toolchain'],
    ['tools', 'a toolchain built from source (its regeneration is the slow one)'],
    ['dev', 'development leftovers of scripts/build-engine.mjs'],
    ['other', 'not managed by this script'],
  ]
  for (const [kind, description] of groups) {
    const entries = report.entries.filter((entry) => entry.kind === kind)
    if (entries.length === 0) continue
    lines.push(`  ${kind}: ${description}`)
    for (const entry of entries) {
      lines.push(`    ${entry.name.slice(0, 20).padEnd(22)}${formatBytes(entry.bytes).padStart(8)}  ${stateLabel(entry)}`)
    }
  }
  lines.push(`${formatBytes(report.removableBytes)} in superseded caches; rerun with --yes to delete them`)
  return lines.join('\n')
}

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