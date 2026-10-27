// Verifies the toolchain probe and the PATH layering that puts a POSIX toolchain ahead of Windows.
//
// These are pure functions on purpose: whether `find` means the POSIX tool or `find.exe` is decided
// by PATH order, and that decision has to be testable on a machine with no toolchain installed.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { DEFAULT_FILE_COMMANDS_FROM_PATH, ENGINE_BUILTINS, ENGINE_FILE_COMMANDS, NOTABLE_ADDITIONS, SHELL_BUILTINS, TOOLCHAIN_COMMANDS, WINDOWS_IMPOSTORS, defaultRcFile, defaultToolsDir, emptyProbe, fileCommandsFromPath, prependPath, probeToolchain, rcFileContents } from "../lib/toolchain.js";
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
    fsListing(["grep", "find", "timeout", "nohup", "nice", "tty", "kill", "convert", "cat", "ls", "uname", "sed", "libstdbuf.dll", "stdout.txt"]),
  );
  assert.deepEqual(probe.provided, ["grep", "sed", "find", "timeout"], "provided keeps the contract's own order");
  assert.deepEqual(probe.shadows, ["find", "timeout"]);
  assert.deepEqual(probe.impostors, ["convert"], "an impostor in the listing is not shadowed by a POSIX one");
  assert.deepEqual(
    probe.additional,
    ["cat", "ls", "nice", "nohup", "tty"],
    "a known name, an impostor and a name the engine answers itself are never additions; a program the toolchain serves is",
  );
  assert.equal(probe.additional.includes("sed"), false, "a known name is not an addition");
  assert.equal(probe.additional.includes("cat"), true, "the engine no longer carries cat, so the toolchain's copy is an addition");
  assert.equal(probe.additional.includes("ls"), true, "the same rule covers every applet the engine stopped bundling");
  assert.equal(probe.additional.includes("uname"), false, "uname is the engine's own builtin, so a copy here is not advertised");
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
// carries none of the names the plugin's shim directory already puts on PATH: `find -exec`, `xargs` and
// `timeout` start a file, and for a shell face that file is the engine itself. A machine without a
// toolchain skips.
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
    for (const name of NOTABLE_ADDITIONS) {
      assert.equal(probe.additional.includes(name), true, `${name} is advertised but the probe does not report it as an addition`);
    }
    // The applets the engine stopped bundling are the toolchain's programs now, so the probe reports
    // them as additions rather than as names something else already answers.
    for (const name of ["cat", "ls", "rm", "basename", "sleep"]) {
      assert.equal(probe.additional.includes(name), true, `${name} is installed by the toolchain, so it is an addition`);
    }
    for (const name of [...ENGINE_BUILTINS, ...SHELL_BUILTINS, ...TOOLCHAIN_COMMANDS, ...WINDOWS_IMPOSTORS]) {
      assert.equal(probe.additional.includes(name), false, `${name} is answered another way, so it is not an addition`);
    }
    // The shim directory publishes the shell faces, so the farm must carry none of them: a second copy of
    // `bash` would be a second implementation to keep in step. The shell builtins are the opposite case:
    // no bundled utility stands behind them, and `xargs echo` still has to start something.
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
    pass(`the installed toolchain advertises ${advertised.length} programs and carries none of the names the shim publishes`);
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

// 6. The startup file a persistent session reads holds the PATH prepend and the file-command policy,
// quoted so a path containing a backslash, a dollar sign or a quote cannot be interpreted by the shell.
{
  const generated = "# Generated by dsh-bash-native: the POSIX toolchain leads PATH and answers the file commands named here.";
  assert.equal(rcFileContents(["C:\\tools\\bin"], ";"), [generated, "export PATH='C:\\tools\\bin'\";$PATH\""].join("\n") + "\n");
  assert.equal(rcFileContents(["/opt/tools"], ":").endsWith("export PATH='/opt/tools'\":$PATH\"\n"), true);
  assert.equal(rcFileContents(["C:\\it's\\bin"], ";").includes("'C:\\it'\\''s\\bin'"), true, "a quote in the path is escaped");
  assert.equal(rcFileContents(["C:\\tools"], ";").split("\n").length, 3, "a comment, the export, and one trailing newline");
  assert.equal(
    rcFileContents(["C:\\tools\\bin"], ";", ["sed", "rmdir"]),
    [generated, "export PATH='C:\\tools\\bin'\";$PATH\"", "export RUBASH_FILE_COMMANDS_FROM_PATH='sed,rmdir'"].join("\n") + "\n",
  );
  assert.equal(rcFileContents([], ";", ["sed"]).includes("export PATH="), false, "no PATH line without a directory");
  pass("the startup file states the toolchain prepend and the file-command policy with quoting that survives odd paths");
}

// 6b. The file-command policy names programs the toolchain publishes, and drops the rest.
{
  assert.equal(DEFAULT_FILE_COMMANDS_FROM_PATH.every((name) => ENGINE_FILE_COMMANDS.includes(name)), true, "the default names only engine commands");
  const probe = probeToolchain("X:\\tools\\bin", "win32", { isFile: () => false, listDirectory: () => ["sed", "rmdir", "cat"] });
  assert.deepEqual(fileCommandsFromPath(probe, ["sed", "rmdir"]), ["sed", "rmdir"], "a program the toolchain publishes is taken from PATH");
  assert.deepEqual(fileCommandsFromPath(probe, ["sed", "chmod", "mkfifo"]), ["sed"], "a program it cannot publish keeps the engine's copy");
  assert.deepEqual(fileCommandsFromPath(probe, ["sed", "sed"]), ["sed"], "duplicates collapse");
  assert.deepEqual(fileCommandsFromPath(emptyProbe(""), ["sed"]), [], "without a toolchain on PATH nothing is taken from it");
  pass("only programs the toolchain publishes on PATH are taken from PATH");
}

// 7. The startup file lives next to the per-user state, never inside a configured toolchain.
{
  assert.equal(defaultRcFile({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" }, "D:\\elsewhere"), join("C:\\Users\\x\\AppData\\Local", "dsh-bash-native", "bash-native-rc.sh"));
  assert.equal(defaultRcFile({}, "D:\\elsewhere\\bin"), join("D:\\elsewhere", "bash-native-rc.sh"), "without LOCALAPPDATA it sits beside the toolchain");
  assert.equal(defaultRcFile({}, ""), "");
  pass("the startup file path is derived, not assumed");
}

console.log(`\n${passed} 项通过`);
