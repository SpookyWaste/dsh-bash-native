// Fetches the upstream agent preset this repository mirrors, so the drift alarm can run without a
// harness installed.
//
// Why this exists: `test-preset-parity.mjs` compares this plugin's copied preset body against the
// shipped `standard` preset, and a bundle patch cannot address rows inside an agent preset — so when
// upstream adds or removes a tool, only that check notices. It needs an upstream copy, and a CI runner
// has neither of the two local fallbacks: no globally installed harness, and `@deepseek-ai/dsh-web-app`
// is not a dependency of this package.
//
// Why not a devDependency: that package's own dependencies are the Web-app half of the harness (a dry
// run adds 239 packages), while the file needed here is one entry in its `files`. The single tarball is
// about 30 KB, and reading it needs no package manager: registry metadata for the dist-tag, then the
// tarball, then one entry out of it.
//
// Why the newest published version instead of a version: a pinned version and an in-repo snapshot fail
// the same way — the reference stops moving, so upstream drift is invisible until someone refreshes it by
// hand. The newest published version keeps the reference live: CI goes red on the run that first sees an
// upstream preset change, and the resolved version is printed with it, so the failure names what moved.
//
// Why not a dist-tag: upstream moves its newer line between tags, and the tag a repository picks can end
// up behind. Measured on 2026-10-09: `next` resolved to `0.2.0-rc.2` while the newest release was
// `0.2.1-alpha.1` under `alpha` — the parity check then compared this plugin's mirror against the older
// line and reported the rows this bundle gates in per host as extras. `latest` is no better (it is a stale
// `0.0.1-rc.1` placeholder for this package). Ranking the published versions keeps this reference on the
// newest line whatever the tags say; `--channel=` still pins one explicitly.
//
// Usage:
//   node scripts/fetch-upstream-preset.mjs                     print the fetched preset path
//   node scripts/fetch-upstream-preset.mjs --env               print `DSH_WEB_APP_PRESET=<path>` instead
//   node scripts/fetch-upstream-preset.mjs --channel=next      any dist-tag published for the package
//   node scripts/fetch-upstream-preset.mjs --registry=URL      a mirror, for a network that cannot reach npm
//
// The fetched copy stays in a temporary directory named after the resolved version, so a failing run
// reports which upstream version it compared against.
import { gunzipSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The package that ships the preset bodies. */
const PACKAGE = "@deepseek-ai/dsh-web-app";
/** The preset file inside that package this repository mirrors. */
const PRESET = "presets/standard.patch.yml";
/**
 * The lean preset the parity check compares beside it, when the tarball carries one.
 *
 * `test-preset-parity.mjs` reads it from the directory the located standard preset lives in, and skips that
 * half when it is absent — so fetching it is what makes the lean mirror a checked claim rather than a
 * silently skipped one.
 */
const LEAN_PRESET = "presets/minimal.patch.yml";

const arg = (name, fallback) => {
  const flag = process.argv.find((value) => value.startsWith(`--${name}=`));
  return flag === undefined ? fallback : flag.slice(name.length + 3);
};

/**
 * A failure that has already been reported to the user.
 *
 * The run ends by setting `process.exitCode` rather than calling `process.exit`: on Windows, exiting
 * while a `fetch` handle is still closing aborts Node itself (a libuv assertion) instead of reporting
 * the message this script just printed.
 */
class Reported extends Error {}

/** @param message - the failure to print. */
function fail(message) {
  console.error(message);
  throw new Reported(message);
}

// `fail` throws out of module evaluation; report only what has not been reported, and leave the exit
// status to the event loop instead of aborting Node with `process.exit` (which on Windows aborts with a
// libuv assertion while a fetch handle is still closing).
const report = (error) => {
  if (!(error instanceof Reported)) console.error(error);
  process.exitCode = 1;
};
process.on("unhandledRejection", report);
process.on("uncaughtException", report);

/**
 * Read one entry out of a `.tgz` — enough tar for a tarball npm produced.
 * @param archive - the gzipped tarball's bytes.
 * @param wanted - the entry path to extract, with a leading `package/`.
 * @returns the entry's text, or null when the tarball does not carry it.
 */
function readTarEntry(archive, wanted) {
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const name = tar.toString("utf8", offset, offset + 100).replace(/\0.*$/, "");
    const sizeField = tar.toString("utf8", offset + 124, offset + 136).replace(/\0.*$/, "").trim();
    const size = sizeField.length === 0 ? 0 : Number.parseInt(sizeField, 8);
    const body = offset + 512;
    if (name === wanted) return tar.toString("utf8", body, body + size);
    if (name.length === 0 && size === 0) return null;
    offset = body + Math.ceil(size / 512) * 512;
  }
  return null;
}

const channel = arg("channel", process.env.DSH_WEB_APP_CHANNEL);
const registry = arg("registry", "https://registry.npmjs.org").replace(/\/$/, "");
const asEnv = process.argv.includes("--env");
const metadataUrl = `${registry}/${PACKAGE.replace("/", "%2f")}`;

/**
 * Rank two published versions by semver precedence, so the default reference is the newest release rather
 * than whichever dist-tag was moved last.
 *
 * Numeric core fields compare numerically, a release outranks the prereleases of the same core, numeric
 * prerelease identifiers compare numerically (`alpha.10` after `alpha.9`), and alphanumerics compare as
 * text — the rules that decide which of a package's published versions is the one to mirror.
 * @param left - one version string.
 * @param right - another version string.
 * @returns a negative number when `left` precedes `right`, positive when it follows, zero when equal.
 */
function compareVersions(left, right) {
  const parse = (value) => {
    const [core, prerelease = ""] = value.split("-", 2);
    return { core: core.split(".").map(Number), prerelease: prerelease.split(".") };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  const released = a.prerelease[0] === "" || b.prerelease[0] === "";
  if (released) return a.prerelease[0] === b.prerelease[0] ? 0 : a.prerelease[0] === "" ? 1 : -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    if (aPart === bPart) continue;
    const numeric = /^\d+$/.test(aPart);
    const otherNumeric = /^\d+$/.test(bPart);
    if (numeric && otherNumeric) return Number(aPart) - Number(bPart);
    if (numeric !== otherNumeric) return numeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

let metadata;
try {
  const response = await fetch(metadataUrl, { headers: { accept: "application/vnd.npm.install-v1+json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  metadata = await response.json();
} catch (error) {
  fail(`${PACKAGE} metadata could not be read from ${metadataUrl}: ${error.message}`);
}

const published = Object.keys(metadata.versions ?? {});
const version =
  channel === undefined
    ? published.slice().sort(compareVersions).at(-1)
    : metadata["dist-tags"]?.[channel];
if (typeof version !== "string" || !published.includes(version)) {
  fail(
    channel === undefined
      ? `${PACKAGE} publishes no readable versions to mirror; its metadata lists ${published.length}`
      : `${PACKAGE} publishes no dist-tag \`${channel}\`; it has ${Object.keys(metadata["dist-tags"] ?? {}).join(", ")}`,
  );
}

const tarballUrl = metadata.versions?.[version]?.dist?.tarball;
if (typeof tarballUrl !== "string") {
  fail(`${PACKAGE}@${version} has no tarball in its registry metadata`);
}

let preset;
let lean;
try {
  const response = await fetch(tarballUrl);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const archive = Buffer.from(await response.arrayBuffer());
  preset = readTarEntry(archive, `package/${PRESET}`);
  lean = readTarEntry(archive, `package/${LEAN_PRESET}`);
} catch (error) {
  fail(`${tarballUrl} could not be read: ${error.message}`);
}

// A renamed or reshaped preset has to fail here rather than let the parity check compare nothing.
if (preset === null || !preset.includes("plugins")) {
  fail(`${PACKAGE}@${version} carries no usable ${PRESET}, so the parity check has nothing to compare against`);
}

const directory = join(mkdtempSync(join(tmpdir(), "dsh-bash-native-preset-")), version);
mkdirSync(directory, { recursive: true });
const path = join(directory, "standard.patch.yml");
writeFileSync(path, preset);
// The lean preset is written beside it when the tarball carries one; a build without it leaves the lean
// half of the check skipped, which the parity test says out loud.
if (lean !== null && lean.includes("plugins")) writeFileSync(join(directory, "minimal.patch.yml"), lean);
if (!existsSync(path) || readFileSync(path, "utf8").length === 0) {
  console.error(`the fetched preset was not written to ${path}`);
  process.exitCode = 1;
} else {
  // Stdout carries exactly one line — the answer — so a workflow can append it to `GITHUB_ENV` without
  // filtering; the version note goes to stderr, where a human still sees it.
  console.error(
    `note    ${PACKAGE}${channel === undefined ? "" : `@${channel}`} resolved to ${version} (${preset.length} bytes)` +
      `${channel === undefined ? ", the newest published version" : ""}`,
  );
  console.log(asEnv ? `DSH_WEB_APP_PRESET=${path}` : path);
}