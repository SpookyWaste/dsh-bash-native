/**
 * The POSIX toolchain this package ships, and the farm that publishes it.
 *
 * The same two facts that shape `artifact.ts` shape this module. The toolchain is the capability: without
 * it `grep`, `sed`, `awk`, `jq`, `find`, `xargs`, `timeout`, `diff`, `cmp`, `which`, `stat` and `ps` are
 * either absent or — for `find`, `timeout` and `convert` — the unrelated Windows programs of the same
 * name, so an install that cannot build one from source was never "install and use". It ships as the
 * distinct binaries minus their hard links (`toolchain/win32-x64/*.exe`) plus a manifest naming every
 * command each one provides, because 104 published names are only 15 files. It is not run from the package
 * itself: a `PATH` directory belongs in per-user state rather than in `node_modules`, so the files are
 * verified against the manifest, materialized under `%LOCALAPPDATA%`, and the published names are created
 * there.
 *
 * Two costs were removed from that description. The 15 files are hard links to the packaged ones whenever
 * the volume allows it, which is the normal `$DSH_HOME` install — 15 files that share their bytes cost no
 * copy at all — and a copy otherwise. And verification is stamped: a stamp records the identity of every
 * packaged file and of every materialized one, so a resolution that finds them all unchanged skips the
 * 76 MB of hashing that reading both sides used to cost.
 *
 * The cache is content-addressed by the manifest's own digest, so a rebuilt package lands in a new
 * directory, and it is never pruned: another live process may still be running the previous toolchain.
 * @module dsh-bash-native/toolchain-artifact
 */

import { copyFileSync, linkSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ArtifactIo, FileIdentity, VerifyMode } from './artifact.js'
import { identityMatches, readStampJson, sameIdentity, stampPathFor, writeStampJson } from './artifact.js'

/** The toolchain directory prepared for use, or why the packaged one cannot be used. */
export type PackagedToolchain = { readonly ready: string } | { readonly refused: string }

/** The filesystem operations this module needs beyond {@link ArtifactIo}, injected so its rules are testable. */
export interface ToolchainIo extends ArtifactIo {
  /** Creates a hard link, which is how one file becomes every name it publishes. */
  link(from: string, to: string): void
  /** Copies one file, overwriting the destination; the fallback when a link is impossible. */
  copy(from: string, to: string): void
  /** Removes a file or directory tree, ignoring absence. */
  remove(path: string): void
  /** @param path - existing directory. @returns its entry names, or null when it cannot be read. */
  names(path: string): readonly string[] | null
}

/** Inputs the executor contributes to {@link preparePackagedToolchain}. */
export interface PrepareToolchainOptions {
  /** The installed package root, i.e. the directory holding `toolchain/`. */
  readonly packageRoot: string
  /** Environment providing `LOCALAPPDATA`, where the cache and the stamps live. */
  readonly env: { readonly [name: string]: string | undefined }
  /** How much of the verification to repeat. Omitted means `stamped`. */
  readonly verify?: VerifyMode
  /** Filesystem and hashing, overridable in tests. */
  readonly io?: ToolchainIo
}

/** One packaged binary and every command name it publishes. */
export interface PackagedFile {
  readonly file: string
  readonly sha256: string
  readonly bytes: number
  readonly component: string
  readonly version: string
  readonly license: string
  readonly source: string
  readonly names: readonly string[]
}

/** The manifest `toolchain/win32-x64/manifest.json` carries: what the package holds and what it provides. */
export interface ToolchainManifest {
  readonly version: number
  readonly files: readonly PackagedFile[]
}

/** What a resolution records once it has verified the toolchain, so the next one can skip the hashing. */
interface ToolchainStamp {
  /** Format version; a record from any other version is ignored and rewritten. */
  readonly version: number
  /** The manifest digest this verdict is about. */
  readonly digest: string
  /** Identity of each packaged file, keyed by its name in the manifest. */
  readonly sources: Readonly<Record<string, FileIdentity>>
  /** Identity of each materialized file, keyed the same way. */
  readonly farm: Readonly<Record<string, FileIdentity>>
}

/** The manifest file name inside the packaged toolchain directory. */
const MANIFEST_FILE = 'manifest.json'

/** The cache marker: the manifest digest a cache directory was built from. */
const MARKER_FILE = '.manifest-sha256'

/** The subdirectory of the cache that holds the published names. */
const BIN_DIRECTORY = 'bin'

/** The packaged toolchain directory, relative to the package root. */
const TOOLCHAIN_DIRECTORY = join('toolchain', 'win32-x64')

/** The stamp format this module writes. */
const STAMP_VERSION = 1

/**
 * Prepare the packaged toolchain for use.
 *
 * Every file is verified against the manifest before anything is materialized, and the materialized copies
 * are hashed after they are written, so a truncated download, a tampered binary or a half-written cache is
 * refused rather than probed as "this command is missing". The published names are recreated as hard links,
 * which is why 104 commands cost the 15 files' bytes and not 104 copies of them, and the files themselves
 * are hard links to the package's own bytes whenever the volume allows it (a copy otherwise). With the
 * default `stamped` verification all of that reading is skipped while the stamp's recorded identities still
 * match; `always` re-hashes.
 * @param options - package root, environment, verification mode and I/O seams.
 * @returns the `bin` directory to probe and put on `PATH`, or the reason the packaged toolchain cannot be used.
 */
export function preparePackagedToolchain(options: PrepareToolchainOptions): PackagedToolchain {
  const io = options.io ?? nodeIo
  const directory = join(options.packageRoot, TOOLCHAIN_DIRECTORY)
  const manifestPath = join(directory, MANIFEST_FILE)
  if (!io.isFile(manifestPath)) return { refused: `this install carries no packaged toolchain (looked at ${manifestPath})` }
  const text = io.readText(manifestPath)
  const manifest = parseManifest(text)
  if (manifest === null) return { refused: `the packaged toolchain manifest is unusable (${manifestPath})` }
  const digest = digestOf(text)
  const cacheRoot = cacheDirectory(options.env)
  if (cacheRoot === null) {
    return { refused: 'LOCALAPPDATA is not set, so the toolchain cannot be placed outside the workspace it ships in' }
  }
  const cache = join(cacheRoot, digest)
  const bin = join(cache, BIN_DIRECTORY)
  const marker = join(cache, MARKER_FILE)
  const stamp = options.verify === 'always' ? null : stampPathFor(options.env, 'toolchain', digest)
  if (stamp !== null && toolchainStampHolds(io, stamp, manifest, directory, cache, bin, marker, digest)) {
    return { ready: bin }
  }

  // The package is the authority on what may run, so its files are hashed even when a cache is present: a
  // package that was tampered with in place must not be able to run its own version through a stale cache,
  // and a stamp cannot see a rewrite that preserved both size and modification time.
  const sources = new Map<string, string>()
  for (const entry of manifest.files) {
    const source = join(directory, entry.file)
    const identity = io.stat(source)
    if (identity === null) return { refused: `the packaged toolchain is missing ${entry.file} (${source})` }
    if (identity.bytes !== entry.bytes) {
      return { refused: `packaged ${entry.file} is not the size the manifest records: ${entry.bytes} bytes expected, ${identity.bytes} found (${source})` }
    }
    const observed = io.sha256(source)
    if (observed !== entry.sha256) {
      return { refused: `packaged ${entry.file} does not match the manifest: it records ${entry.sha256}, the file hashes to ${observed} (${source})` }
    }
    sources.set(entry.file, source)
  }
  if (cached(io, cache, bin, marker, digest, manifest)) {
    writeToolchainStamp(io, stamp, manifest, directory, cache, digest)
    return { ready: bin }
  }
  try {
    io.remove(cache)
    io.makeDirectory(bin)
    for (const entry of manifest.files) {
      const target = join(cache, entry.file)
      const from = sources.get(entry.file) ?? join(directory, entry.file)
      materialize(io, from, target)
      if (io.sha256(target) !== entry.sha256) {
        return { refused: `the cached ${entry.file} does not hash to ${entry.sha256} (${target})` }
      }
      for (const name of entry.names) {
        const published = join(bin, `${name}.exe`)
        try {
          io.link(target, published)
        } catch {
          // A filesystem without hard links costs the disk space and nothing else, so it is not a refusal.
          io.copy(target, published)
        }
      }
    }
    io.writeText(marker, digest)
  } catch (error) {
    // A cache that cannot be written is a real failure of the install, not a reason to run binaries from
    // inside the workspace: report it, and the probe then truthfully reports no toolchain.
    return { refused: `the packaged toolchain could not be cached under ${cache}: ${String(error)}` }
  }
  writeToolchainStamp(io, stamp, manifest, directory, cache, digest)
  return { ready: bin }
}

/**
 * Whether a stamp still describes this toolchain, which is what lets the hashing be skipped.
 * @param io - filesystem seam.
 * @param path - the stamp file.
 * @param manifest - the manifest just parsed.
 * @param directory - the packaged toolchain directory.
 * @param cache - the cache directory holding the materialized files.
 * @param bin - the cache's `bin` directory, holding one name per published command.
 * @param marker - the cache marker recording which manifest built it.
 * @param digest - the manifest's digest.
 * @returns whether every packaged file, every materialized file and every published name still holds.
 */
function toolchainStampHolds(
  io: ToolchainIo,
  path: string,
  manifest: ToolchainManifest,
  directory: string,
  cache: string,
  bin: string,
  marker: string,
  digest: string,
): boolean {
  const stamp = readStampJson(io, path) as Partial<ToolchainStamp> | null
  if (stamp === null || stamp.version !== STAMP_VERSION || stamp.digest !== digest) return false
  if (stamp.sources === undefined || stamp.farm === undefined) return false
  let recorded: string
  try {
    recorded = io.readText(marker)
  } catch {
    // A cache that carries no marker was not built from this manifest, which is what the stamp asserts.
    return false
  }
  if (recorded.trim() !== digest) return false
  const listing = io.names(bin)
  if (listing === null) return false
  const published = new Set(listing)
  for (const entry of manifest.files) {
    if (!identityMatches(io, join(directory, entry.file), stamp.sources[entry.file])) return false
    if (!identityMatches(io, join(cache, entry.file), stamp.farm[entry.file])) return false
    for (const name of entry.names) {
      if (!published.has(`${name}.exe`)) return false
    }
  }
  return true
}

/** Record the identities a verified toolchain is made of, best effort: a missing stamp costs one hash. */
function writeToolchainStamp(
  io: ToolchainIo,
  path: string | null,
  manifest: ToolchainManifest,
  directory: string,
  cache: string,
  digest: string,
): void {
  if (path === null) return
  const sources: Record<string, FileIdentity> = {}
  const farm: Record<string, FileIdentity> = {}
  for (const entry of manifest.files) {
    const source = io.stat(join(directory, entry.file))
    const materialized = io.stat(join(cache, entry.file))
    if (source === null || materialized === null) return
    sources[entry.file] = source
    farm[entry.file] = materialized
  }
  writeStampJson(io, path, { version: STAMP_VERSION, digest, sources, farm } satisfies ToolchainStamp)
}

/**
 * Put one packaged file into the cache, preferring a hard link.
 *
 * A link costs nothing and keeps the package's bytes authoritative; a filesystem or a volume that cannot
 * link it — a package on another volume than `%LOCALAPPDATA%`, or a filesystem without hard links — gets a
 * copy, which is the behavior every install had before links were tried at all.
 * @param io - filesystem seam.
 * @param from - the packaged file.
 * @param to - its place in the cache.
 */
function materialize(io: ToolchainIo, from: string, to: string): void {
  try {
    io.link(from, to)
    return
  } catch {
    // Cross-volume and filesystems without hard links are both "copy instead", not a failure.
  }
  io.copy(from, to)
}

/** Whether the cache already holds this manifest's toolchain, verified by its marker and every file's hash. */
function cached(
  io: ToolchainIo,
  cache: string,
  bin: string,
  marker: string,
  digest: string,
  manifest: ToolchainManifest,
): boolean {
  if (!io.isFile(marker)) return false
  try {
    if (io.readText(marker).trim() !== digest) return false
  } catch {
    // An unreadable marker is the same verdict as an absent one: the cache is rebuilt below.
    return false
  }
  const listing = io.names(bin)
  if (listing === null) return false
  const published = new Set(listing)
  for (const entry of manifest.files) {
    const target = join(cache, entry.file)
    if (!io.isFile(target) || io.sha256(target) !== entry.sha256) return false
    for (const name of entry.names) {
      if (!published.has(`${name}.exe`)) return false
    }
  }
  return true
}

/** The per-user cache root, or null when `LOCALAPPDATA` cannot name one. */
function cacheDirectory(env: { readonly [name: string]: string | undefined }): string | null {
  const local = env.LOCALAPPDATA ?? env.LocalAppData
  if (local === undefined || local.length === 0) return null
  return join(local, 'dsh-bash-native', 'toolchain')
}

/** The digest that names a cache directory: the manifest's own bytes. */
function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Read and validate the manifest, or null when it cannot be trusted to describe files and names. */
export function parseManifest(text: string): ToolchainManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // An unparsable manifest is the same verdict as a missing one, and the refusal text names the file.
    return null
  }
  const files = (parsed as { files?: unknown }).files
  if (!Array.isArray(files) || files.length === 0) return null
  const entries: PackagedFile[] = []
  for (const candidate of files) {
    if (typeof candidate !== 'object' || candidate === null) return null
    const { file, sha256, bytes, component, version, license, source, names } = candidate as Record<string, unknown>
    if (typeof file !== 'string' || !/^[A-Za-z0-9_.-]+\.exe$/.test(file)) return null
    if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
    if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) return null
    if (typeof component !== 'string' || component.length === 0) return null
    if (typeof version !== 'string' || typeof license !== 'string' || typeof source !== 'string') return null
    if (!Array.isArray(names) || names.length === 0) return null
    if (!names.every((name) => typeof name === 'string' && /^[A-Za-z0-9_.+-]+$/.test(name))) return null
    entries.push({ file, sha256, bytes, component, version, license, source, names: names as string[] })
  }
  return { version: 1, files: entries }
}

/** The production filesystem and hashing, kept last so the rules above read as the module's content. */
const nodeIo: ToolchainIo = {
  isFile: (path) => {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  readText: (path) => readFileSync(path, 'utf8'),
  stat: (path) => {
    try {
      const stats = statSync(path)
      return { bytes: stats.size, mtimeMs: stats.mtimeMs }
    } catch {
      return null
    }
  },
  sha256: (path) => createHash('sha256').update(readFileSync(path)).digest('hex'),
  copy: (from, to) => copyFileSync(from, to),
  link: (from, to) => linkSync(from, to),
  makeDirectory: (path) => {
    mkdirSync(path, { recursive: true })
  },
  remove: (path) => {
    rmSync(path, { recursive: true, force: true })
  },
  writeText: (path, text) => writeFileSync(path, text),
  names: (path) => {
    try {
      return readdirSync(path)
    } catch {
      // A cache directory that cannot be listed is simply not a usable cache.
      return null
    }
  },
}
