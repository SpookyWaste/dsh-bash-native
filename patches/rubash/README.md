# rubash 的补丁

当前 pin 是 **v1.5.0**（`29bbf52481c36fc477135fee08d6fb0a8435b8a9`），生效三笔：`150-001`–`150-003`。第四笔 `150-004` 暂停在 `disabled/`（原因与恢复条件见该目录的 README），**不参与构建**。每一笔都带 `dsh-bash-native patch` 标记，`scripts/build-engine.mjs` 在应用后用 `git grep` 断言 `src/` 里能看到它——避免"diff 打上了但没人编译"。

## 命名规则

文件名是 `<引擎版本去掉 v 和点>-<序号>-<slug>.patch`：v1.5.0 → `150`，v1.4.3 → `143`。序号在**一个 pin 内**从 `001` 起连续编号，所以一个名字同时说明了「属于哪个 pin」与「在这个 pin 里的次序」。

- 升级 pin 时整组进新前缀：同一个问题被带到新版本的补丁保留 slug、在新 pin 里重新排序（v1.4.3 的 `143-005` 就是现在 `150-001`）。
- 暂停的补丁放在本目录的 `disabled/` 子目录里：构建脚本只扫描本级、只应用 `engine.lock.json` 列出的文件，所以它不会被应用，也不会触发"多出来的补丁"那条检查。
- 退役不是留空号，而是**删文件**：`scripts/build-engine.mjs` 只应用 `engine.lock.json` 列出的那一组，并拒绝目录里多出来的、少掉的或前缀不对的文件，所以"旧补丁还留着"会在构建时立刻失败，而不是打到一个它已不认识的代码树上。
- 每个 pin 的编号都记在下面的字典里；编号在**同一个 pin 内**不复用，跨 pin 的同名由前缀区分。

## 编号字典

### v1.5.0（当前，`150-*`）

| 编号 | 作用 | 旧平面编号 |
|---|---|---|
| `150-001` | `cd` 进背后有真实目录的虚拟根（`/tmp`、`/home`）时同步 **session cwd**（1.5.0 的 cwd 是会话状态，1.4.3 的 `env::set_current_dir` 写法失效，实现重写） | `0005` / `143-005` |
| `150-002` | locale 族未设时，Windows 上默认 UTF-8 语义（`${#v}` 按字符、`[[:alpha:]]` 认 CJK） | `0006` |
| `150-003` | `uname`/`arch` 在 `PATH` 上没有程序时仍作答（MSYS 人设可达） | `0007` |
| `150-004` | `chmod`/`mkfifo` 同上，并把文件内置命令的门闸改为查注册表双轴策略 | `0008`（**暂停**：`chmod` 只覆盖部分形状、`mkfifo` 的 rendezvous 挂起，见 `disabled/README.md`） |

### v1.4.3（历史，`143-*`，文件已删除）

v1.4.3 那一组的原文与说明在 git 历史里（`v0.3.x` 及更早的 `patches/rubash/`）。

| 编号 | 作用 | 状态 |
|---|---|---|
| `143-001` | 数据位（grep/sed/awk 的模式、脚本、程序文本）对**所有**子进程类生效 | 退役：上游 PR [#2069](https://github.com/unixwin/rubash/pull/2069) / issue #2063，带署名与我们的单测 |
| `143-002` | 启动时丢弃 Unicode 表示不了的环境项，而不是 panic | 退役：上游 PR [#2070](https://github.com/unixwin/rubash/pull/2070)，并扩到库/Session 摄入面 |
| `143-003` | `RUBASH_FILE_COMMANDS_FROM_PATH`：指定哪些进程内文件命令改从 `PATH` 执行 | 退役：症状面由上游以「让位」机制修掉（#1636/#1462/#2065/#2066，PR #2074/#2077）；开关归上游 #2036 的注册表 `enable` 字段，本插件侧整条策略面已删除 |
| `143-004` | 末段管道的抽干线程在进程内生产者**之前**启动 | 退役：上游 `rubash#2244`，1.5.0 内已带回归 |
| `143-005` | `cd` 进有真实目录的虚拟根时让进程也跟着走 | 被 `150-001` 取代（1.5.0 改成 session cwd，实现重写） |

### 旧平面编号对照

2026-11-03 之前的文档与提交信息用的是不带版本前缀的 `0001`–`0005`（v1.4.3 那组）；升级到 1.5.0 的当次提交短暂用过 `0005`–`0008`。对照：

| 旧编号 | 现编号 |
|---|---|
| `0001` | `143-001` |
| `0002` | `143-002` |
| `0003` | `143-003` |
| `0004` | `143-004` |
| `0005` | `143-005`（→ `150-001`） |
| `0005`–`0008`（1.5.0 当次） | `150-001`–`150-004` |

## 150-001-cd-into-virtual-roots-with-a-real-directory.patch

**症状**（对未打补丁的 1.5.0 实测）：

```
cd /tmp; pwd                                    # /tmp
cd /tmp; node -e 'console.log(process.cwd())'   # 仍是 cd 之前的目录
cd /tmp; ls                                     # 列出的还是 cd 之前的目录
cd /tmp; cat rel.txt                            # 找不到 rel.txt
```

**根因**：1.5.0 把 cwd 从进程状态改成会话状态（`builtins/cd.rs` 的 G-02 注释：`*cwd = physical`），但虚拟根桥接分支没有同步改造。`logical_posix_test_dir`（`cd.rs:653`）对 `/`、`/bin`、`/etc`、`/tmp`、`/usr` 这五个名字返回 `Some`，调用点（`cd.rs:169-211`）只写 `PWD`/`OLDPWD`/`DIRSTACK`/`__RUBASH_PHYSICAL_PWD` 就 `return`，**不碰 `*cwd`**。1.4.3 时代我们用 `env::set_current_dir` 补救，在 1.5.0 已经没有意义——子进程拿的是 session cwd，不是进程 cwd。

**改法**：在 `refresh_dirstack_top` 之后、写 `__RUBASH_PHYSICAL_PWD` 之前补一次会话 cwd：

```rust
if logical_dir != "/" && target.path.is_dir() {
    *cwd = crate::executor::path::canonicalize_native(&target.path)
        .unwrap_or_else(|_| target.path.clone());
}
```

**边界**：`/` 保持"只改逻辑状态"——没有配置 shell root 时它不指向任何唯一目录；`/usr`、`/etc`、`/bin` 没有真实目录可去，桥照旧；`pushd`/`popd` 不在这一笔里（1.5.0 的 pushd 已经比 1.4.3 更接近正确，但 `pwd -P` 与 `popd` 仍与 GNU 有差）。显示语义不变：`pwd`、`$PWD`、`pwd -P`、`cd -` 仍是 `/tmp`。

**验证**：`test/test-brush-regressions.mjs` 的 `engine 150-001` 用例；语料 `cd-tmp-reaches-a-relative-operand`；`cd /tmp; node -e 'process.cwd()'` 落在 `%TEMP%`。

**上游化**：这是上游自己 `logical_posix_test_dir` 的漏判（桥的 TODO 仍在代码里），按 issue 提交，附 `cd /tmp` 的三条实测与 `pushd` 的现状。

## 150-002-default-a-unset-locale-family-to-utf-8-on-windows.patch

**症状**（1.5.0 原版，未设 `LC_ALL`/`LC_CTYPE`/`LANG`）：

```
v=中文; echo ${#v}                      # 6（1.4.3 是 2：按字节而不是按字符）
case 中 in [[:alpha:]]*) echo alpha;;   # other（CJK 不算字母）
v=中文abc; echo "${v:0:2}"              # 切出半个字符
```

**根因**：1.5.0 的 `locale_name_selects_utf8("")` 返回 `false`（`src/locale.rs:188`，按 GNU 语义把"未设 locale 族"解释成 C locale），而 `init_locale()` 只在 `#[cfg(unix)]` 分支做事（`src/locale.rs:909`）；1.4.3 的 `locale_request_active()` 对空名字返回 `true`，所以 1.4.3 默认就是 UTF-8。Windows 没有 POSIX locale archive 可解析，而本引擎又专门保留 MSYS 人设（UTF-8 是脚本生态的默认假设），这个默认值对本部署是回归。

**改法**：空名字在 Windows 上返回 `true`：

```rust
if name.is_empty() {
    return cfg!(windows);
}
```

**边界**：显式写 `LC_ALL=C`、`LC_ALL=POSIX` 或任何命名 locale 仍然生效（包括 `C.UTF-8`）；非 Windows 保持 C 默认不变。

**验证**：`src/verify.ts` 的签名事实（`${#v} == 2`）从"拒绝引擎"变成"通过"；语料里中文相关用例；`LC_ALL=C` 下仍按字节（与 GNU 一致）。

**上游化**：这是上游 1.5.0 locale 大改的副作用，按 issue 提交（请上游给 Windows 一个「locale 族未设 → UTF-8」的默认或开关）。

## 150-003-identity-tools-answer-without-a-path-program.patch

**症状**（1.5.0 原版，随包配置：工具链在 `PATH` 上）：

```
uname -s      # bash: line 1: uname: command not found（rc=127）
arch          # 同上
```

**根因**：1.5.0 把所有进程内仿真改成 GNU findcmd 模型——名字在 `PATH` 上解析不到就让位给一次必然失败的 spawn。`uname`/`arch` 的行是 `ScriptYield/FailClosed`（`src/executor/command_registry.rs:623`、`:638`），而本插件的工具链**按设计不发布**这两个名字（`src/toolchain.ts` 的 `ENGINE_BUILTINS`，理由正是"身份不外包给 PATH"），于是 MSYS 人设不可达。上游 `docs/builtins.md` 自己也写着 rubash#154「身份不外包给 PATH」，与注册表的不可解析轴自相矛盾。

**改法**：两行的不可解析轴改为 `Unchecked`（注册表语义：即使解析不到也作答）。可解析轴保留 `ScriptYield`：`PATH` 上的同名脚本仍会运行（nvm 的 mock `uname` 就是这个形状），native image 解析仍是进程内人设。

**边界**：只在"名字完全解析不到"时改变行为；有真实 `uname.exe` 时与 1.5.0 原逻辑一致（进程内人设优先）。

**验证**：`node -e "readEngineVersion(...)"`（`src/verify.ts`）从两条失败事实降到一条（locale）；`uname -s` = `MSYS_NT-…`、`arch` = `x86_64`；`test/test-package.mjs` 的 persona 断言。

**上游化**：按 issue 提交，建议 `Unchecked`，或按 #2036 的注册表 `enable` 字段给宿主一个开关。

## 150-004-file-commands-with-no-external-implementation.patch（暂停，文件在 `disabled/`）

> ⚠️ **这一笔当前不生效**。保留本节是为了恢复时不用重写理由；暂停原因与恢复条件见 `disabled/README.md`。

**症状**（1.5.0 原版，随包配置；1.4.3 两者都正常）：

```
chmod +x f.sh   # bash: line 1: chmod: command not found（rc=127）
mkfifo p        # bash: line 1: mkfifo: command not found（rc=127）
```

**根因**：`chmod`/`mkfifo` 的行是 `Replace/FailClosed`（`command_registry.rs:745`、`:790`），且 `handle_external_file_builtins` 的门闸用的是裸谓词 `emulated_external_stands_down`（`external_file_builtins.rs:22`）而不是注册表的双轴策略。这两个名字在无 MSYS 的 Windows 上**不可能有外部实现**：uutils 不发布 Windows 版 `chmod`（没有权限位）与 `mkfifo`（需要命名管道），本仓库的工具链注释早就记着"把它们送到 PATH 会把 `chmod +x` 变成 command not found"。

**改法**：两行改 `Unchecked`；同时把文件内置命令的门闸改成 `self.registered_stand_down(name)`，让注册表的双轴策略在这一面真正生效。`FailClosed` 的行行为完全不变（策略在"不可解析"时与裸谓词等价），`Replace` 的行在有程序时仍是进程内副本作答。

**边界**：有真实程序时行为不变；`xargs chmod`/`find -exec chmod` 仍会执行 `PATH` 上的程序（如果有）；本插件的工具链提供 `cat`/`rm`/`cp`/`mkdir` 等，故只有 `chmod`/`mkfifo` 受这一笔的"不可解析也作答"影响。

**验证**：`chmod +x f.sh` rc=0、`mkfifo p` 落盘；语料与 `test/test-package.mjs` 的 rm/cat 行为不变。

**上游化**：与 `150-003` 合并成一个 issue（同一类：无 MSYS 部署里"不可解析"不等于"GNU 的 not found"）。提交时还要同步改注册表的两条一致性断言（`command_registry.rs` 里「row-level Unchecked 必须为空」的测试与 per-face 记录表）。

## 升级 rubash 时

`scripts/build-engine.mjs` 每次构建都会 `git reset --hard` 到 pin，然后**按 `engine.lock.json` 的 `patches` 顺序**应用本目录的补丁——不是按目录里有什么。它先核对：列出的文件都在、目录里没有多出来的、每个文件名都带当前 pin 的版本前缀（`v1.5.0` → `150-`）。补丁若与新的 pin 冲突会在这里失败，而不是产出一个行为不对的引擎。

换 pin 时的检查清单：

1. 逐笔对照上游。上游合入后，删除对应的 `.patch`，把编号写进「编号字典」的历史表（同一个 pin 内的编号不复用），并在 `engine.lock.json` 的 `note`/`why` 里更新原因。
2. 留下来的补丁整组进新前缀（如 `150-001` → `151-001`），slug 不变、序号在新 pin 内重排；`engine.lock.json` 的 `patches` 数组同步。
3. 改完 lock（`tag`/`ref`/`patches`/`note`/`why`）再跑构建脚本；它只重写 `artifact`，手写字段会被保留。
4. 暂停某一笔时把它移到 `disabled/` 并从 lock 的 `patches` 删掉，同时在字典里标"暂停"；恢复时反向操作。
5. 构建后必须重跑 `scripts/license-scan.mjs --checkout=<checkout>`（`Cargo.lock` 可能变）与全套 `npm test` + 语料。