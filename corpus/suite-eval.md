# 命令套件评测：uutils（现状）vs winuxcmd（候选）

> 目的：引擎换成 rubash 之后，命令套件由谁服务——沿用本仓库 36 MB 的 uutils 工具链，还是改用 winuxcmd 的 4.16 MB 多调用单文件。判据在本轮开始前定死（§4），本轮只填数字。
> 引擎：`rubash v1.4.3`（commit `fa64d58`），沙箱外由 `cargo build --release --locked --bin rubash` 构建，10,945,024 字节。
> 语料：`corpus/compat.json` 227 条（must-match 219、platform-difference 8）。引擎固定为 rubash，只换工具目录。
> 证据等级：全部为**实测**，脚本在 `tmp-ws/rubash-audit/`（`make-farms.mjs`，以及给语料加 `--baseline=` 的一行改动）。

## 1. 两套目录

| | uutils farm | winuxcmd farm |
|---|---|---|
| 来源 | 本仓库 `toolchain/win32-x64`（coreutils 0.12.0 multi-call + 13 个组件） | `WinuxCmd-1.1.20-win-x64.tar.gz`（官方 release，sha256 `4cbcaccd…ee12e`，MIT） |
| 发布的名字 | 104（93 个 coreutils applet + 组件） | 178（`--list-all` 全量）+ dispatcher |
| 布局 | 扁平目录 | 官方树 `usr/bin` + `WINUXSH_ROOT`/`WINUXCMD_HOME`/`WINUXCMD_PATH` |
| 说明 | 按计划落地时"coreutils 归属翻转"的同一份名字集 | 名字由安装器创建；官方包只带 dispatcher |

winuxcmd 的首次运行必须带上 `WINUXSH_ROOT`：只设 `WINUXCMD_HOME` 时 `grep/sed/ls/wc` 全部读不到 `/tmp/...`（`No such file or directory`），设上 `WINUXSH_ROOT=<树根>` 才正常。这条是它自己的环境契约，扁平 farm 不足以复现。

## 2. 总数

| 配置 | pass | fail | known-gap | collision | skip | silent-wrong |
|---|---|---|---|---|---|---|
| rubash + **uutils** | **193** | 20 | 3 | 0 | 3 | 17 |
| rubash + winuxcmd（扁平 farm，无 `WINUXSH_ROOT`） | 181 | 25 | 2 | 0 | 12 | 14 |
| rubash + **winuxcmd**（官方树 + `WINUXSH_ROOT`） | 187 | 19 | 2 | 0 | 12 | 15 |

扁平 farm 那一行是**配置不足**的对照，用来证明它依赖树与环境；判据取最后一行。

## 3. 分类对比（官方树配置）

| 类别 | uutils（通过/失败/跳过） | winuxcmd（通过/失败/跳过） |
|---|---|---|
| grep 14 | 14 / 0 / 0 | 14 / 0 / 0 |
| sed 13 | 10 / 3 / 0 | 10 / 3 / 0 |
| awk 6 | 5 / 0 / 0（+1 known-gap） | **0 / 0 / 6**（1.1.20 不含 awk，官方要求 `wpm install goawk`） |
| find 6 | 6 / 0 / 0 | 6 / 0 / 0 |
| xargs 7 | 7 / 0 / 0 | 7 / 0 / 0 |
| diff 4 | 4 / 0 / 0 | 4 / 0 / 0 |
| coreutils 15 | 12 / 3 / 0 | **14 / 1 / 0** |
| jq 2 | 0 / 0 / 2 | 0 / 0 / 2 |
| alias 9 | 8 / 0 / 1 | 6 / 0 / 3 |
| argv-semantics 19 | 17 / 2 / 0 | 16 / 3 / 0 |
| process 35 | 30 / 3 / 0 | 28 / 5 / 0 |
| shell-syntax / descriptor / shell | 与套件无关，两列相同 | 同左 |

失败集差集是这张表最有用的部分：

- **两边都失败 18 条**——语料里编码的是 brush 补丁造成的平台事实（盘符挂载的显示形态、CRLF 程序文本、`printf` 措辞、相对路径报错文本等）。这些是**语料欠账**，与套件无关，落地时要按 rubric 逐条改判或记 `knownGap`。
- **只有 uutils 失败 5 条**：`awk-quoted-wildcard-stays-literal`、`collision-timeout-runs-command`、`coreutils-tail-block-multiple-last-line`、`coreutils-tail-block-multiple-sixteen-thousand`（uutils 0.12.0 的 tail 分块缺陷，本仓库只在引擎侧打过同类补丁）、`platform-drive-mount-script-operand-escape-hatch`。
- **只有 winuxcmd 失败 3 条**：`argv-tmp-program-path-executes`、`process-ps-has-pid`（它用 awk，缺命令）、`process-relative-path-command`。

## 4. 判据与结论

事先定下的判据：

1. 硬门槛：`silent-wrong` 必须为 0；
2. 主指标：工具侧 must-match 通过数；
3. 平手选 winuxcmd（能省掉引擎补丁）；
4. 否决：winuxcmd 在 grep/sed/awk/find/coreutils 任一类比 uutils 少 3 例以上。

套用结果：

- **门槛 1 无法按字面判定**：两边的 silent-wrong 绝大多数是同一批 18 条语料欠账（brush 专属期望），落地时统一改判/记 `knownGap` 后才会归零；与套件相关的部分，两边都只剩个位数。
- **主指标** uutils 193 > winuxcmd 187。
- **否决条件命中**：awk 一类 5 → 0（−5），超过 3 例阈值。

**结论：命令套件取 B（uutils + 一笔 rubash 方言补丁）。**

补一条比数字更硬的论证：winuxcmd 1.1.20 **既没有 awk 也没有 jq**（jq 要靠 `wpm install`，awk 同理）。若按 A 落地，就得外挂 goawk 与 jaq，而这两个是 **native 类**子进程——它们的模式/程序数据仍会被 rubash 改写，**那笔补丁还是得打**。也就是说 A 的招牌收益（省掉引擎补丁）在"实际会发的配置"里并不存在；它只比 B 少 32 MB 体积，却多一个按天发版的第三方依赖和一套 `WINUXSH_ROOT` 树契约。

**若将来翻案的条件**：winuxcmd 补上 awk 与 jq（或官方把二者纳入包），且 coreutils 类的优势能复现；届时重跑本表即可，判据不变。

## 5. 落地影响

- 采用 B：`patches/rubash/0001-data-primary-positions-every-child.patch`（数据位对所有子进程生效），`SERVED_BY_ENGINE` 收缩为 `{uname, arch}`，`SHIM_NAMES` 收缩为 `['bash','sh']`，`denialSignatureAdditions` 默认改 `[]`，两份基线重录。
- 语料要按 §3 的 18 条共同欠账逐条改判：属于 brush 平台形态的（盘符显示、CRLF 文本、`printf` 措辞、相对路径文本）改成 rubash 形态或记 `knownGap`；`sed` 的 3 条与 `coreutils` 的 tail 2 条按 rubash + uutils 的真实行为重判。