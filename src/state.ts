/**
 * The per-user state directory: what this plugin materializes there, what an upgrade leaves behind, and the
 * pass that reclaims it.
 *
 * Everything under `%LOCALAPPDATA%\dsh-bash-native` that an install writes is content-addressed: one
 * `shim/<engine sha256>` directory per engine build (the `bash`/`sh` names, hard links to the engine when the
 * volume allows it) and one `toolchain/<manifest digest>` directory per packaged toolchain (the materialized
 * programs plus their `bin/` names). An upgrade whose engine or toolchain bytes changed lands in a new
 * directory and leaves the old one behind. Two things use this module: `bin/clean-state.mjs`, which reports
 * and deletes on request, and the executor's own background pass, which removes a superseded directory only
 * when doing so actually frees its bytes.
 *
 * Sizes are counted the way `du` counts them: names that share one file (hard links) are counted once, which
 * is why a directory whose listing is a gigabyte of applet names can really occupy one 16 MB binary. The same
 * link count is what separates "deleting this frees the bytes" from "the bytes live on through a name
 * elsewhere" — an installed package's own copy of the same binary, for example.
 * @module dsh-bash-native/state
 */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** A cache directory name: the 64 lowercase hex characters of a sha256 digest. */
const DIGEST_NAME = /^[0-9a-f]{64}$/

/** Subdirectories of the per-user directory whose children are content-addressed caches. */
const CACHE_DIRECTORIES = ['shim', 'toolchain'] as const

/** Development leftovers of `scripts/build-engine.mjs`, none of which an install needs. */
const DEVELOPMENT_ENTRIES = ['build', 'engine-backup', 'rubash.exe'] as const

/** The source-built toolchain directory `scripts/build-toolchain.mjs` writes by default. */
const BUILT_TOOLCHAIN_ENTRY = 'tools'

/** One child of a directory, as `readdir` reports it.
 *
 * The type has to come from the directory entry rather than from `lstat`, because Windows reports a junction
 * as a plain directory through `lstat` while `readdir` flags it as a link. Measurement and deletion both care:
 * a junction inside a cache would otherwise be measured through its target.
 */
export interface StateDirEntry {
  readonly name: string
  /** Whether the name is a link or junction, which is never followed. */
  readonly link: boolean
  /** Whether it is a directory (false for links, even ones that point at directories). */
  readonly directory: boolean
}

/** One file as the classification needs it. */
export interface StateFile {
  /** Size in bytes. */
  readonly bytes: number
  /** Whether this is a regular file rather than a directory. */
  readonly file: boolean
  /** Hard-link key (`device:inode`), or null when the platform cannot name one. */
  readonly identity: string | null
  /** How many names this file has in total. */
  readonly links: number
  /** Whether the name itself is a link or junction, which is never followed or descended into. */
  readonly link: boolean
}

/** The filesystem questions this module asks, injected so the classification is testable without a tree. */
export interface StateIo {
  /** @param path - candidate path. @returns whether it is a directory. */
  isDirectory(path: string): boolean
  /** @param path - directory. @returns its entries with the type `readdir` reports, or null when unreadable. */
  names(path: string): readonly StateDirEntry[] | null
  /** @param path - candidate path. @returns its identity, or null when it is absent. */
  stat(path: string): StateFile | null
  /** Deletes a file or a directory tree, ignoring absence. */
  remove(path: string): void
}

/** What an entry is, which decides what may be done to it. */
export type StateKind = 'shim' | 'toolchain' | 'tools' | 'dev' | 'other'

/** Which flag or pass would delete an entry; null means nothing offers to. */
export type StateRemoval = 'superseded' | 'tools' | 'dev' | null

/** One child of the state directory, with what it costs and what may be done to it. */
export interface StateEntry {
  readonly kind: StateKind
  readonly name: string
  readonly path: string
  /** Bytes this entry is the first to account for, counted once per inode. */
  readonly bytes: number
  /** Part of `bytes` whose inode has another name outside this entry, so deleting it frees nothing. */
  readonly shared: number
  /** Whether the tree holds a link or junction; deleting it could reach outside, so the automatic pass refuses. */
  readonly linked: boolean
  /** Whether this is the directory the current package would materialize. */
  readonly current: boolean
  readonly removable: StateRemoval
}

/** The whole directory, classified. */
export interface StateReport {
  readonly root: string
  readonly present: boolean
  readonly engine: string | null
  readonly toolchain: string | null
  readonly entries: readonly StateEntry[]
  readonly bytes: number
  readonly removableBytes: number
}

/** What one automatic pass did. */
export interface PruneResult {
  /** Directories removed. */
  readonly removed: number
  /** Bytes that deletion actually freed, summed over the removed directories. */
  readonly bytes: number
  /** Their names, for the log line. */
  readonly names: readonly string[]
}

/** The production filesystem: four reads and one delete, so the classification above is the module's content. */
export const nodeIo: StateIo = {
  isDirectory: (path) => {
    try {
      return lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()
    } catch {
      return false
    }
  },
  names: (path) => {
    try {
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        link: entry.isSymbolicLink(),
        directory: entry.isDirectory(),
      }))
    } catch {
      return null
    }
  },
  stat: (path) => {
    try {
      // `lstat`, never `stat`: a junction or symlink inside the cache must be reported as a link rather than
      // measured through whatever it points at, or the classification would count another directory's files
      // and a deletion would look cheaper than it is.
      const found = lstatSync(path)
      if (found.isSymbolicLink()) return { bytes: 0, file: false, identity: null, links: 0, link: true }
      if (!found.isFile()) return { bytes: 0, file: false, identity: null, links: 0, link: false }
      return { bytes: found.size, file: true, identity: `${found.dev}:${found.ino}`, links: found.nlink, link: false }
    } catch {
      return null
    }
  },
  remove: (path) => rmSync(path, { recursive: true, force: true }),
}

/**
 * Where an install keeps its per-user state.
 * @param env - the environment providing `LOCALAPPDATA`.
 * @returns the directory, or an empty string when it cannot be derived.
 */
export function defaultStateRoot(env: { readonly [name: string]: string | undefined }): string {
  const local = env.LOCALAPPDATA ?? env.LocalAppData
  return local === undefined || local.length === 0 ? '' : join(local, 'dsh-bash-native')
}

/**
 * The two digests this package would materialize, which is what makes a cache directory "current".
 *
 * The engine digest comes from the shipped `engine.lock.json`; the toolchain digest is the sha256 of the
 * shipped manifest text, which is exactly how `preparePackagedToolchain` names its cache. Either can be null
 * — an incomplete tree, an unreadable manifest — and then nothing is deleted rather than guessing which
 * directory the running package uses.
 * @param packageRoot - the installed package root.
 * @returns the engine digest and the toolchain digest, null when they cannot be derived.
 */
export function currentDigests(packageRoot: string): { engine: string | null; toolchain: string | null } {
  let engine: string | null = null
  try {
    const lock: unknown = JSON.parse(readFileSync(join(packageRoot, 'engine.lock.json'), 'utf8'))
    const digest = (lock as { artifact?: { sha256?: unknown } } | null)?.artifact?.sha256
    if (typeof digest === 'string' && DIGEST_NAME.test(digest)) engine = digest
  } catch {
    // An unreadable lock means "unknown", which leaves every shim directory alone.
    engine = null
  }
  let toolchain: string | null = null
  try {
    const text = readFileSync(join(packageRoot, 'toolchain', 'win32-x64', 'manifest.json'), 'utf8')
    toolchain = createHash('sha256').update(text, 'utf8').digest('hex')
  } catch {
    toolchain = null
  }
  return { engine, toolchain }
}

/**
 * Measure one entry: the bytes it is the first to account for, and the bytes that would survive deletion.
 * @param path - the entry's path.
 * @param io - filesystem seam.
 * @param seen - the file identities an earlier entry already accounted for.
 * @returns the bytes this entry owns and the part of them that deletion would not free.
 */
function measureEntry(path: string, io: StateIo, seen: Set<string>): { bytes: number; shared: number; linked: boolean } {
  const found = io.stat(path)
  if (found === null) return { bytes: 0, shared: 0, linked: false }
  if (found.link) return { bytes: 0, shared: 0, linked: true }
  if (found.file) {
    if (found.identity !== null && seen.has(found.identity)) return { bytes: 0, shared: 0, linked: false }
    if (found.identity !== null) seen.add(found.identity)
    return { bytes: found.bytes, shared: found.links > 1 ? found.bytes : 0, linked: false }
  }
  // A directory is measured in two passes: how often each inode appears inside it, and what that costs.
  const counts = new Map<string, { bytes: number; links: number; count: number }>()
  let linked = false
  countNames(path, io, counts, () => {
    linked = true
  })
  let bytes = 0
  let shared = 0
  for (const [identity, entry] of counts) {
    if (seen.has(identity)) continue
    seen.add(identity)
    bytes += entry.bytes
    if (entry.links > entry.count) shared += entry.bytes
  }
  return { bytes, shared, linked }
}

/**
 * Count how many names each inode has inside one directory tree.
 * @param path - the directory.
 * @param io - filesystem seam.
 * @param counts - identity → `{ bytes, links, count }`, accumulated in place.
 */
function countNames(
  path: string,
  io: StateIo,
  counts: Map<string, { bytes: number; links: number; count: number }>,
  markLinked: () => void,
): void {
  for (const entry of io.names(path) ?? []) {
    const child = join(path, entry.name)
    if (entry.link) {
      markLinked()
      continue
    }
    if (entry.directory) {
      countNames(child, io, counts, markLinked)
      continue
    }
    const found = io.stat(child)
    if (found === null || !found.file) continue
    const key = found.identity ?? child
    const known = counts.get(key)
    if (known === undefined) counts.set(key, { bytes: found.bytes, links: found.links, count: 1 })
    else known.count += 1
  }
}

/**
 * Classify one cache root's children.
 *
 * A child named by a 64-hex digest is a materialized version: the one this package uses is current, the rest
 * are superseded. Anything else was not written by this layout, so it is reported and left alone. When the
 * current digest is unknown nothing is marked removable.
 * @param root - the per-user directory.
 * @param kind - `shim` or `toolchain`.
 * @param current - the digest this package materializes, or null when unknown.
 * @param io - filesystem seam.
 * @param seen - the file identities already counted by this report.
 * @returns one entry per child.
 */
function cacheEntries(root: string, kind: 'shim' | 'toolchain', current: string | null, io: StateIo, seen: Set<string>): StateEntry[] {
  const entries: StateEntry[] = []
  for (const name of [...(io.names(join(root, kind)) ?? [])].sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, kind, name.name)
    const isVersion = !name.link && name.directory && DIGEST_NAME.test(name.name)
    if (!isVersion) {
      entries.push({ kind: 'other', name: `${kind}/${name.name}`, path, bytes: 0, shared: 0, linked: name.link, current: false, removable: null })
      continue
    }
    const isCurrent = current !== null && name.name === current
    const measured = measureEntry(path, io, seen)
    entries.push({
      kind,
      name: name.name,
      path,
      bytes: measured.bytes,
      shared: measured.shared,
      linked: measured.linked,
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
 * @returns the entry, with `removable` naming what would delete it.
 */
function topLevelEntry(path: string, name: string, link: boolean, io: StateIo, seen: Set<string>): StateEntry {
  const measured = link ? { bytes: 0, shared: 0, linked: true } : measureEntry(path, io, seen)
  const base = { bytes: measured.bytes, shared: measured.shared, linked: measured.linked, current: false }
  if ((DEVELOPMENT_ENTRIES as readonly string[]).includes(name)) return { kind: 'dev', name, path, ...base, removable: 'dev' }
  if (name === BUILT_TOOLCHAIN_ENTRY) return { kind: 'tools', name, path, ...base, removable: 'tools' }
  return { kind: 'other', name, path, ...base, removable: null }
}

/**
 * Inspect the per-user directory.
 * @param options - `root`, the two digests this package uses, and the filesystem seam.
 * @returns the report: entries, totals, and whether the directory exists at all.
 */
export function inspectState(options: {
  readonly root: string
  readonly engine: string | null
  readonly toolchain: string | null
  readonly io?: StateIo
}): StateReport {
  const io = options.io ?? nodeIo
  if (!io.isDirectory(options.root)) {
    return { root: options.root, present: false, engine: options.engine, toolchain: options.toolchain, entries: [], bytes: 0, removableBytes: 0 }
  }
  const seen = new Set<string>()
  const entries = [
    ...cacheEntries(options.root, 'shim', options.engine, io, seen),
    ...cacheEntries(options.root, 'toolchain', options.toolchain, io, seen),
  ]
  for (const child of [...(io.names(options.root) ?? [])].sort((left, right) => left.name.localeCompare(right.name))) {
    if ((CACHE_DIRECTORIES as readonly string[]).includes(child.name)) continue
    entries.push(topLevelEntry(join(options.root, child.name), child.name, child.link, io, seen))
  }
  const bytes = entries.reduce((total, entry) => total + entry.bytes, 0)
  return {
    root: options.root,
    present: true,
    engine: options.engine,
    toolchain: options.toolchain,
    entries,
    bytes,
    removableBytes: reclaimable(entries, { superseded: true }),
  }
}

/**
 * The entries one deletion pass would remove.
 * @param entries - the report's entries.
 * @param options - which classes are allowed: `superseded`, `tools`, `dev`.
 * @returns the entries to remove.
 */
export function removable(entries: readonly StateEntry[], options: { superseded?: boolean; tools?: boolean; dev?: boolean }): StateEntry[] {
  const allowed = new Set<StateRemoval>()
  if (options.superseded === true) allowed.add('superseded')
  if (options.tools === true) allowed.add('tools')
  if (options.dev === true) allowed.add('dev')
  return entries.filter((entry) => entry.removable !== null && allowed.has(entry.removable))
}

/**
 * The bytes one deletion pass would actually free.
 * @param entries - the report's entries.
 * @param options - which classes are allowed: `superseded`, `tools`, `dev`.
 * @returns the bytes the pass would free.
 */
export function reclaimable(entries: readonly StateEntry[], options: { superseded?: boolean; tools?: boolean; dev?: boolean }): number {
  return removable(entries, options).reduce((total, entry) => total + Math.max(0, entry.bytes - entry.shared), 0)
}

/**
 * Delete the selected entries.
 * @param entries - entries from {@link removable}.
 * @param io - filesystem seam.
 * @returns how many entries were removed and how many bytes that actually freed.
 */
export function removeEntries(entries: readonly StateEntry[], io: StateIo = nodeIo): { removed: number; bytes: number } {
  for (const entry of entries) io.remove(entry.path)
  return { removed: entries.length, bytes: reclaimable(entries, { superseded: true, tools: true, dev: true }) }
}

/**
 * Remove the superseded cache directories whose bytes deleting actually frees.
 *
 * This is the executor's own pass, run once per process after an engine resolved: an upgrade leaves the
 * previous engine's `shim/` directory and the previous package's `toolchain/` cache behind, and nobody needs
 * them. Two conditions keep it safe. The directory must be **superseded** — its digest is not the one this
 * package uses — so the running build is never a candidate. And it must be **unshared**: every file in it has
 * all its hard-link names inside it, so no installed package (or other cache) still points at those bytes.
 * The second condition is also what makes the report honest — a directory that only mirrors an installed
 * package frees nothing, so deleting it would be churn against another version's files.
 *
 * The remaining risk is another installed version that *copied* rather than linked its cache and is still
 * running: its next resolution recreates the directory, so the worst case is one failed `bash` spawn, not lost
 * data. An entry that cannot be removed (a process holds it open) is left for the next pass.
 * @param options - the state root, the two digests this package uses, and the filesystem seam.
 * @returns what the pass removed.
 */
export function pruneSuperseded(options: {
  readonly root: string
  readonly engine: string | null
  readonly toolchain: string | null
  readonly io?: StateIo
}): PruneResult {
  const io = options.io ?? nodeIo
  if (options.root.length === 0 || options.engine === null || !io.isDirectory(options.root)) {
    return { removed: 0, bytes: 0, names: [] }
  }
  const report = inspectState({ root: options.root, engine: options.engine, toolchain: options.toolchain, io })
  // A tree holding a link or junction is never a candidate: deleting it would be a decision about names
  // outside this directory, and the pass only ever means to remove bytes it laid down itself.
  const doomed = removable(report.entries, { superseded: true }).filter((entry) => entry.shared === 0 && !entry.linked)
  let removed = 0
  let bytes = 0
  const names: string[] = []
  for (const entry of doomed) {
    try {
      io.remove(entry.path)
    } catch {
      // A directory another process holds open stays; the next session's pass tries again.
      continue
    }
    removed += 1
    bytes += entry.bytes
    names.push(entry.name)
  }
  return { removed, bytes, names }
}

/**
 * Render a byte count in the unit a reader cares about.
 * @param bytes - the count.
 * @returns the text, e.g. `36 MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/** What one entry's state column says. */
function stateLabel(entry: StateEntry): string {
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
export function formatReport(report: StateReport): string {
  if (!report.present) return `no per-user state at ${report.root}`
  const lines = [`state: ${report.root} (${formatBytes(report.bytes)})`]
  const groups: readonly [StateKind, string][] = [
    ['shim', 'the bash/sh names for one engine build'],
    ['toolchain', 'one packaged toolchain'],
    ['tools', 'a toolchain built from source (its regeneration is the slow one)'],
    ['dev', 'development leftovers of scripts/build-engine.mjs'],
    ['other', 'not managed by this module'],
  ]
  for (const [kind, description] of groups) {
    const entries = report.entries.filter((entry) => entry.kind === kind)
    if (entries.length === 0) continue
    lines.push(`  ${kind}: ${description}`)
    for (const entry of entries) {
      const notes = [entry.shared > 0 ? `${formatBytes(entry.shared)} shared` : '', entry.linked ? 'contains a link' : '']
        .filter((note) => note.length > 0)
        .join(' · ')
      lines.push(`    ${entry.name.slice(0, 20).padEnd(22)}${formatBytes(entry.bytes).padStart(8)}  ${stateLabel(entry)}${notes.length > 0 ? ` · ${notes}` : ''}`)
    }
  }
  lines.push(`${formatBytes(report.removableBytes)} in superseded caches; rerun with --yes to delete them`)
  return lines.join('\n')
}