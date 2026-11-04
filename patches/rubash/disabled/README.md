# 暂停的补丁

这个目录里的 `.patch` **不参与构建**：`scripts/build-engine.mjs` 只应用 `engine.lock.json` 的 `patches` 列表，而这里是一个子目录，扫描补丁目录时不会命中。放在这里是为了保留原文，等下面列出的条件满足后整段移回上一级、加进 lock 即可。

## 150-004-file-commands-with-no-external-implementation.patch

**暂停于** 2026-11-04（插件 0.3.3 周期）。

**它做什么**：把 `chmod`/`mkfifo` 的不可解析轴从 `FailClosed` 改成 `Unchecked`（没有外部程序时也由进程内副本作答），并把 `handle_external_file_builtins` 的门闸从裸谓词改成查注册表的双轴策略。

**为什么暂停**：

1. `chmod` 只覆盖「模式 + 操作数」的形状。选项一律经 `chmod_declines` 回落到 `PATH`，而 Windows 上没有 `chmod` 程序（uutils 不发布），所以 `chmod -R 755`、`chmod -w f`、`chmod 4755 f` 仍然是 127——补丁只买到一部分惯用式。
2. 盘符路径（`D:\…`）只同步 Windows 只读位，模拟的 mode store 只对非盘符路径（`/tmp/…`）生效，所以 `chmod 600` 在项目目录里"成功但无效果"。
3. `mkfifo` 创建 7 字节的 WinuxCmd marker 之后，本部署里 rendezvous 不成立：读端把 marker 当普通文件读完，写端要么 `EACCES`、要么永久阻塞（`mkfifo p; echo hi > p & cat p` 实测 rc=124 超时）。1.4.3 是干净的 `Operation not supported`（rc=1）。挂起比 127 严重，因此不启用。

**恢复条件**：上游把 `chmod` 的选项语义（`-R`/`-w`/`-v` 不再回落）与盘符路径语义补全，并且 `mkfifo` 的命名管道桥接在没有 WinuxCmd 工具的部署里可用。届时：

1. `git mv patches/rubash/disabled/150-004-file-commands-with-no-external-implementation.patch patches/rubash/`；
2. 在 `engine.lock.json` 的 `patches` 数组末尾加回该路径；
3. 更新 `patches/rubash/README.md` 的编号字典（把状态改回"生效"）；
4. `node scripts/build-engine.mjs --refresh` 重建产物，再跑 `npm test` 与语料，并给语料补 `chmod` 与 `mkfifo` 的用例。

**折中做法**（上游只修了一半时）：只把 `chmod` 那一半移回来——删掉补丁里 `mkfifo` 的那一行 `Unchecked`，让 `mkfifo` 保持 `FailClosed`（127），`chmod` 恢复进程内作答。