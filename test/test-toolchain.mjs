// Verifies the toolchain probe and the PATH layering that puts a POSIX toolchain ahead of Windows.
//
// These are pure functions on purpose: whether `find` means the POSIX tool or `find.exe` is decided
// by PATH order, and that decision has to be testable on a machine with no toolchain installed.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { NOTABLE_ADDITIONS, SHELL_BUILTINS, TOOLCHAIN_COMMANDS, WINDOWS_IMPOSTORS, defaultRcFile, defaultToolsDir, emptyProbe, prependPath, probeToolchain, rcFileContents } from "../lib/toolchain.js";
import { SHIM_NAMES } from "../lib/shim.js";

let passed = 0;
function pass(name) {
  passed += 1;
  console.log("PASS  " + name);
}

/** A filesystem that reports exactly the paths it was given and cannot list directories. */
const fsWith = (...paths) => ({ isFile: (candidate) => paths.includes(candidate), listDirectory: () => null });

/** A filesystem that reports a directory listing, which is how the production probe sees a toolchain. */
const fsListing = (names) => ({ isFile: () => false, listDirectory: () => names });

// 1. Probing an empty directory reports everything as absent and every impostor as dangerous.
{
  const probe = probeToolchain("", "win32", fsWith());
  assert.deepEqual(probe.provided, []);
  assert.deepEqual(probe.absent, [...TOOLCHAIN_COMMANDS]);
  assert.deepEqual(probe.impostors, [...WINDOWS_IMPOSTORS]);
  assert.deepEqual(emptyProbe("X:\\tools").provided, []);
  pass("an absent toolchain provides nothing and leaves every Windows impostor dangerous");
}

// 2. A probe reads `<dir>\<name>.exe` on Windows and reports what it shadows.
{
  const dir = "X:\\tools\\bin";
  const probe = probeToolchain(dir, "win32", fsWith(`${dir}\\grep.exe`, `${dir}\\find.exe`, `${dir}\\timeout.exe`));
  assert.deepEqual(probe.provided, ["grep", "find", "timeout"]);
  assert.deepEqual(probe.shadows, ["find", "timeout"]);
  assert.deepEqual(probe.impostors, ["convert"], "an unshadowed impostor stays dangerous");
  assert.ok(probe.absent.includes("sed"));
  assert.ok(!probe.absent.includes("grep"));
  pass("a probe reports provided commands and the Windows impostors they shadow");
}

// 3. The same directory on a non-Windows platform carries no executable suffix.
{
  const dir = "/opt/tools";
  const probe = probeToolchain(dir, "linux", fsWith("/opt/tools/sed"));
  assert.deepEqual(probe.provided, ["sed"]);
  pass("probing uses the platform's executable suffix");
}

// 4. A readable listing answers both questions: which known names are there, and what else is — counting
// only executables, so a companion library or a stray capture file cannot become a command.
{
  const dir = "X:\\tools\\bin";
  const probe = probeToolchain(
    dir,
    "win32",
    fsListing(["grep", "find", "timeout", "nohup", "nice", "tty", "kill", "convert", "cat", "ls", "sed", "libstdbuf.dll", "stdout.txt"]),
  );
  assert.deepEqual(probe.provided, ["grep", "sed", "find", "timeout"], "provided keeps the contract's own order");
  assert.deepEqual(probe.shadows, ["find", "timeout"]);
  assert.deepEqual(probe.impostors, ["convert"], "an impostor in the listing is not shadowed by a POSIX one");
  assert.deepEqual(
    probe.additional,
    ["nice", "nohup", "tty"],
    "a known name, an impostor, a shell builtin and every name the engine already answers are never additions",
  );
  assert.equal(probe.additional.includes("sed"), false, "a known name is not an addition");
  assert.equal(probe.additional.includes("cat"), false, "a name the engine answers with a builtin is not an addition");
  assert.equal(probe.additional.includes("ls"), false, "the rule follows the engine's capability list, not a hand-kept trio");
  assert.equal(probe.additional.includes("kill"), false, "the shadowed kill is not an addition");
  assert.equal(probe.additional.includes("libstdbuf"), false, "a companion library is not a program");
  assert.equal(probe.additional.includes("stdout"), false, "a capture file is not a program");
  pass("a directory listing yields the known commands and every other program");
}

// 5. An unreadable listing degrades to probing the known names, instead of reporting an empty toolchain.
{
  const dir = "X:\\tools\\bin";
  const probe = probeToolchain(dir, "win32", fsWith(`${dir}\\grep.exe`));
  assert.deepEqual(probe.provided, ["grep"]);
  assert.deepEqual(probe.additional, []);
  pass("an unreadable listing still resolves the known commands");
}

// 6. The installed toolchain carries every advertised program, holds no name this build cannot run, and
// carries none of the utilities the engine answers by name: `find -exec`, `xargs` and `timeout` start a file,
// and for a bundled utility that file is the engine itself. A machine without a toolchain skips.
{
  const dir = process.env.DSH_BASH_NATIVE_TOOLS ?? defaultToolsDir(process.env, "win32");
  if (dir.length === 0 || !existsSync(dir)) {
    console.log("SKIP  no toolchain installed at the per-user directory");
  } else {
    const advertised = [...TOOLCHAIN_COMMANDS, ...NOTABLE_ADDITIONS];
    const probe = probeToolchain(dir, "win32", {
      isFile: (candidate) => existsSync(candidate),
      listDirectory: (path) => readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name),
    });
    assert.deepEqual(probe.provided, [...TOOLCHAIN_COMMANDS], `missing: ${probe.absent.join(" ")}`);
    assert.deepEqual(
      probe.additional,
      [...NOTABLE_ADDITIONS].sort(),
      `advertised but not installed: ${probe.additional.filter((name) => !NOTABLE_ADDITIONS.includes(name)).join(" ")}; installed but not advertised: ${NOTABLE_ADDITIONS.filter((name) => !probe.additional.includes(name)).join(" ")}`,
    );
    // The engine answers its bundled utilities by name now (patch `0016`, published by the plugin's shim
    // directory), so the farm must carry none of them: a copy here would be a second implementation of the
    // same utility to keep in step. The shell builtins are the exception that keeps needing a file, because
    // no bundled utility stands behind them and `xargs echo` still has to start something.
    const duplicated = SHIM_NAMES.filter((name) => existsSync(join(dir, `${name}.exe`)));
    assert.deepEqual(duplicated, [], `the farm carries a name the engine answers, so two implementations of it exist: ${duplicated.join(" ")}`);
    for (const name of SHELL_BUILTINS) {
      assert.equal(
        existsSync(join(dir, `${name}.exe`)),
        true,
        `${name} is a shell builtin with no bundled utility behind it, so a child process needs the farm's copy`,
      );
    }
    assert.equal(existsSync(join(dir, "stdbuf.exe")), false, "stdbuf cannot work in this build, so withholding it means it must not be installed either");
    pass(`the installed toolchain advertises ${advertised.length} programs and carries no utility the engine answers itself`);
  }
}

// 4. The per-user directory is only offered on Windows and only with a LOCALAPPDATA.
{
  assert.equal(defaultToolsDir({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "win32"), join("C:\\Users\\x\\AppData\\Local", "dsh-bash-native", "tools", "bin"));
  assert.equal(defaultToolsDir({ LOCALAPPDATA: "C:\\x" }, "linux"), "");
  assert.equal(defaultToolsDir({}, "win32"), "");
  pass("the per-user toolchain directory is a Windows-only default");
}

// 5. Prepending removes an existing occurrence, so repeated layering cannot grow PATH.
{
  const dir = "X:\\tools\\bin";
  const base = ["C:\\Windows", dir, "C:\\Other"].join(delimiter);
  assert.equal(prependPath(dir, base, delimiter), [dir, "C:\\Windows", "C:\\Other"].join(delimiter));
  assert.equal(prependPath(dir, dir, delimiter), dir, "a PATH that is only the toolchain stays that way");
  assert.equal(prependPath("", base, delimiter), base, "an empty directory leaves PATH alone");
  assert.equal(prependPath(dir, "", delimiter), dir);
  pass("prepending a directory keeps PATH idempotent");
}

// 6. The startup file a persistent session reads holds only the PATH prepend, quoted so a path
// containing a backslash, a dollar sign or a quote cannot be interpreted by the shell.
{
  assert.equal(
    rcFileContents(["C:\\tools\\bin"], ";"),
    "# Generated by dsh-bash-native: put the POSIX toolchain ahead of the same-named Windows programs.\nexport PATH='C:\\tools\\bin'\";$PATH\"\n",
  );
  assert.equal(rcFileContents(["/opt/tools"], ":").endsWith("export PATH='/opt/tools'\":$PATH\"\n"), true);
  assert.equal(rcFileContents(["C:\\it's\\bin"], ";").includes("'C:\\it'\\''s\\bin'"), true, "a quote in the path is escaped");
  assert.equal(rcFileContents(["C:\\tools"], ";").split("\n").length, 3, "a comment, the export, and one trailing newline");
  pass("the startup file prepends the toolchain with quoting that survives odd paths");
}

// 7. The startup file lives next to the per-user state, never inside a configured toolchain.
{
  assert.equal(defaultRcFile({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "D:\\elsewhere"), join("C:\\Users\\x\\AppData\\Local", "dsh-bash-native", "bash-native-rc.sh"));
  assert.equal(defaultRcFile({}, "D:\\elsewhere\\bin"), join("D:\\elsewhere", "bash-native-rc.sh"), "without LOCALAPPDATA it sits beside the toolchain");
  assert.equal(defaultRcFile({}, ""), "");
  pass("the startup file path is derived, not assumed");
}

console.log(`\n${passed} 项通过`);
