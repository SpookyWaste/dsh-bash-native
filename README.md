<!-- ═══════════════════════════════════════════════════════════════════════ -->

<div align="center">

# 🐚 dsh-bash-native

### Rust 实现的 Windows 原生 POSIX bash 执行器

**给 DSH 的 shell 提供一个真正的 `bash`** —— brush 引擎，不依赖 WSL，也不需要 MSYS 兼容层

<br>

`三档权限策略` · `后台作业` · `一句模型可见的环境契约`

<br>

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/zh/plugins/spookywaste/dsh-bash-native)
[![CI](https://github.com/SpookyWaste/dsh-bash-native/actions/workflows/ci.yml/badge.svg)](https://github.com/SpookyWaste/dsh-bash-native/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-bash-native?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-bash-native)
[![Powered by brush](https://img.shields.io/badge/powered%20by-brush-blue?style=flat-square)](https://github.com/reubeno/brush)

**中文** &nbsp;·&nbsp; [**English**](README.en.md)

</div>

---

## 🐟 为什么需要它

> ~~避免肥鱼被 cmd 咬~~，也规避了子系统和 MSYS 兼容层的性能开销

<p align="center">
  <img src="img/example0.jpg" width="220">
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
      <td><b>本插件</b><br><sub>brush 引擎 + 工具链</sub></td>
      <td>纯 Rust 实现的原生二进制，无模拟层、无 VM</td>
      <td><code>echo</code>、<code>cat</code>、<code>ls</code>、<code>cp</code> 等由引擎内建、不产生新进程，其余按原生进程启动，没有兼容层或 VM 边界</td>
    </tr>
  </tbody>
</table>

---

## 📦 安装

### CLI 安装

```
dsh plugin --profile web add dsh-bash-native
```

### dsh 网页版 / 桌面版安装

> **dsh 插件页面** → 右上角 **添加插件** → 填入：

```
https://github.com/SpookyWaste/dsh-bash-native
```

重启后，在 **Settings → General** 里把 **Native Bash (Windows)** 设为默认 preset（或在会话里切过去）。

<table>
  <tbody>
    <tr>
      <td><b>平台</b></td>
      <td>Windows x64</td>
    </tr>
    <tr>
      <td><b>Node</b></td>
      <td>24</td>
    </tr>
    <tr>
      <td><b>DSH</b></td>
      <td><code>&gt;=0.1.7-rc.2 &lt;0.3.0-0</code>（0.1.7-rc.2 与 0.2.0-rc.2 实测通过）</td>
    </tr>
  </tbody>
</table>

---

## ⚙️ 引擎

引擎是 **brush**（Rust 写的 bash 兼容 shell，MIT），本仓库对它打补丁、从源码构建，产物 `engine/win32-x64/brush.exe`（约 15 MB）随包提交；补丁逐支记录在 [`patches/brush/README.md`](patches/brush/README.md)。

<details open>
<summary><b>🧩 补丁清单（20 支）</b></summary>

<br>

<table>
  <thead>
    <tr>
      <th align="center">#</th>
      <th align="left">补丁</th>
      <th align="left">做了什么</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center">01</td>
      <td><code>0001-background-job-pid</code></td>
      <td>让由字面量外部命令组成的后台作业在父进程直接 spawn 并登记，<code>$!</code> 与 <code>jobs -p</code> 有真实 PID。</td>
    </tr>
    <tr>
      <td align="center">02</td>
      <td><code>0002-unix-tmp-alias</code></td>
      <td><code>/tmp</code> 成为 shell 自己解析路径时的别名——重定向、<code>cd</code>、<code>test -f</code>，以及通配符展开的根目录。</td>
    </tr>
    <tr>
      <td align="center">03</td>
      <td><code>0003-err-trap-scope</code></td>
      <td><code>ERR</code> trap 由设置它的那一层触发，而不是按 <code>set -E</code> 判定。</td>
    </tr>
    <tr>
      <td align="center">04</td>
      <td><code>0004-external-argv-tmp-alias</code></td>
      <td>别名改写延伸到 shell 启动的每条命令的<b>参数</b>，并留下 <code>DSH_BASH_NATIVE_NO_PATHCONV=1</code> 逃生开关。</td>
    </tr>
    <tr>
      <td align="center">05</td>
      <td><code>0005-closed-reader-stage-abort</code></td>
      <td>读端已经离开时，断了管的复合命令整体中止，而不是像上游那样静默继续。</td>
    </tr>
    <tr>
      <td align="center">06</td>
      <td><code>0006-descriptor-paths</code></td>
      <td><code>/dev/fd/N</code>、<code>/dev/stdin</code>、<code>/dev/stdout</code>、<code>/dev/stderr</code> 按 <b>shell 自己的</b>描述符表解析。</td>
    </tr>
    <tr>
      <td align="center">07</td>
      <td><code>0007-wait-selectors</code></td>
      <td><code>wait</code> 汇报它等待的那个作业自己的状态，而不是只支持“等全部”与 <code>%spec</code>。</td>
    </tr>
    <tr>
      <td align="center">08</td>
      <td><code>0008-windows-kill-builtin</code></td>
      <td><code>kill</code> 成为内建，带作业规格与信号词表，被杀的子进程以 128+n 汇报。</td>
    </tr>
    <tr>
      <td align="center">09</td>
      <td><code>0009-drive-mount-aliases</code></td>
      <td>首段是单个字母时按盘符挂载点解析，<code>/c/Windows/System32</code> 等于 <code>C:\Windows\System32</code>。</td>
    </tr>
    <tr>
      <td align="center">10</td>
      <td><code>0010-missing-builtins</code></td>
      <td>补上脚本会用的内建（<code>umask</code>、<code>history</code>、<code>disown</code>、<code>wait -f</code> 等），每个都给一个站得住的语义。</td>
    </tr>
    <tr>
      <td align="center">11</td>
      <td><code>0011-crlf-script-text</code></td>
      <td>Windows 写出来的脚本按文本读，行尾的 CR 不再进入语法。</td>
    </tr>
    <tr>
      <td align="center">12</td>
      <td><code>0012-relative-command-paths</code></td>
      <td>相对路径的命令按 shell 的工作目录解析，<code>./sub/x.exe</code> 因此可跑。</td>
    </tr>
    <tr>
      <td align="center">13</td>
      <td><code>0013-compound-pipeline-stage-concurrency</code></td>
      <td>非末段的进程内阶段改跑自己的线程，<code>{ cat big.txt; } | head -1</code> 这类管道不再因输出超过管道缓冲而死锁。</td>
    </tr>
    <tr>
      <td align="center">14</td>
      <td><code>0014-function-call-stage-concurrency</code></td>
      <td>同一条规则覆盖“阶段是函数调用”的情形（<code>f() { cat big.txt; }; f | head -1</code>）。</td>
    </tr>
    <tr>
      <td align="center">15</td>
      <td><code>0015-trailing-slash-requires-directory</code> <sub>0.1.1</sub></td>
      <td>尾随分隔符只匹配目录，<code>*/</code> 与 <code>*.md/</code> 不再由卷的宽松行为代答。</td>
    </tr>
    <tr>
      <td align="center">16</td>
      <td><code>0016-bundled-name-dispatch</code> <sub>0.1.1</sub></td>
      <td>引擎按自己的文件名分派到 bundled 工具（<code>rm.exe</code> 就是 <code>rm</code>），并在这条路上改写 <code>/tmp</code> 参数。</td>
    </tr>
    <tr>
      <td align="center">17</td>
      <td><code>0017-rm-refuses-a-trailing-separator-on-a-file</code> <sub>0.1.1</sub></td>
      <td><code>rm</code> 拒绝“尾随分隔符指向非目录”，不再静默删掉那个普通文件。</td>
    </tr>
    <tr>
      <td align="center">18</td>
      <td><code>0018-host-env-survives-non-unicode</code> <sub>0.1.3 新增</sub></td>
      <td>宿主环境里有一条解不出的变量时引擎不再启动即崩——此前 <code>--version</code> 仍然退 0，于是它会通过校验、然后让每条命令都在建 shell 时 abort。</td>
    </tr>
    <tr>
      <td align="center">19</td>
      <td><code>0019-windows-long-path-identity</code> <sub>0.1.3 新增</sub></td>
      <td>同一个目录只保留一种拼写（长名）。<code>$PWD</code>、<code>$TEMP</code>/<code>$TMPDIR</code> 与 <code>/tmp</code> 指向同一处时给出同一个字符串，不再出现 <code>EXAMPL~1</code> 这类 8.3 短名。</td>
    </tr>
    <tr>
      <td align="center">20</td>
      <td><code>0020-windows-file-identity</code> <sub>0.1.3 新增</sub></td>
      <td><code>test -ef</code> 改用真正的文件身份（卷序列号 + 文件索引）比较，不再报 <code>not supported on this platform</code>；硬链接与目录都成立。</td>
    </tr>
  </tbody>
</table>

</details>

> 💡 每次解析都按 lock 里的 **sha256** 校验产物，并按**盖章**跳过重复校验：产物的 size 与 mtime 记进 `%LOCALAPPDATA%\dsh-bash-native\verified\`，没变就不再读那 15.6 MB（`verifyArtifacts: 'always'` 可恢复每次都哈希）。

---

## 🔧 实现

- **注册 `ctx.shell`**：`ShellExecutor` 的 Service Provider，构建在 `@deepseek-ai/dsh-bash-local` 之上，每条命令交给解析到的 brush 引擎；**引擎与工具链都随包分发**，并在解析时按 lock 与 manifest 校验。
- **服从 DSH 的三档文件策略**（`read-only` / `workspace-write` / `danger-full-access`）：受限档位把引擎 argv 交给 `ctx.sandbox`，不限档位直接 spawn 并如实报告档位。
- **后台作业经 `ctx.jobs` 汇报**，超出内存上限的输出落到 spill 文件、路径随结果返回；`echo`、`cat`、`ls`、`cp`、`rm`、`sort` 等由引擎自带并解析为 builtin，空 `PATH` 也成立。
- **Web 面**用自带的 agent preset 挂载，**agent 面**用 overlay 显式启用；它不替换宿主层的 `ctx.shell`，因此其他 preset 的 `pwsh` 工具不受影响。

---

## 🎛 两个预设

[`cordis.patch.yml`](cordis.patch.yml) 只有**一行注册器**（`dsh-bash-native/presets`），两个 preset 由插件在运行时注册（`ctx.agentPresets.register()`），行数据在 [`src/preset-data.ts`](src/preset-data.ts)；它们各自带一个 `isolate: { shell: true, terminals: true }` 的 realm，好让宿主层与其他 preset（包括用 `pwsh` 的那些）完全不受影响。

宿主探测<sub>0.1.5新增</sub>：harness 不支持的包就不挂在preset里，受支持的新版照常加载。（如0.2.1-alpha 增加的 `tool-schedule` 只会出现在该版本的preset，不会在0.2.0-rc2中出现）

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
      <td>镜像 harness 的 <code>standard</code> 再加 shell 组：每次调用都是全新的 <code>bash</code>、<del>可换成持久 bash</del><sub>0.1.5删除，对齐原版standard preset</sub>、文件、作业、委派等全套工具</td>
      <td>日常使用</td>
    </tr>
    <tr>
      <td><b>Native Bash (Windows, minimal)</b><br><sub>id <code>bash-native-minimal</code>，order 6</sub></td>
      <td>镜像 harness 的 <code>minimal</code>：一个 persona 与一个持久 bash，没有文件、作业与委派工具</td>
      <td>只要一个 shell 的轻量会话</td>
    </tr>
  </tbody>
</table>

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
      <td><code>promptSection</code></td>
      <td><code>true</code></td>
      <td>是否贡献模型可见的环境契约小节</td>
    </tr>
    <tr>
      <td><code>promptDetail</code></td>
      <td><code>full</code></td>
      <td>保留的兼容键：契约只剩两句后，两个取值产出同一段文字，设或不设都一样</td>
    </tr>
    <tr>
      <td><code>toolsDir</code></td>
      <td><code>''</code></td>
      <td>POSIX 工具链目录；空 = 先看每用户目录里自建的那份（<code>%LOCALAPPDATA%\dsh-bash-native\tools\bin</code>），没有程序就用随包工具链。填了则照用，空目录也算数（不会悄悄换成随包那份）</td>
    </tr>
    <tr>
      <td><code>bashPath</code></td>
      <td><code>''</code></td>
      <td>引擎绝对路径；空 = 按解析顺序找</td>
    </tr>
    <tr>
      <td><code>bundledEngineDir</code></td>
      <td><code>''</code></td>
      <td>自带引擎目录，先探 <code>brush.exe</code> 再探 <code>bin/brush.exe</code></td>
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
      <td>校验力度：<code>stamped</code> 只在产物或运行副本的 size/mtime 变化时重新哈希；<code>always</code> 每次解析都哈希（引擎 31 MB、工具链 76 MB）</td>
    </tr>
  </tbody>
</table>

---

## 🧰 工具链

**工具链随包分发，装完即用。**

<details open>
<summary><b>📚 28 个名字，公布其中 20 个</b></summary>

<br>

| 类别 | 内容 |
|---|---|
| **公布**（20） | `grep`、`sed`<sub>0.1.5同步上游版本</sub>、`awk`、`jq`、`find`、`xargs`、`diff`、`cmp`、`which`、`timeout`、`stat`、`ps`，以及 `tty`、`nohup`、`nice`、`uptime`、`hostid`、`pathchk`、`locate`、`updatedb` |
| **只装不公布**（8） | `arch` 与 shell 内建 `echo`、`printf`、`pwd`、`test`、`true`、`false`、`kill`——留作子进程要用的程序形态 |

</details>

<br>

- **遮蔽语义无关的同名 Windows 程序**：如 `find.exe`、`timeout.exe`；但 `convert.exe` 工具链**没有**对应实现，因此仍会命中 Windows 的卷转换工具，**别当 ImageMagick 用**。
- **支持与引擎相同的 `/tmp` 与盘符别名**（仍然推荐使用 `$TMP`），“程序再启动程序”的链同样成立：`printf '/tmp/f\n' | xargs awk '{print}'`；引擎自带的那些名字在这条路上同样改写（补丁 `0016`），`printf '/tmp/x\n' | xargs rm` 拿到的是真实临时路径而不是字面量。
- **顺带把 `bash`、`sh` 与引擎自带的 75 个工具名一起放到 `PATH` 上**（工具链目录在前，**名字目录**紧随其后，两者都排在宿主原有 `PATH` 之前）：

  > `src/shim.ts` 在 `%LOCALAPPDATA%\dsh-bash-native\shim\<引擎 sha256>\` 里把这 77 个名字指向已校验引擎——同卷时全是**硬链接**，77 个名字共用引擎那一份字节——引擎再按自己的文件名分派到 bundled 实现（补丁 `0016`）——子进程 exec 不到 shell 内建，`xargs rm`、`find . -exec rm {} +` 只能按名字找程序，工具链也就不再重复发布这 75 个名字（旧布局的 103 个名字降到 28）。

  于是 `bash script.sh`、`bash -c …`、`sh -c …` 与调用 `bash` 的 Makefile/npm 钩子都能用；**按路径直接执行脚本暂不成立**（`./s.sh`）。

---

## ⚠️ 已知限制

- **brush 在 Windows 平台仍处于 preview 阶段**，有存在缺陷的可能。
- shell 不为某个后台作业登记进程时，判活要用 `wait` 而不是 `kill -0`。
- **命令替换里的 `jobs` / `jobs -p` 看到空表**；`kill` 一次只接受一个目标（`kill %1 %2` 报 2）；Windows 不送信号，任何信号都以 **128+n** 结束（TERM 143、KILL 137）。
- **读端提前关闭（断管）时**，bundled 工具与外部程序用的是它们自己的措辞和退出码：

  | 命令 | 写端退出码 | 备注 |
  |---|:---:|---|
  | `seq 1 200000 \| head -c 1` | `0` | stderr 打 `write error: Broken pipe` |
  | `yes \| head -c 1` | `0` | 不吭声 |
  | `cat big \| head -c 1` | `13` | — |
  | `ls -R 某目录 \| head -c 1` | `1` | — |
  | 引擎自己的内建 | `141` | 正确结束 |

  这是 Windows 没有 `SIGPIPE` 的后果（每个工具各自决定断管怎么办），因此**别只凭 `PIPESTATUS[0]` 判断写端成败**。
- **盘符改写分不清路径与程序的脚本操作数**：`awk '/x/{print}'` 到手是 `X:\{print}`、`sed '/x/d'` 报 `invalid command code`；改写 `awk '$0 ~ /x/'`，或对那条命令设 `DSH_BASH_NATIVE_NO_PATHCONV=1`。
- **别名改写只看文本不看意图**：以 `/tmp` 开头的**数据**参数也会被改写（`grep /tmp/x file` 会去找临时路径）；逃生开关同样是 `DSH_BASH_NATIVE_NO_PATHCONV=1`，开启后所有参数原样传递。
- **`select` 暂不支持**——含它的整条命令在**解析期**即失败。
- **没有 `exec`，也没有 `ulimit`**：前者要换进程映像，后者的资源表是按 `rlimit::Resource` 定型的，Windows 上整个 crate 都不存在，只能报几个没有对应物的兼容数字。

---

## 📄 许可

| 内容 | 许可 | 声明与扫描 |
|---|:---:|---|
| 本插件 | **MIT** | [LICENSE](LICENSE) |
| brush 引擎 | **MIT** | [engine/LICENSE.brush](engine/LICENSE.brush)、依赖扫描 [engine/THIRD-PARTY.md](engine/THIRD-PARTY.md) |
| 随包工具链 | **MIT** | uutils `coreutils`/`findutils`/`grep`/`sed`、`jaq`、`goawk`、仓库内 `posix-extra`；[toolchain/LICENSES/](toolchain/LICENSES/) 与 [toolchain/THIRD-PARTY.md](toolchain/THIRD-PARTY.md) |

---

## 🙏 参考与致谢

本插件的引擎补丁里，有一批缺陷是 **[oh-my-pi](https://github.com/can1357/oh-my-pi)** 先诊断出来并修好的。
它是背景灵感，也是 Windows 原生 bash 方案的先行实现。

oh-my-pi 是 MIT 许可，其声明随引擎产物发布在 [`engine/THIRD-PARTY.md`](engine/THIRD-PARTY.md)。

<!-- ═══════════════════════════════════════════════════════════════════════ -->
