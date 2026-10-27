<!-- ═══════════════════════════════════════════════════════════════════════ -->

<div align="center">

# 🐚 dsh-bash-native

### Rust 实现的 Windows 原生 POSIX bash 执行器

**给 DSH 的 shell 提供一个真正原生的 `bash`** —— rubash 引擎，不依赖 WSL，也不需要 MSYS 兼容层

<br>

`适配三档权限策略` · `后台作业` · `支持持久化终端`

<br>

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/zh/plugins/spookywaste/dsh-bash-native)
[![npm downloads](https://img.shields.io/npm/dm/dsh-bash-native.svg)](https://www.npmjs.com/package/dsh-bash-native)
[![npm](https://img.shields.io/npm/v/dsh-bash-native?logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-bash-native)
[![DSH](https://img.shields.io/badge/DSH-0.2.0--rc.2%20--%200.2.1--rc.3-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![Powered by rubash](https://img.shields.io/badge/powered%20by-rubash-64CEF7)](https://github.com/unixwin/rubash)

**中文** &nbsp;·&nbsp; [**English**](README.en.md)

</div>

---

## 🐟 为什么需要它

> ~~避免肥鱼被 cmd 咬~~，也规避了子系统和 MSYS 兼容层的性能开销

**0.3.1**：引擎由`brush`更换为`rubash`，修复多项已知缺陷，提供更好的原生 POSIX 兼容

<p align="center">
  <img src="img/example0.jpg" width="240">
</p>

<table align="center">
  <thead>
    <tr>
      <th align="left">方案</th>
      <th align="left">命令在哪里执行</th>
      <th align="left">每条命令的代价</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Git for Windows</b></td>
      <td>MSYS2 兼容层上的移植 bash，POSIX 语义由运行时模拟</td>
      <td>兼容层每次起子 shell 或外部命令都要完整 fork 一个 MSYS2 进程（挂起线程、另起进程、经管道搬运内存），开销随子 shell 启动频率线性放大</td>
    </tr>
    <tr>
      <td><b>WSL</b></td>
      <td>命令在 Linux VM 的发行版里执行</td>
      <td>每条命令都要经 Windows/Linux 边界往返一次，延迟对高频短命令尤为不利</td>
    </tr>
    <tr>
      <td><b>本插件</b><br><sub>rubash 引擎 + 工具链</sub></td>
      <td>纯 Rust 实现的原生二进制，无模拟层、无 VM</td>
      <td><code>grep</code>、<code>sed</code>、<code>awk</code> 等来自随包工具链，其余由引擎在进程内处理，没有兼容层或 VM 边界</td>
    </tr>
  </tbody>
</table>

### ⚡ 实测：启动与子 shell 的代价

同一台机器（Windows 11 / x64）上的同一组脚本，每项取 5 次最小值，负载只用 shell 内建与一次外部进程，排除工具链差异。
> 复现：仓库里的 `node scripts/bench-engines.mjs`。

| 工作负载 | rubash（本插件） | Git Bash / MSYS2 |
|---|---:|---:|
| `bash -c :`（启动到退出） | 7 ms | 25 ms |
| `echo hi` | 6 ms | 26 ms |
| 算术循环 10k 次 | 65 ms | 75 ms |
| `[ ]` 判定 20k 次 | 167 ms | 181 ms |
| 命令替换 300 次 | 11 ms | **3052** ms |
| 子 shell 300 次 | 25 ms | **2497** ms |
| 外部进程 20 次（`cmd /c exit`） | 192 ms | 560 ms |

差距来自 **fork**：MSYS2 每次命令替换与子 shell 都要 fork 一个兼容层进程（约 8–10 ms），rubash 两样都做在进程内（每次约 0.04 ms），300 次就相差 2–3 秒。

### 🧭 路径不会被“自动替换”

Git Bash / MSYS2 把参数交给**原生**程序时会**猜**哪些像路径并改写（`/flag` → `C:/Program Files/Git/flag`，于是脚本和 agent 被迫记着 `MSYS_NO_PATHCONV=1`）；连数据位也一起改：用 MSYS 调原生 `awk.exe` 跑 `awk '/x/{print}'`，程序位到手是 `X:/{print}`，直接语法错误、进错路径。
> rubash 不猜：按子进程方言，整条 argv 要么原样交给带 POSIX 层的程序，要么统一翻成 Win32 拼写；随包工具的脚本、模式、程序位永不改写，极大减少了找不到路径的情况。

---

## 📦 安装

### CLI 安装

> 以 `web` profile 为例

```
dsh plugin --profile web add dsh-bash-native
```

### dsh 网页版 / 桌面版安装

> **dsh 插件页面** → 右上角 **添加插件** → 填入插件名 `dsh-bash-native` 或仓库地址：

```
https://github.com/SpookyWaste/dsh-bash-native
```

重启后，在 **Settings → General** 里把 **Native Bash (Windows)** 设为默认 preset（或在会话里切过去）。

> 持久化终端组件**默认关闭**，在插件管理中可以打开。见[持久终端组件](#持久终端组件)。

<table>
  <tbody>
    <tr>
      <td><b>平台</b></td>
      <td>Windows x64</td>
    </tr>
    <tr>
      <td><b>DSH</b></td>
      <td><code>&gt;=0.2.0-rc.2 &lt;0.3.0-0</code>（0.2.0-rc.2 - 0.2.1-rc.3实测）</td>
    </tr>
    <tr>
      <td><b>持久终端组件</b></td>
      <td>需要 DSH <code>&gt;=0.2.1-alpha.1</code>才能开启</td>
    </tr>
  </tbody>
</table>

---

## ⚙️ 引擎

引擎是 **rubash**（[`unixwin/rubash`](https://github.com/unixwin/rubash)，Rust 写的 bash 5.3 兼容 shell，MIT），本仓库从源码构建它、按 `engine.lock.json` 里的 commit 应用三笔补丁，产物 `engine/win32-x64/rubash.exe`（约 11 MB）随包提交。

> 兼容 **MSYS 的 `uname -s` 身份**（`MSYS_NT-…`），所以脚本里按 MSYS 分支的逻辑也能成立；并发、取消与作业语义由引擎自己实现，跟 MSYS 运行时无关。

<details>
<summary><b>🧩 补丁清单（点击展开）</b></summary>

<br>

<table>
  <thead>
    <tr>
      <th align="left">补丁</th>
      <th align="left">做了什么</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>0001-data-primary-positions-every-child</code></td>
      <td>“数据位”的判定从 POSIX-aware 子进程推广到<b>所有</b>子进程：grep/sed/awk 的模式、脚本与程序文本，find 的模式主项，basename/dirname 的位置参数都原样交给程序；文件操作数照常翻成 Windows 形态。</td>
    </tr>
    <tr>
      <td><code>0002-drop-undecodable-environment-entries</code></td>
      <td>启动时丢掉 Win32 能传入、但 Unicode 表示不了的环境项（<code>std::env::vars()</code> 遇到它会 panic）；代价是那一条变量，而不是每条命令都在建 shell 时 abort。</td>
    </tr>
    <tr>
      <td><code>0003-file-commands-from-path</code></td>
      <td>新增 <code>RUBASH_FILE_COMMANDS_FROM_PATH</code>：由 shell 指定哪些「进程内文件命令」改从 <code>PATH</code> 上的程序执行（<code>all</code> / <code>none</code> / 名字列表），并从 shell 自己的变量表读取，所以 <code>--rcfile</code> 也能设置；顺带让内联管道分支不再无视宿主的「关掉进程内副本」开关。</td>
    </tr>
  </tbody>
</table>

</details>

> 💡 每次解析都按 lock 里的 **sha256** 校验产物，并按**盖章**跳过重复校验：产物的 size 与 mtime 记进 `%LOCALAPPDATA%\dsh-bash-native\verified\`，没变就不再读那 11 MB（`verifyArtifacts: 'always'` 可恢复每次都哈希）。

---

## 🔧 实现

- **注册 `ctx.shell`**：`ShellExecutor` 的 Service Provider，构建在 `@deepseek-ai/dsh-bash-local` 之上，每条命令交给解析到的 rubash 引擎；**引擎与工具链都随包分发**，并在解析时按 lock 与 manifest 校验。
- **服从 DSH 的三档文件策略**（`read-only` / `workspace-write` / `danger-full-access`）：受限档位把引擎 argv 交给 `ctx.sandbox`，不限档位直接 spawn 并如实报告档位。
- **后台作业经 `ctx.jobs` 汇报**，超出内存上限的输出落到 spill 文件、路径随结果返回；`echo`、`cat`、`sort` 等空 `PATH` 也能跑，因为随包工具链先于宿主 `PATH`。
- **Web 面**用自带的 agent preset 挂载，**agent 面**用 overlay 显式启用；它不替换宿主层的 `ctx.shell`，因此其他 preset 的 `pwsh` 工具不受影响。

---

## 🎛 两个预设<sub>0.2.0：静态挂载改为跟随官方预设替换</sub>

[`cordis.patch.yml`](cordis.patch.yml) 只有**一行注册器**（`dsh-bash-native/presets`），两个 preset 由插件在运行时注册：启动时读**本机安装的** `presets/{standard,minimal}.patch.yml`，把 shipped 的 shell 面换成插件自己的 realm group；它们各自带一个 `isolate: { shell: true, terminals: true }` 的 realm，宿主层与其他 preset（包括用 `pwsh` 的那些）不受影响。

<table>
  <thead>
    <tr>
      <th align="left">预设</th>
      <th align="left">挂载什么</th>
      <th align="left">什么时候选</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Native Bash (Windows)</b><br><sub>id <code>bash-native</code>，order 5</sub></td>
      <td>读本机 harness 那条线的 <code>standard</code> 并只换 shell 面：每次调用都是全新的 <code>bash</code>，文件、作业、委派等全套工具跟着那一版上游走</td>
      <td>日常使用</td>
    </tr>
    <tr>
      <td><b>Native Bash (Windows, minimal)</b><br><sub>id <code>bash-native-minimal</code>，order 6</sub></td>
      <td>读本机那条线的 <code>minimal</code> 并只换 shell 面：一个 persona 与一个持久 bash。</td>
      <td>只要一个 shell 的轻量会话</td>
    </tr>
  </tbody>
</table>

## 📟 持久终端组件

插件页面里 `dsh-bash-native` 提供**两个可分别开关的组件**：`dsh-bash-native/presets`（两个预设，默认开）与 `dsh-bash-native/terminal`（提供 6 个交互式持久终端工具，默认关）。

<p align="center">
  <img src="img/example1.jpg" width="50%">
</p>

该组件和内置的 **持久终端**（@deepseek-ai/dsh-experimental-terminal-bundle）注册同名工具，不能~~也不需要~~同时开启。 （`tool "terminal_open" is already registered`）

---

## 🛠 配置

> 除下表外，执行预算继承自 `@deepseek-ai/dsh-bash-local`：`cwd`、`timeoutMs`、`maxTimeoutMs`、`maxOutputBytes`、`maxSpillBytes`、`graceMs`，默认值与上限由那一侧的 schema 单一出处提供。

<table>
  <thead>
    <tr>
      <th align="left">键</th>
      <th align="left">默认</th>
      <th align="left">含义</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>confine</code></td>
      <td><code>true</code></td>
      <td>是否服从 <code>ctx.sandbox</code>；关闭即放弃文件策略与拒绝标记</td>
    </tr>
    <tr>
      <td><code>requireEngineOnLoad</code></td>
      <td><code>false</code></td>
      <td>无引擎时是加载失败，还是每次调用失败（两个预设都设 <code>true</code>）</td>
    </tr>
    <tr>
      <td><code>toolsDir</code></td>
      <td><code>''</code></td>
      <td>POSIX 工具链目录；空 = 先看每用户目录里自建的那份（<code>%LOCALAPPDATA%\dsh-bash-native\tools\bin</code>），没有程序就用随包工具链。填了则照用，空目录也算数（不会悄悄换成随包那份）</td>
    </tr>
    <tr>
      <td><code>fileCommandsFromPath</code></td>
      <td><code>['sed','rmdir']</code></td>
      <td>改从工具链程序执行的引擎内建文件命令（仅限引擎实现的 12 个名字）；工具链没有提供该程序、或工具链目录不在 <code>PATH</code> 上时自动忽略，进程内副本继续生效。见下面的「已知限制」</td>
    </tr>
    <tr>
      <td><code>rcFile</code></td>
      <td><code>''</code></td>
      <td>持久 PTY 会话读的启动文件；空 = <code>%LOCALAPPDATA%\dsh-bash-native\bash-native-rc.sh</code></td>
    </tr>
    <tr>
      <td><code>denialSignatureAdditions</code></td>
      <td><code>['os error 5']</code></td>
      <td>追加的拒绝签名，默认值让非英文 Windows 也标得出拒绝</td>
    </tr>
    <tr>
      <td><code>shellEnvOverrides</code></td>
      <td><code>{}</code></td>
      <td>追加环境变量，层叠在模型友好默认值之上</td>
    </tr>
    <tr>
      <td><code>verifyArtifacts</code></td>
      <td><code>'stamped'</code></td>
      <td>校验力度：<code>stamped</code> 只在产物或运行副本的 size/mtime 变化时重新哈希；<code>always</code> 每次解析都哈希（引擎 11 MB、工具链 37 MB）</td>
    </tr>
  </tbody>
</table>

---

## 🧰 工具链

**工具链随包分发，装完即用。**

<details open>
<summary><b>📚 101 个名字，公布其中 20 个</b></summary>

<br>

| 类别 | 内容 |
|---|---|---|
| **公布**（20） | `grep`、`sed`、`awk`、`jq`、`find`、`xargs`、`diff`、`cmp`、`which`、`timeout`、`stat`、`ps`，以及 `tty`、`nohup`、`nice`、`uptime`、`hostid`、`pathchk`、`locate`、`updatedb` |
| **只装不公布**（81） | uutils `coreutils` 的 88 个程序（`cat`、`ls`、`rm`、`cp`、`head`、`tail`、`wc`、`sort`、`seq` 等——引擎不再自带这些），以及 shell 内建要用的程序形态 `echo`、`printf`、`pwd`、`test`、`true`、`false`、`kill` |

</details>

<br>

- **支持与引擎相同的 `/tmp` 与盘符别名**，“程序再启动程序”的链同样成立：`printf '/tmp/f\n' | xargs awk '{print}'` 与 `printf '/tmp/x\n' | xargs rm` 都拿到真实路径。
- **数据位由两边同一张表保护**：开关 <code>-e</code>/<code>-f</code> 的值、grep/sed/awk 的首个位置操作数、find 的 <code>-name</code>/<code>-path</code> 类主项、basename/dirname 的位置参数，都不翻译——引擎启动的子进程与工具链里“程序再启动程序”的那一半用的是同一份清单。
- **顺带把 `bash` 与 `sh` 放到 `PATH` 上**（工具链目录在前，**名字目录**紧随其后，两者都排在宿主原有 `PATH` 之前）：

  > `src/shim.ts` 在 `%LOCALAPPDATA%\dsh-bash-native\shim\<引擎 sha256>\` 里把这两个名字指向已校验引擎——同卷时是**硬链接**，两个名字共用引擎那一份字节。

---

## ⚠️ 已知限制

- **两条与进程内副本无关的平台差异**：

  | 形态 | 实测 |
  |---|---|
  | `cd /absent 2>err.txt \| cat` | 诊断既不在 `err.txt` 也不在 shell 的 stderr 上 |
  | `printf … \| head -c 1` 的 `PIPESTATUS[0]` | 内建写端不报断管，`0` 而不是 `141` |

- **断管（读端提前关闭）时**，工具与外部程序用它们自己的措辞和退出码——这是 Windows 没有 `SIGPIPE` 的后果（每个工具各自决定断管怎么办）：

  | 命令 | 写端退出码 | 备注 |
  |---|:---:|---|
  | `seq 1 200000 \| head -c 1` | `0` | stderr 打 `write error: Broken pipe` |
  | `yes \| head -c 1` | `0` | 不吭声 |
  | `cat big \| head -c 1` | `13` | — |
  | `ls -R 某目录 \| head -c 1` | `1` | — |
  | 引擎自己的内建 | `0` | 不报断管（见上一条 `PIPESTATUS[0]`） |

- **`{ …; } | head` 在单行超过约 100 KB 时会挂起**（rubash 1.4.3，实测：60 KB 单行正常、200 KB 单行超时）：读端读走一部分就退出，写端不中止；把这条管道的输出接到文件时是挂起，接到另一个管道时则**整段输出丢失**。绕开办法：`{ …; } | cat | head`，或先写到文件再读。记录在 `docs/research.md` §72，`test/test-brush-regressions.mjs` 每次运行都会打印现状。
- **不认识的程序分不清数据与路径**：把一个“像路径”的数据词交给引擎不认识的**原生**程序（`node -e '…' '/x/{print}'`），它会被当作路径操作数翻成 Win32 拼写——MSYS 同样如此；区别是随包工具的脚本、模式、程序位有确定的数据位表，永不被改写。

---

## 🧹 磁盘足迹与清理

运行时状态都在 `%LOCALAPPDATA%\dsh-bash-native` 下，并且**按内容寻址**：每个引擎构建一个 `shim/<引擎 sha256>/`。

| 目录 | 谁写的 | 大小 | 删掉会怎样 |
|---|---|:---:|---|
| `shim/<摘要>/` | 每次解析 | 引擎大小（同卷硬链接时约 0） | 下次解析重建 |
| `toolchain/<摘要>/` | 每次解析 | 约 36 MB（同卷硬链接时约 0） | 下次解析重建 |
| `verified/` | 每次校验 | 几十 KB | 只会多一次哈希 |

显式清理（**停掉 DSH 之后**运行）：
> 将<dsh_profile>替换为你的profile路径，例如：`%USERPROFILE%\.dsh\profiles\<profile>`

```sh
node <dsh_profile>/node_modules/dsh-bash-native/bin/clean-state.mjs          # 只报告，不动文件
node <dsh_profile>/node_modules/dsh-bash-native/bin/clean-state.mjs --yes    # 删掉被取代的 shim/ 与 toolchain/ 缓存
```

## 📄 许可

| 内容 | 许可 | 声明与扫描 |
|---|:---:|---|
| 本插件 | **MIT** | [LICENSE](LICENSE) |
| rubash 引擎 | **MIT** | [engine/LICENSE.rubash](engine/LICENSE.rubash)、依赖扫描 [engine/THIRD-PARTY.md](engine/THIRD-PARTY.md) |
| 随包工具链 | **MIT** | uutils `coreutils`/`findutils`/`grep`/`sed`、`jaq`、`goawk`、仓库内 `posix-extra`；[toolchain/LICENSES/](toolchain/LICENSES/) 与 [toolchain/THIRD-PARTY.md](toolchain/THIRD-PARTY.md) |

---

## 🙏 参考与致谢

为 Agent 提供原生 bash 这条路上，**[oh-my-pi](https://github.com/can1357/oh-my-pi)** 是最早的先行实现之一，本插件早期针对 brush 的诊断与修法也受益于它留下的记录。
<!-- ═══════════════════════════════════════════════════════════════════════ -->
