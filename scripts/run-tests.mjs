// 跑 test/ 下所有 test-*.mjs，逐个用当前 Node 进程执行并汇总结果。
// 存在的意义：本地与 CI 共用一条入口（npm test），不依赖任何 shell 的 glob 语义。
// 子套件用 stdio 继承，输出直接进终端/CI 日志，不经管道中转。
//
// 子套件的 TMP/TEMP 被指到仓库里的 `.tmp-run/`：受限会话里 `%TEMP%` 对引擎不可写，夹具建在那里会让
// 用例在“写文件”这一步失败，看起来像引擎行为不同。仓库树在该会话里可写，所以临时目录挪进来。
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const suites = readdirSync(new URL("../test/", import.meta.url))
  .filter((name) => name.startsWith("test-") && name.endsWith(".mjs"))
  .sort();

if (suites.length === 0) {
  console.error("run-tests: test/ 目录下没有找到任何 test-*.mjs");
  process.exit(1);
}

const scratch = fileURLToPath(new URL("../.tmp-run/", import.meta.url));
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const env = { ...process.env, TMP: scratch, TEMP: scratch, TMPDIR: scratch };

const failed = [];
for (const suite of suites) {
  const file = fileURLToPath(new URL(`../test/${suite}`, import.meta.url));
  const result = spawnSync(process.execPath, [file], { stdio: "inherit", env });
  const ok = result.status === 0;
  if (!ok) failed.push(suite);
  console.log(`${ok ? "ok  " : "FAIL"}  ${suite}`);
}

console.log(`\n${suites.length - failed.length}/${suites.length} 套件通过`);
if (failed.length > 0) {
  console.error(`失败：${failed.join(", ")}`);
  process.exit(1);
}
