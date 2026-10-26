# rubash 的补丁

这个目录里只有**一笔**补丁。它修的是引擎的一处语义，而不是为了适配本插件而改行为：引擎把"哪些 argv 位置是数据、哪些是路径"的判断绑在了"子进程是不是 winuxcmd 的命令套件"上，于是第三方命令套件（本仓库的 uutils 工具链、以及上游自己提到过的 `rg`/`bat`/`fd`）会连**模式/脚本/程序文本**一起被路径改写。

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

**边界**：`-e/--regexp` 的值是数据（原样），`-f/--file` 的值是路径（翻译）——这条区分上游已有，补丁没有动它。补丁自带一条单测 `data_primary_positions_hold_for_native_children`，`scripts/build-engine.mjs` 另外在应用后用 `git grep` 断言 `src/` 里留下了 `dsh-bash-native patch` 标记，避免"diff 打上了但没人编译"。

**上游化**：这是对第三方命令套件同样成立的缺陷，应当按 issue/PR 提交给 `unixwin/rubash`；合入后删掉本目录、把 `engine.lock.json` 的 `patches` 置空即可，行为探针（`src/verify.ts` 与语料里的数据位用例）保留作回归。

**升级 rubash 时**：`scripts/build-engine.mjs` 每次构建都会 `git reset --hard` 到 pin 再顺序应用本目录的补丁；补丁若与新的 pin 冲突会在这里失败，而不是产出一个行为不对的引擎。