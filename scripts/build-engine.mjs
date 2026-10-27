/**
 * Builds the shell engine this plugin runs, from the pinned upstream commit plus this repository's patches.
 *
 * Why build rather than take a published binary: the engine drives a contract this plugin states (a UTF-8
 * length counted in characters, a real PID behind `$!`, a pattern/script word that is never rewritten), and
 * one of those behaviours exists only in this repository's patch. A source build at a pinned commit is the
 * only way to change an engine behaviour deliberately and to prove the change landed.
 *
 * Usage:
 *   node scripts/build-engine.mjs                 build the pinned ref and install the shipped artifact
 *   node scripts/build-engine.mjs --refresh       re-fetch the pinned ref first
 *   node scripts/build-engine.mjs --cache=DIR     use another build cache
 *   node scripts/build-engine.mjs --keep          build and install locally, but keep the shipped artifact
 *
 * Network: the first run fetches the pin and the crate registry. On Windows that traffic goes through
 * Schannel, which cannot acquire client credentials under this harness's sandbox token, so a run inside a
 * confined session fails with `SEC_E_NO_CREDENTIALS` before anything is compiled. Run this script from a
 * normal terminal; the failure below says so instead of leaving a registry error unexplained.
 *
 * The artifact inside this package is the product: the script installs there and rewrites the artifact
 * record in `engine.lock.json` (path, sha256, bytes). The executor refuses any artifact that does not hash
 * to what the lock says. The previous artifact is backed up to the per-user directory before it is replaced.
 * @module dsh-bash-native/scripts/build-engine
 */

import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCK_PATH = join(REPO_ROOT, 'engine.lock.json')
const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'))

const cacheArg = process.argv.find((arg) => arg.startsWith('--cache='))
const refresh = process.argv.includes('--refresh')
const keep = process.argv.includes('--keep')

const localAppData = process.env.LOCALAPPDATA ?? ''
if (localAppData.length === 0) {
  console.error('LOCALAPPDATA must name the per-user directory the engine lives in')
  process.exit(2)
}
const engineDir = join(localAppData, 'dsh-bash-native')
const enginePath = join(engineDir, `${lock.bin}.exe`)
const cacheRoot = cacheArg !== undefined ? cacheArg.slice('--cache='.length) : join(engineDir, 'build')
const checkout = join(cacheRoot, lock.bin)
const patchDir = join(REPO_ROOT, 'patches', lock.bin)

/** Run a command with inherited stdio, failing on a non-zero status. */
function run(command, args, options = {}) {
  console.log(`run    ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options })
  if (result.error !== undefined) throw new Error(`${command} could not be started: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`)
}

/** Run a command and return its trimmed stdout, failing on a non-zero status. */
function capture(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options })
  if (result.error !== undefined) throw new Error(`${command} could not be started: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}: ${(result.stderr ?? '').trim()}`)
  }
  return (result.stdout ?? '').trim()
}

/** Read a directory's names, answering an absent directory with an empty list. */
function entriesOf(path) {
  try {
    return readdirSync(path)
  } catch {
    // An absent patch directory means this pin needs no change, which is a supported configuration.
    return []
  }
}

/** Block for a moment; Node allows `Atomics.wait` on the main thread. */
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)

/**
 * Run one network command, retrying a refused connection.
 *
 * A first run on a slow link fails halfway through a fetch often enough that a single attempt would be
 * reported as "the pin cannot be fetched", which is the one diagnosis that is almost never true.
 */
function runNetwork(command, args, options = {}, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(command, args, options)
      return
    } catch (error) {
      if (attempt >= attempts) throw error
      console.log(`retry  ${command} ${args.join(' ')} (attempt ${attempt + 1} of ${attempts})`)
      sleepSync(5000 * attempt)
    }
  }
}

/** Whether this checkout already holds a git object, which is what makes an offline rebuild possible. */
function hasGitObject(ref) {
  return spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: checkout, stdio: 'ignore', windowsHide: true }).status === 0
}

/**
 * Make the checkout sit exactly on the pinned commit, with every tracked file at its pinned content.
 *
 * The reset is what makes repeated builds idempotent: the previous build left the patches applied, and
 * applying them again would fail. Build outputs are untracked, so the reset keeps `target/` and the rebuild
 * stays incremental.
 */
function syncSource() {
  if (!existsSync(join(checkout, '.git'))) {
    if (existsSync(checkout)) rmSync(checkout, { recursive: true, force: true })
    mkdirSync(checkout, { recursive: true })
    runNetwork('git', ['init', '--quiet'], { cwd: checkout })
    runNetwork('git', ['remote', 'add', 'origin', lock.repo], { cwd: checkout })
  }
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8', windowsHide: true })
  const current = (head.stdout ?? '').trim()
  if (!refresh && current === lock.ref && hasGitObject(lock.ref)) {
    console.log(`reuse  ${lock.bin} @ ${lock.ref}`)
  } else if (!refresh && hasGitObject(lock.ref)) {
    console.log(`local  ${lock.bin} @ ${lock.ref} (already fetched)`)
  } else {
    console.log(`fetch  ${lock.repo} @ ${lock.ref}`)
    runNetwork('git', ['fetch', '--depth', '1', 'origin', lock.ref], { cwd: checkout })
  }
  run('git', ['checkout', '--force', '--quiet', lock.ref], { cwd: checkout })
  run('git', ['reset', '--hard', '--quiet', lock.ref], { cwd: checkout })
  console.log(`pin    ${capture('git', ['rev-parse', 'HEAD'], { cwd: checkout })}`)
}

/** Apply this repository's patches in filename order, then prove the code that builds carries them. */
function applyPatches() {
  const files = entriesOf(patchDir).filter((name) => name.endsWith('.patch')).sort()
  if (files.length === 0) {
    console.log('patch  none (this pin needs no change)')
    return
  }
  for (const file of files) run('git', ['apply', '--verbose', join(patchDir, file)], { cwd: checkout })
  // A diff that applied to a file nobody compiles would still "succeed"; the marker in the source is the
  // difference between "the patch was accepted" and "the code that runs carries it".
  const marked = capture('git', ['grep', '-l', 'dsh-bash-native patch', '--', 'src'], { cwd: checkout })
  if (marked.length === 0) throw new Error('the patches applied but left no marker in src/; refusing to build')
  console.log(`patch  ${files.length} applied (${marked.split('\n').join(', ')})`)
}

/**
 * The source paths that must not reach the artifact.
 *
 * `file!()` bakes a panic's source location into the release binary, and for code inside a dependency that
 * location is the cargo registry under the builder's home directory — a name and a layout that has no
 * business in a published binary. Remapping the home prefix is the compile-time fix; stripping does not
 * remove the strings. The toolchain build does the same thing with the same prefix.
 */
const REMAP_BUILD_PATHS = `--remap-path-prefix=${homedir()}=/build`

/** The environment a `cargo` call needs: a named installed toolchain, so rustup never tries the network. */
function rustEnv() {
  const active = spawnSync('rustup', ['show', 'active-toolchain'], { encoding: 'utf8', windowsHide: true })
  const name = (active.stdout ?? '').split(' ')[0]?.trim() ?? ''
  return { ...process.env, RUSTFLAGS: REMAP_BUILD_PATHS, ...(name.length === 0 ? {} : { RUSTUP_TOOLCHAIN: name }) }
}

/** Build the binary the pin declares, and name the one failure that is about this session rather than the pin. */
function build() {
  const logPath = join(checkout, 'build.log')
  const logFd = openSync(logPath, 'w')
  let status
  try {
    status = spawnSync('cargo', ['build', '--release', '--locked', '--bin', lock.bin], {
      cwd: checkout,
      stdio: ['ignore', 'inherit', logFd],
      env: rustEnv(),
      windowsHide: true,
    }).status
  } finally {
    closeSync(logFd)
  }
  if (status === 0) return
  const log = readFileSync(logPath, 'utf8')
  if (log.includes('schannel') || log.includes('SEC_E_NO_CREDENTIALS')) {
    throw new Error(
      'cargo could not reach the crate registry: Windows Schannel cannot acquire client credentials under ' +
        "this session's sandbox token (SEC_E_NO_CREDENTIALS). Run this script from a normal terminal.",
    )
  }
  throw new Error(`cargo build exited ${status} (full output in ${logPath})`)
}

/**
 * Copy the built binary to the per-user directory, and — unless `--keep` — to the shipped artifact, whose
 * identity the lock then records.
 */
function install() {
  const built = join(checkout, 'target', 'release', `${lock.bin}.exe`)
  if (!existsSync(built)) throw new Error(`the build produced no ${lock.bin}.exe`)
  mkdirSync(engineDir, { recursive: true })
  if (existsSync(enginePath)) {
    mkdirSync(join(engineDir, 'engine-backup'), { recursive: true })
    copyFileSync(enginePath, join(engineDir, 'engine-backup', `${lock.bin}-${Date.now()}.exe`))
  }
  copyFileSync(built, enginePath)
  console.log(`install ${enginePath}`)
  if (keep) {
    console.log('keep    the shipped artifact and its lock record were left alone')
    return
  }
  const artifactPath = join(REPO_ROOT, lock.artifact.path)
  copyFileSync(built, artifactPath)
  const bytes = statSync(artifactPath).size
  const sha256 = createHash('sha256').update(readFileSync(artifactPath)).digest('hex')
  lock.artifact.sha256 = sha256
  lock.artifact.bytes = bytes
  writeFileSync(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`artifact ${lock.artifact.path} (${bytes} bytes, sha256 ${sha256})`)
}

syncSource()
applyPatches()
build()
install()
console.log('done')