<!-- ═══════════════════════════════════════════════════════════════════════ -->

<div align="center">

# 🐚 dsh-bash-native

### A native POSIX bash on Windows, written in Rust

**Give DSH's shell a genuinely native `bash`** — the rubash engine, with no WSL and no MSYS compatibility layer

<br>

`Follows the three-tier file policy` · `Background jobs` · `Persistent terminals`

<br>

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/zh/plugins/spookywaste/dsh-bash-native)
[![npm downloads](https://img.shields.io/npm/dm/dsh-bash-native.svg)](https://www.npmjs.com/package/dsh-bash-native)
[![npm](https://img.shields.io/npm/v/dsh-bash-native?logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-bash-native)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%20--%200.2.1--rc.3-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Powered by rubash](https://img.shields.io/badge/powered%20by-rubash-64CEF7)](https://github.com/unixwin/rubash)

[**中文**](README.md) &nbsp;·&nbsp; **English**

</div>

---

## 🐟 Why it exists

> ~~So the fat fish stops getting bitten by cmd~~, and without the performance cost of a subsystem or an MSYS layer

**0.3.1**: the engine moved from `brush` to `rubash`, fixing a list of known defects and offering better native POSIX compatibility

<p align="center">
  <img src="img/example0.jpg" width="240">
</p>

<table align="center">
  <thead>
    <tr>
      <th align="left">Approach</th>
      <th align="left">Where the command runs</th>
      <th align="left">Cost per command</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Git for Windows</b></td>
      <td>A bash ported onto the MSYS2 layer; POSIX semantics are emulated by the runtime</td>
      <td>Every subshell or external command forks a whole MSYS2 process (suspend threads, spawn a process, shovel memory through a pipe), and the cost grows with how often subshells start</td>
    </tr>
    <tr>
      <td><b>WSL</b></td>
      <td>The command runs in a Linux distribution inside a VM</td>
      <td>Every command crosses the Windows/Linux boundary twice; the latency hurts most on many short commands</td>
    </tr>
    <tr>
      <td><b>This plugin</b><br><sub>rubash engine + toolchain</sub></td>
      <td>Native binaries written in Rust, with no emulation layer and no VM</td>
      <td><code>grep</code>, <code>sed</code>, <code>awk</code> and friends come from the bundled toolchain; the rest runs in the engine's own process, with no compatibility layer or VM boundary</td>
    </tr>
  </tbody>
</table>

### ⚡ Measured: the cost of a startup and a subshell

The same scripts on the same machine (Windows 11 / x64), minimum of five runs each, using only shell builtins and one external spawn so the toolchains do not enter the comparison.
> Reproduce with `node scripts/bench-engines.mjs` from the repository.

| Workload | rubash (this plugin) | Git Bash / MSYS2 |
|---|---:|---:|
| `bash -c :` (start to exit) | 7 ms | 25 ms |
| `echo hi` | 6 ms | 26 ms |
| arith loop 10k | 65 ms | 75 ms |
| `[ ]` 20k | 167 ms | 181 ms |
| command sub 300 | 11 ms | **3052** ms |
| subshell 300 | 25 ms | **2497** ms |
| external spawn 20 (`cmd /c exit`) | 192 ms | 560 ms |

The gap comes from **fork**: every command substitution and subshell under MSYS2 forks an emulation-layer process (about 8–10 ms), while rubash keeps both in-process (about 0.04 ms each), which is two to three seconds over 300 runs.

### 🧭 Paths are not silently rewritten

Git Bash / MSYS2 **guesses** which arguments look like paths when it hands them to a **native** program and rewrites them (`/flag` becomes `C:/Program Files/Git/flag`, so scripts and agents have to remember `MSYS_NO_PATHCONV=1`); data words are rewritten too: run `awk '/x/{print}'` through MSYS against a native `awk.exe` and the program word arrives as `X:/{print}`, a syntax error and the wrong path.
> rubash does not guess: per child dialect, a whole argv is either passed verbatim to a program that owns a POSIX layer or uniformly translated to Win32 spellings, and the scripts, patterns and program words of the shipped tools are never rewritten, which removes most of the wrong-path cases.

---

## 📦 Install

### From the CLI

> Take the `web` profile as an example

```
dsh plugin --profile web add dsh-bash-native
```

### From the dsh web or desktop app

> **dsh plugins page** → **Add plugin** (top right) → enter the name `dsh-bash-native` or the repository URL:

```
https://github.com/SpookyWaste/dsh-bash-native
```

After a restart, set **Native Bash (Windows)** as the default preset under **Settings → General** (or switch to it inside a session).

> The persistent-terminal component is **off by default**; turn it on in the plugin manager. See [the persistent-terminal component](#-persistent-terminal-component).

<table>
  <tbody>
    <tr>
      <td><b>Platform</b></td>
      <td>Windows x64</td>
    </tr>
    <tr>
      <td><b>DSH</b></td>
      <td><code>&gt;=0.2.0-rc.2 &lt;0.3.0-0</code> (0.2.0-rc.2 - 0.2.1-rc.3 tested)</td>
    </tr>
    <tr>
      <td><b>Persistent-terminal component</b></td>
      <td>Needs DSH <code>&gt;=0.2.1-alpha.1</code> to be enabled</td>
    </tr>
  </tbody>
</table>

---

## ⚙️ Engine

The engine is **rubash** ([`unixwin/rubash`](https://github.com/unixwin/rubash), a bash-5.3-compatible shell written in Rust, MIT). This repository builds it from source, applies three patches at the commit pinned in `engine.lock.json`, and ships the result as `engine/win32-x64/rubash.exe` (about 11 MB).

> Compatible with the **MSYS `uname -s` identity** (`MSYS_NT-…`), so scripts that branch on MSYS keep working; concurrency, cancellation and job semantics are the engine's own and depend on no MSYS runtime.

<details>
<summary><b>🧩 Patch list (click to expand)</b></summary>

<br>

<table>
  <thead>
    <tr>
      <th align="left">Patch</th>
      <th align="left">What it does</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>0001-data-primary-positions-every-child</code></td>
      <td>Extends the <b>data-position</b> rule from POSIX-aware children to <b>every</b> child: a grep/sed/awk pattern, script or program, find's pattern primaries, and basename/dirname's positional text reach the program verbatim, while file operands are still translated to their Windows spelling.</td>
    </tr>
    <tr>
      <td><code>0002-drop-undecodable-environment-entries</code></td>
      <td>Drops environment entries Windows can hand a process but Unicode cannot represent (<code>std::env::vars()</code> panics on one) before anything reads the environment, so the cost is that one variable instead of every command aborting.</td>
    </tr>
    <tr>
      <td><code>0003-file-commands-from-path</code></td>
      <td>Adds <code>RUBASH_FILE_COMMANDS_FROM_PATH</code>: the shell names the in-process file commands that should run from a program on <code>PATH</code> instead (<code>all</code>, <code>none</code>, or a list), read from the shell's own variables so an <code>--rcfile</code> can set it; it also makes the inline pipeline arms honour the host's switch for turning the in-process copies off.</td>
    </tr>
  </tbody>
</table>

</details>

> 💡 Every resolution verifies the artifact against the **sha256** in the lock, and a **stamp** skips the repeated work: the artifact's size and mtime go into `%LOCALAPPDATA%\dsh-bash-native\verified\`, and while they are unchanged those 11 MB are not read again (`verifyArtifacts: 'always'` restores hashing on every resolution).

---

## 🔧 Implementation

- **Registers `ctx.shell`**: a `ShellExecutor` Service Provider built on `@deepseek-ai/dsh-bash-local` that hands every command to the resolved rubash engine. **Both the engine and the toolchain ship with the package** and are verified against the lock and the manifest at resolution.
- **Follows DSH's three-tier file policy** (`read-only` / `workspace-write` / `danger-full-access`): a confined tier hands the engine argv to `ctx.sandbox`, the unconfined tier spawns it directly and reports the tier truthfully.
- **Background jobs are reported through `ctx.jobs`**, output beyond the memory budget spills to a file whose path comes back with the result, and commands keep working with an empty `PATH` because the bundled toolchain goes in front of the host `PATH`.
- The **web plumbing** is mounted by the shipped agent presets and the **agent plumbing** is enabled by an explicit overlay; the host's own `ctx.shell` is untouched, so other presets keep their `pwsh` tools.

---

## 🎛 Two presets<sub>0.2.0: static mounting became a replacement of the shipped presets</sub>

[`cordis.patch.yml`](cordis.patch.yml) carries **one registrar line** (`dsh-bash-native/presets`), and the plugin registers both presets at runtime: it reads the **locally installed** `presets/{standard,minimal}.patch.yml` and replaces the shell surface with its own realm group. Each realm is `isolate: { shell: true, terminals: true }`, so the host layer and every other preset (including the `pwsh` ones) are untouched.

<table>
  <thead>
    <tr>
      <th align="left">Preset</th>
      <th align="left">What it mounts</th>
      <th align="left">When to pick it</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Native Bash (Windows)</b><br><sub>id <code>bash-native</code>, order 5</sub></td>
      <td>Reads the local harness line's <code>standard</code> and replaces only the shell surface: every call is a fresh <code>bash</code>, while files, jobs and delegation follow that upstream version</td>
      <td>Everyday use</td>
    </tr>
    <tr>
      <td><b>Native Bash (Windows, minimal)</b><br><sub>id <code>bash-native-minimal</code>, order 6</sub></td>
      <td>Reads that line's <code>minimal</code> and replaces only the shell surface: one persona and one persistent bash.</td>
      <td>A lean session that only needs a shell</td>
    </tr>
  </tbody>
</table>

## 📟 Persistent-terminal component

On the plugins page `dsh-bash-native` offers **two independently switchable components**: `dsh-bash-native/presets` (the two presets, on by default) and `dsh-bash-native/terminal` (six interactive persistent-terminal tools, off by default).

<p align="center">
  <img src="img/example1.jpg" width="50%">
</p>

This component and the built-in **persistent terminal** (@deepseek-ai/dsh-experimental-terminal-bundle) register the same tool names, so they cannot ~~and need not~~ be enabled together. (`tool "terminal_open" is already registered`)

---

## 🛠 Configuration

> Beyond this table the execution budget is inherited from `@deepseek-ai/dsh-bash-local`: `cwd`, `timeoutMs`, `maxTimeoutMs`, `maxOutputBytes`, `maxSpillBytes`, `graceMs`, whose defaults and caps have a single source of truth in that schema.

<table>
  <thead>
    <tr>
      <th align="left">Key</th>
      <th align="left">Default</th>
      <th align="left">Meaning</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>confine</code></td>
      <td><code>true</code></td>
      <td>Whether <code>ctx.sandbox</code> is obeyed; turning it off gives up the file policy and the denial marker</td>
    </tr>
    <tr>
      <td><code>requireEngineOnLoad</code></td>
      <td><code>false</code></td>
      <td>Whether a missing engine fails the load or every call (both presets set <code>true</code>)</td>
    </tr>
    <tr>
      <td><code>toolsDir</code></td>
      <td><code>''</code></td>
      <td>The POSIX toolchain directory; empty = first the per-user build (<code>%LOCALAPPDATA%\dsh-bash-native\tools\bin</code>), and if it holds no programs the bundled one. A configured directory is used as-is, even when empty (it is never silently swapped for the bundled copy)</td>
    </tr>
    <tr>
      <td><code>fileCommandsFromPath</code></td>
      <td><code>['sed','rmdir']</code></td>
      <td>Engine file commands to run from the toolchain's program instead (only the twelve names the engine implements in-process); a name the toolchain does not publish, or one published on a directory that is not on <code>PATH</code>, is ignored and the in-process copy keeps answering. See “Known limitations” below.</td>
    </tr>
    <tr>
      <td><code>rcFile</code></td>
      <td><code>''</code></td>
      <td>Startup file for a persistent PTY session; empty = <code>%LOCALAPPDATA%\dsh-bash-native\bash-native-rc.sh</code></td>
    </tr>
    <tr>
      <td><code>denialSignatureAdditions</code></td>
      <td><code>['os error 5']</code></td>
      <td>Extra denial signatures; the default keeps non-English Windows reporting denials</td>
    </tr>
    <tr>
      <td><code>shellEnvOverrides</code></td>
      <td><code>{}</code></td>
      <td>Extra environment entries, layered above the model-friendly defaults</td>
    </tr>
    <tr>
      <td><code>verifyArtifacts</code></td>
      <td><code>'stamped'</code></td>
      <td>Verification strength: <code>stamped</code> re-hashes only when the artifact's or the runtime copy's size/mtime changed; <code>always</code> hashes on every resolution (11 MB engine, 37 MB toolchain)</td>
    </tr>
  </tbody>
</table>

---

## 🧰 Toolchain

**The toolchain ships with the package and works after install.**

<details open>
<summary><b>📚 101 names, 20 of them advertised</b></summary>

<br>

| Kind | Contents |
|---|---|---|
| **Advertised** (20) | `grep`, `sed`, `awk`, `jq`, `find`, `xargs`, `diff`, `cmp`, `which`, `timeout`, `stat`, `ps`, plus `tty`, `nohup`, `nice`, `uptime`, `hostid`, `pathchk`, `locate`, `updatedb` |
| **Installed, not advertised** (81) | The 88 programs of uutils `coreutils` (`cat`, `ls`, `rm`, `cp`, `head`, `tail`, `wc`, `sort`, `seq`, …: the engine no longer bundles them), plus the program form of the shell builtins `echo`, `printf`, `pwd`, `test`, `true`, `false`, `kill` |

</details>

<br>

- **Understands the same `/tmp` and drive-mount aliases as the engine**, including a program that starts another program: `printf '/tmp/f\n' | xargs awk '{print}'` and `printf '/tmp/x\n' | xargs rm` both reach the real file.
- **One table protects the data positions on both sides**: the value of `-e`/`-f`, a grep/sed/awk first positional operand, find's `-name`/`-path` primaries and basename/dirname's positionals are never translated — the engine's own funnels and the toolchain side of “a program starts a program” follow the same list.
- **Also puts `bash` and `sh` on `PATH`** (the toolchain directory first, then the **names directory**, both ahead of the host's `PATH`):

  > `src/shim.ts` points those two names at the verified engine inside `%LOCALAPPDATA%\dsh-bash-native\shim\<engine sha256>\` — hard links on the same volume, so both names share the engine's bytes.

---

## ⚠️ Known limitations

- **Two platform differences unrelated to the in-process copies**:

  | Shape | Measured |
  |---|---|
  | `cd /absent 2>err.txt \| cat` | the diagnostic lands neither in `err.txt` nor on the shell's stderr |
  | `PIPESTATUS[0]` of `printf … \| head -c 1` | a builtin writer does not report the closed pipe: `0` instead of `141` |

- **When a reader closes early**, tools and external programs use their own wording and exit status: the consequence of Windows having no `SIGPIPE` (each tool decides for itself):

  | Command | Writer exit code | Note |
  |---|:---:|---|
  | `seq 1 200000 \| head -c 1` | `0` | stderr says `write error: Broken pipe` |
  | `yes \| head -c 1` | `0` | silent |
  | `cat big \| head -c 1` | `13` | — |
  | `ls -R some-dir \| head -c 1` | `1` | — |
  | the engine's own builtins | `0` | does not report the closed pipe (see `PIPESTATUS[0]` above) |

- **`{ …; } | head` hangs when a line is longer than about 100 KB** (rubash 1.4.3; measured: a 60 KB line is fine, a 200 KB line times out): the reader takes part of the line and exits, and the writer never aborts — with the pipeline's output going to a file it hangs, and with a second pipe it **loses the whole output**. Workaround: `{ …; } | cat | head`, or write to a file first. Recorded in `docs/research.md` §72; `test/test-brush-regressions.mjs` prints the current state on every run.
- **A program the engine does not know cannot tell data from a path**: a path-shaped data word handed to an unknown **native** program (`node -e '…' '/x/{print}'`) is treated as a path operand and translated to a Win32 spelling — MSYS behaves the same way; what differs is that the shipped tools' scripts, patterns and program words have a fixed data-position table and are never rewritten.

---

## 🧹 Disk footprint and cleanup

The runtime state lives under `%LOCALAPPDATA%\dsh-bash-native` and is **content-addressed**: one `shim/<engine sha256>/` per engine build.

| Directory | Written by | Size | If deleted |
|---|---|:---:|---|
| `shim/<digest>/` | every resolution | the engine's size (about 0 with a hard link on the same volume) | recreated on the next resolution |
| `toolchain/<digest>/` | every resolution | about 36 MB (about 0 with hard links on the same volume) | recreated on the next resolution |
| `verified/` | every verification | tens of KB | one extra hash, nothing else |

To clean up explicitly (run it with **DSH stopped**):
> Replace `<dsh_profile>` with your profile's path, for example `%USERPROFILE%\.dsh\profiles\<profile>`

```sh
node <dsh_profile>/node_modules/dsh-bash-native/bin/clean-state.mjs          # report only, change nothing
node <dsh_profile>/node_modules/dsh-bash-native/bin/clean-state.mjs --yes    # delete the superseded shim/ and toolchain/ caches
```

## 📄 License

| What | License | Notice and scan |
|---|:---:|---|
| This plugin | **MIT** | [LICENSE](LICENSE) |
| The rubash engine | **MIT** | [engine/LICENSE.rubash](engine/LICENSE.rubash), dependency scan in [engine/THIRD-PARTY.md](engine/THIRD-PARTY.md) |
| The bundled toolchain | **MIT** | uutils `coreutils`/`findutils`/`grep`/`sed`, `jaq`, `goawk` and the in-repo `posix-extra`; [toolchain/LICENSES/](toolchain/LICENSES/) and [toolchain/THIRD-PARTY.md](toolchain/THIRD-PARTY.md) |

---

## 🙏 References and thanks

On the road to a native bash for agents, **[oh-my-pi](https://github.com/can1357/oh-my-pi)** is one of the earliest implementations to blaze it, and this plugin's early brush diagnosis and fixes also benefited from the record it left.
<!-- ═══════════════════════════════════════════════════════════════════════ -->
