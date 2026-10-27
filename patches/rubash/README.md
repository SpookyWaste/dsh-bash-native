# rubash 的补丁

这个目录里有**三笔**补丁：两笔修引擎自己的语义缺陷（`0001`、`0003`），一笔是 Windows 平台上的取舍（`0002`）。每一笔都带 `dsh-bash-native patch` 标记，`scripts/build-engine.mjs` 在应用后用 `git grep` 断言 `src/` 里能看到它——避免"diff 打上了但没人编译"。

## 0001-data-primary-positions-every-child.patch

**症状**（对未打补丁的 1.4.3 实测，命令套件为本仓库工具链）：

```
grep -F '/tmp/probe' p.txt     # 内容就是 /tmp/probe，却静默不匹配
sed -n '/tmp/probe/p' p.txt    # sed.exe: <script argument 1>:1:1: error: invalid command code `C'
awk '/tmp/probe/{print}' p.txt # <cmdline>:1:2: expected , instead of :
```

**根因**：`src/executor/path.rs` 里 `argv_data_primary_positions(command_name, args)` 只在 `posix_aware` 类子进程上计算；其余子进程拿到空集，于是 `translated_virtual_system_root_argument` 把任何以 `/tmp`、`/usr`、`/etc`、`/home`、`/mnt/…` 或盘符 `/c/` 开头的词都改写成 Win32 拼写——包括 grep 的模式、sed 的脚本和 awk 的程序。

**改法**（三处，全部在 `#[cfg(windows)]` 内）：

1. 数据位集合改为对**所有**子进程计算；
2. `translated_virtual_system_root_argument` 的调用跳过数据位；
3. 逐类分支里，native 子进程的数据位原样返回，路径操作数照旧走 `external_argument_path`。

**边界**：`-e/--regexp` 的值是数据（原样），`-f/--file` 的值是路径（翻译）——这条区分上游已有，补丁没有动它。补丁自带一条单测 `data_primary_positions_hold_for_native_children`。

**上游化**：这是对第三方命令套件同样成立的缺陷，应当按 issue/PR 提交给 `unixwin/rubash`；合入后删掉本文件、把 `engine.lock.json` 的 `patches` 里对应的一行去掉即可，行为探针（`src/verify.ts` 与语料里的数据位用例）保留作回归。

## 0002-drop-undecodable-environment-entries.patch

**症状**：Windows 能把一条 Unicode 表示不了的环境项（例如名字里带未配对代理项）交给子进程，而 `std::env::vars()` 遇到它会 panic——引擎在第一条命令之前 abort，退出码和诊断都不可用。

**根因**：GNU bash 把环境当字节串读，解不出来的条目原样留着；本引擎的变量表是 `String`，启动时对 `vars()` 的 `unwrap` 就成了硬失败。

**改法**：`src/main.rs` 的 `main()` 开头调用 `drop_undecodable_environment_entries()`，用 `vars_os()` 过滤掉名字或值 `to_str()` 为 `None` 的条目。代价是那一条变量，而不是整条命令链。

**边界**：只影响 Win32 能塞进环境块、Unicode 表示不了的条目；正常环境一字不改。

**上游化**：可以按加固提交（"一次 panic 不该来自环境"），但上游若选择保留字节语义，这一笔就要一直带着。

## 0003-file-commands-from-path.patch

**症状**（1.4.3 + 本仓库补丁，`tools/bin` 已在 `PATH` 上）：

```
printf 'aaaa\n' | sed 's/a\{2,3\}/X/'   # 输出 aaaa：进程内的 sed 不认 \{m,n\}、\b、\|
rmdir d/.                               # 把 d 删掉，rc=0
rmdir /definitely/absent                # 静默成功，rc=0
```

**根因**：`src/executor/external_file_builtins.rs` 在进程内实现 `mkdir touch chmod cp rm rmdir cat sed mkfifo tty`（以及 `/bin/pwd`、`/bin/printf`、`/bin/cat`、`/bin/tty` 的绝对拼写）的**简单形态**，复杂形态才落到 `PATH`。这份副本是同一批命令的第二套实现：`sed` 只有一个手写的 `s/pat/rep/` 与 `Nd` 匹配器，`rmdir` 对每个操作数 `let _ = fs::remove_dir(...)` 后无条件 `exit_code = 0`。装了 POSIX 工具链的 shell 没有任何办法要求"用程序，别用副本"。

**改法**：

1. 新增 `RUBASH_FILE_COMMANDS_FROM_PATH`：`all`/`on`/`1` 全部走 `PATH`，`none`/`off`/`0`/未设立走进程内，其余按逗号或空白分隔的名字列表；名字与命令的基本名大小写不敏感地比较，所以 `cat` 同时覆盖 `/bin/cat`、`/usr/bin/cat`。
2. **从 shell 自己的变量表读**，不是进程启动时读一次 `std::env`：持久 PTY 会话继承的是宿主环境、不经过执行器的 spawn 环境，只有 `--rcfile` 里的 `export` 能到它手里；`bash -c` 子 shell 也因此继承同一策略。
3. 门闸同时加在**两条**进程内路径上：`handle_external_file_builtins` 的分派，以及 `execute_pipeline_stage_inner` 里内联的 `cat`、`sed` 分支。顺带修掉一个现存不一致——这两条内联分支此前完全不看宿主 API `set_external_file_builtins_enabled`，于是"关掉进程内副本"的宿主在管道里仍会拿到仿真版本。

**边界**：未设这个变量时行为与此前完全一致；变量不清除、不消费，脚本看得见也能 `unset`；名字表只影响上面那 12 个命令，`echo`/`printf`/`pwd`/`test` 等 shell 内建不受影响。补丁自带单测 `policy_table_selects_commands_and_base_names`。

**为什么本插件只用它切两条**：`chmod`、`mkfifo` 在 Windows 上没有可替换的程序（uutils 不发布这两个 applet，`coreutils.exe chmod` 直接报 `unknown program`），切过去只会得到 `command not found`；`cat`/`rm`/`mkdir` 等每次多一次进程创建（实测约 11–13 ms，进程内约 0.05 ms）。所以插件默认 `['sed','rmdir']`，其余留给进程内副本。

**上游化**：这是一个宿主/CLI 级开关，对任何"把 POSIX 工具链放在 `PATH` 上"的 Windows 部署都成立，值得按 issue/PR 提交；上游若只接受库 API 而不接受环境变量，就保留这一笔。

## 升级 rubash 时

`scripts/build-engine.mjs` 每次构建都会 `git reset --hard` 到 pin 再按文件名顺序应用本目录的补丁；补丁若与新的 pin 冲突会在这里失败，而不是产出一个行为不对的引擎。新增补丁时先确认它排在已有补丁之后仍能 `git apply --check`（同一文件的上下文会变）。