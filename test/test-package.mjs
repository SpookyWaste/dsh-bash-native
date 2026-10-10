// What a user actually installs: pack this repository, unpack the tarball, and drive the package from
// there — the engine, the toolchain, the `bash`/`sh` names and the argv the executor builds.
//
// Why this exists as its own suite: every other test loads `lib/` from the checkout, where `src/`,
// `scripts/`, `corpus/` and all devDependencies are present. A mistake in `package.json`'s `files`
// allowlist is therefore invisible to them and ships silently, while it is the one failure a user meets
// first. This suite needs no engine on PATH and no network: it uses the artifact the package carries.
//
// The extraction is done here with `node:zlib` and a ustar reader rather than by calling `tar`, so the gate
// has no external dependency and refuses (loudly) anything it does not understand instead of unpacking a
// partial tree.
//
// Everything it creates lives inside `.package-check/` (gitignored, removed in a `finally`) plus one
// temporary directory for the tarball, so a run leaves the checkout as it found it.
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const CHECK = join(REPO, ".package-check");
const STAGE = join(CHECK, "run");
const HOME = join(CHECK, "home");

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

/** Run a program with file-backed stdio, which is the only shape a confined session allows. */
function runCapture(program, args, options = {}) {
  mkdirSync(STAGE, { recursive: true });
  const outPath = join(STAGE, "out.txt");
  const errPath = join(STAGE, "err.txt");
  const out = openSync(outPath, "w");
  const err = openSync(errPath, "w");
  try {
    const result = spawnSync(program, args, {
      cwd: options.cwd ?? REPO,
      env: options.env ?? process.env,
      stdio: ["ignore", out, err],
      windowsHide: true,
      timeout: options.timeout ?? 120_000,
      killSignal: "SIGKILL",
    });
    return {
      status: result.status,
      error: result.error,
      stdout: readFileSync(outPath, "utf8"),
      stderr: readFileSync(errPath, "utf8"),
    };
  } finally {
    closeSync(out);
    closeSync(err);
  }
}

/** Unpack a ustar archive, refusing entry types this reader does not implement. */
function untar(buffer, destination) {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString("utf8").replace(/\0.*$/, "");
    const name = field(0, 100);
    const prefix = field(345, 500);
    const full = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = Number.parseInt(field(124, 136).replace(/[^0-7]/g, ""), 8);
    const type = String.fromCharCode(header[156]);
    assert.equal(Number.isNaN(size), false, `unreadable tar header for ${full}`);
    const data = buffer.subarray(offset + 512, offset + 512 + size);
    if (type === "0" || type === "\0") {
      const target = join(destination, full);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      entries.push(full);
    } else if (type === "5") {
      mkdirSync(join(destination, full), { recursive: true });
    } else {
      throw new Error(`this reader does not implement tar entry type ${JSON.stringify(type)} (${full})`);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** `npm pack` from wherever npm is: the CLI entry when npm started this suite, a shell otherwise. */
function pack(destination) {
  const cache = join(REPO, ".npm-cache");
  const args = ["pack", "--pack-destination", destination, "--cache", cache, "--json"];
  // The outer npm's configuration must not reach the nested one: `npm publish --dry-run` exports
  // `npm_config_dry_run=true`, which would turn this pack into a no-op and fail the gate for the wrong
  // reason. The suite wants a real tarball, so only the flags above apply.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith("npm_config_")),
  );
  const cli = process.env.npm_execpath ?? "";
  if (cli.endsWith(".js") || cli.endsWith(".cjs") || cli.endsWith(".mjs")) {
    return runCapture(process.execPath, [cli, ...args], { env });
  }
  const line = ["npm", ...args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg))].join(" ");
  return runCapture(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", line], { env });
}

rmSync(CHECK, { recursive: true, force: true });
mkdirSync(HOME, { recursive: true });
const tarballDir = mkdtempSync(join(tmpdir(), "dsh-package-"));
let failures = 0;
const check = (name, ok, detail) => {
  if (ok) return pass(name);
  failures += 1;
  console.log(`FAIL  ${name}${detail === undefined ? "" : ` — ${detail}`}`);
};

try {
  const packed = pack(tarballDir);
  assert.equal(packed.error, undefined, `npm pack could not be started: ${String(packed.error)}`);
  assert.equal(packed.status, 0, `npm pack failed:\n${packed.stderr}`);
  const parsed = JSON.parse(packed.stdout);
  const report = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const tarball = join(tarballDir, report.filename);
  const names = untar(gunzipSync(readFileSync(tarball)), CHECK);
  const files = names.filter((name) => name.startsWith("package/")).map((name) => name.slice("package/".length));
  const listed = report.files.map((entry) => entry.path);
  check(
    "the reader and npm agree on the packed file list",
    listed.length === files.length && listed.every((name) => files.includes(name)),
    `${listed.length} listed, ${files.length} unpacked`,
  );

  // 1. The allowlist carries everything the runtime opens, and nothing the repository keeps to itself.
  {
    const required = [
      "package.json",
      "cordis.patch.yml",
      "README.md",
      "README.en.md",
      "LICENSE",
      "overlays/single-agent-bash-native.yml",
      "engine.lock.json",
      "engine/win32-x64/brush.exe",
      "toolchain/win32-x64/manifest.json",
      "lib/index.js",
      "lib/argv.js",
      "lib/shim.js",
      "lib/presets.js",
      "lib/preset-data.js",
      "lib/types/index.d.ts",
      "lib/types/presets.d.ts",
      "lib/types/terminal.d.ts",
      // The Plugins page reads a component's display text from `<entry name>/locale/<lang>.json`, so a
      // dropped file shows up as the component losing its title and description in the GUI rather than
      // as anything the host reports.
      "terminal/locale/en.json",
      "terminal/locale/zh.json",
      "presets/locale/en.json",
      "presets/locale/zh.json",
    ];
    const missing = required.filter((name) => !files.includes(name));
    check("the tarball carries every file the runtime needs", missing.length === 0, `missing ${missing.join(", ")}`);
    // The bundle patch mounts `dsh-bash-native/presets`, so the export map and the allowlist have to
    // agree: a subpath pointing at a file the allowlist dropped fails at mount time, on the user's machine.
    const packedManifest = JSON.parse(readFileSync(join(CHECK, "package", "package.json"), "utf8"));
    const entryPaths = Object.entries(packedManifest.exports)
      .map(([key, value]) => [key, String(value.default ?? "").replace(/^\.\//, "")])
      .filter(([, path]) => path.length > 0);
    const dangling = entryPaths.filter(([, path]) => !files.includes(path));
    check(
      "every published export points at a file the tarball carries",
      dangling.length === 0 && entryPaths.length === 3,
      dangling.length > 0 ? dangling.map(([key, path]) => `${key} -> ${path}`).join(", ") : `${entryPaths.length} entries`,
    );
    // The display-text resources are reached through export patterns rather than by name, and a pattern
    // that stopped covering them would leave the GUI silently falling back to no metadata at all.
    for (const pattern of ["./presets/*", "./terminal/*"]) {
      check(
        `the export map publishes ${pattern}`,
        typeof packedManifest.exports[pattern] === "string",
        `got ${JSON.stringify(packedManifest.exports[pattern])}`,
      );
    }
    const leaked = files.filter(
      (name) =>
        name.startsWith("src/") ||
        name.startsWith("patches/") ||
        name.startsWith("corpus/") ||
        name.startsWith("scripts/") ||
        name.startsWith("test/"),
    );
    check("the tarball carries no repository-only tree", leaked.length === 0, `leaked ${leaked.join(", ")}`);
    // The two halves are shipped and nothing else of `docs/`: the manual and the research notes are
    // repository reading, they are not needed at run time, and their links point at trees this tarball does
    // not carry. Should that change, this case is the one to move.
    check("the tarball ships the READMEs and no other document", files.some((name) => name.startsWith("docs/")) === false, files.filter((name) => name.startsWith("docs/")).join(", "));
    const modules = readdirSync(join(REPO, "lib")).filter((name) => name.endsWith(".js"));
    const missingModules = modules.filter((name) => !files.includes(`lib/${name}`));
    check("the tarball carries every module in lib/", missingModules.length === 0, `missing ${missingModules.join(", ")}`);
  }

  // 2. The extracted package prepares its own artifacts.
  const pkg = join(CHECK, "package");
  const env = { ...process.env, LOCALAPPDATA: HOME };
  const { packageRoot, preparePackagedEngine } = await import(pathToFileURL(join(pkg, "lib", "artifact.js")).href);
  const { preparePackagedToolchain } = await import(pathToFileURL(join(pkg, "lib", "toolchain-artifact.js")).href);
  const { prepareShellNames } = await import(pathToFileURL(join(pkg, "lib", "shim.js")).href);
  const { buildCommandArgv } = await import(pathToFileURL(join(pkg, "lib", "argv.js")).href);

  check("packageRoot() names the unpacked package", packageRoot().replace(/[\\/]+$/, "").toLowerCase() === pkg.toLowerCase());
  const lock = JSON.parse(readFileSync(join(pkg, "engine.lock.json"), "utf8"));
  const engine = preparePackagedEngine({ packageRoot: packageRoot(), env });
  check("the engine is prepared", "ready" in engine, "refused" in engine ? engine.refused : "");
  check("the packaged engine matches engine.lock.json", "ready" in engine && engine.sha256 === lock.artifact.sha256);
  check(
    "the engine is the packaged file itself, with no copy under LOCALAPPDATA",
    "ready" in engine && engine.ready === join(packageRoot(), lock.artifact.path) && existsSync(join(HOME, "dsh-bash-native", "engine")) === false,
    "ready" in engine ? engine.ready : "",
  );
  const toolchain = preparePackagedToolchain({ packageRoot: packageRoot(), env });
  check("the packaged toolchain materializes outside the package", "ready" in toolchain && !toolchain.ready.startsWith(pkg) && existsSync(toolchain.ready));
  const shimDir = prepareShellNames({ engine: engine.ready, sha256: engine.sha256, env });
  check("bash and sh are prepared as hard links to the verified engine", shimDir.length > 0 && existsSync(join(shimDir, "bash.exe")) && existsSync(join(shimDir, "sh.exe")));
  check("a second preparation reuses the names", prepareShellNames({ engine: engine.ready, sha256: engine.sha256, env }) === shimDir);

  // 3. The argv the shipped executor builds, and the diagnostics it produces.
  const argv = buildCommandArgv({ path: engine.ready, label: "packaged", version: "", args: ["-c"], interactiveArgs: [] }, "echo hi");
  check("the shipped command argv carries --disable-color", argv[1] === "--disable-color" && argv[2] === "-c", JSON.stringify(argv.slice(0, 3)));

  // 4. Real commands through the shipped engine with the shipped toolchain on PATH.
  const toolchainDir = "ready" in toolchain ? toolchain.ready : "";
  const basePath = (process.env.PATH ?? "").split(";").filter((segment) => segment.length > 0 && !segment.toLowerCase().includes("dsh-bash-native"));
  const shellPath = [toolchainDir, shimDir, ...basePath].join(";");
  const cwd = join(STAGE, "work");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "in.txt"), "aaa\n");
  writeFileSync(join(cwd, "probe.sh"), "echo probe $1\n");
  const shell = (command) =>
    runCapture(engine.ready, ["--disable-color", "-c", command], { cwd, env: { ...env, PATH: shellPath } });
  const checkRun = (name, command, want) => {
    const result = shell(command);
    if (result.status === null) return check(name, false, "timed out");
    const stdout = result.stdout.replace(/\r\n/g, "\n");
    check(name, stdout === want, `status ${result.status}, stdout ${JSON.stringify(stdout)}, stderr ${JSON.stringify(result.stderr.split("\n")[0])}`);
  };

  checkRun("echo", "echo hello", "hello\n");
  checkRun("awk from the packaged toolchain", "awk 'BEGIN{print \"awk-ok\"}'", "awk-ok\n");
  checkRun("sed from the packaged toolchain", "sed s/aaa/bbb/ in.txt", "bbb\n");
  checkRun("grep from the packaged toolchain", "grep -c aaa in.txt", "1\n");
  checkRun("xargs from the packaged toolchain", "printf \"x\\ny\\n\" | xargs -n1 echo", "x\ny\n");
  checkRun("seq and tr from the bundled utilities", "seq 1 3 | tr \"\\n\" \",\"", "1,2,3,");
  checkRun("stat from the packaged toolchain", "stat -c \"%F\" in.txt", "regular file\n");
  checkRun("uname from the bundled utilities", "uname -s", "Windows_NT\n");
  // One implementation, two ways in: the farm no longer publishes a utility the engine already bundles, so a
  // direct `rm` (the builtin) and one a child process execs by name (through the shim) have to be the same
  // implementation, and both have to refuse an operand whose trailing separator says "directory".
  check(
    "a bundled name in the shim is the engine itself",
    (() => {
      try {
        const link = statSync(join(shimDir, "rm.exe"));
        const target = statSync(engine.ready);
        return link.ino === target.ino && link.size === target.size;
      } catch {
        return false;
      }
    })(),
    "rm.exe is a hard link to the verified engine",
  );
  writeFileSync(join(cwd, "rmprobe.txt"), "x\n");
  checkRun("the builtin rm refuses a trailing separator on a file", "rm -r rmprobe.txt/ 2>/dev/null; test -f rmprobe.txt && echo survived", "survived\n");
  checkRun("a child process reaches that same rm by name", "printf \"rmprobe.txt/\\n\" | xargs rm -r 2>/dev/null; test -f rmprobe.txt && echo survived", "survived\n");
  checkRun("bash from the prepared names", "bash -c \"echo via-bash\"", "via-bash\n");
  checkRun("sh from the prepared names", "sh -c \"echo via-sh\"", "via-sh\n");
  checkRun("a script by name", "sh probe.sh arg1", "probe arg1\n");
  checkRun("a compound stage on the left of a pipe", "for i in $(seq 1 20000); do echo x; done | head -1", "x\n");
  checkRun("a function stage on the left of a pipe", "f() { for i in $(seq 1 20000); do echo x; done; }; f | head -1", "x\n");
  checkRun("lastpipe off by default, on when asked", "echo hello | read v; printf \"plain=[%s] \" \"$v\"; shopt -s lastpipe; echo hello | read w; echo \"lastpipe=[$w]\"", "plain=[] lastpipe=[hello]\n");
  checkRun("a relative command path", "cp \"$(command -v find)\" relfind.exe && ./relfind.exe --version | head -1 | sed \"s/ .*//\"", "find\n");
  checkRun("a nested relative command path", "mkdir -p sub && cp \"$(command -v find)\" sub/relfind.exe && ./sub/relfind.exe --version | head -1 | sed \"s/ .*//\"", "find\n");
  {
    const result = shell("./definitely-missing-tool 2>&1; echo rc=$?");
    check(
      "a missing relative command keeps the caller's wording",
      result.stdout.includes("command not found: ./definitely-missing-tool") && result.stdout.includes("rc=127"),
      JSON.stringify(result.stdout),
    );
    // This diagnostic is one of the colored ones (measured), so it is the shape that proves the flag works.
    check(
      "a failure reaches the model without escape bytes",
      result.stdout.includes("\u001b") === false && result.stderr.includes("\u001b") === false,
      JSON.stringify(result.stdout.slice(0, 60)),
    );
  }

  // 5. The documented shebang gap is still a gap: reported, never a failure here (the README owns it).
  const shebang = shell("./probe.sh");
  console.log(`NOTE  ./probe.sh: status ${shebang.status}, stderr ${JSON.stringify(shebang.stderr.trim().split("\n").pop() ?? "")} (documented limitation)`);
} finally {
  rmSync(tarballDir, { recursive: true, force: true });
  rmSync(CHECK, { recursive: true, force: true });
}

console.log(`\n${passed} 项通过${failures === 0 ? "" : `，${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
