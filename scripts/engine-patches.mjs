/**
 * The naming and selection rules for this repository's engine patches.
 *
 * They live here rather than inside `build-engine.mjs` so a test can exercise them without a Rust toolchain, a
 * git checkout or a network: these rules are the only part of a build that decides *which* diffs run, and a
 * mistake in them stays silent until the artifact misbehaves. `build-engine.mjs` applies the returned names in
 * exactly the order the lock lists them.
 */

/**
 * The version prefix a pin's patch files carry.
 *
 * The leading version of the tag without the `v` and the dots, so v1.5.0 → `150` and v1.4.3 → `143`. A
 * pre-release suffix is ignored: v1.5.0-rc1 is still the `150` set.
 * @param tag - the pin's tag, as `engine.lock.json` records it.
 * @returns the prefix every patch file of this pin starts with.
 */
export function patchPrefix(tag) {
  const version = /^v?(\d+(?:\.\d+)*)/.exec(tag)
  if (version === null) {
    throw new Error(`cannot derive a patch prefix from the pin tag ${JSON.stringify(tag)}; a tag has to start with a version like v1.5.0`)
  }
  return version[1].replaceAll('.', '')
}

/**
 * Checks that one pin's patch files are exactly the ones `engine.lock.json` lists, and returns them in lock order.
 *
 * Three mistakes are worth naming here rather than letting `git apply` explain them: a listed file that is gone,
 * a file the lock does not list (a retired patch left behind would be applied to code it no longer describes),
 * and a file whose name does not carry this pin's prefix (a set for another engine version).
 * @param options - the pin tag, the names the lock lists, the names the directory holds, and the directory's label.
 * @returns the patch file names to apply, in the order the lock lists them.
 */
export function selectEnginePatches({ tag, listed, present, directory = 'the patch directory' }) {
  const prefix = patchPrefix(tag)
  const missing = listed.filter((name) => !present.includes(name))
  if (missing.length > 0) {
    throw new Error(`${directory} does not hold the patches engine.lock.json lists: ${missing.join(', ')}`)
  }
  const extra = present.filter((name) => !listed.includes(name))
  if (extra.length > 0) {
    throw new Error(`${directory} holds patches this pin does not list (a retired patch is deleted, not kept): ${extra.join(', ')}`)
  }
  const misnamed = listed.filter((name) => !name.startsWith(`${prefix}-`))
  if (misnamed.length > 0) {
    throw new Error(`every patch of ${tag} has to start with ${prefix}-: ${misnamed.join(', ')}`)
  }
  return [...listed]
}