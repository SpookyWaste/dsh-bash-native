#!/usr/bin/env bash
# case: process-pipeline-builtin-failure-honors-its-stderr-redirect
# category: process
# severity: must-match
# known-gap: docs/research.md「rubash 的已知差异」的「自带工具层：管道里内建命令的重定向诊断」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_202'
cd /definitely/absent 2>err.txt | cat; test -s err.txt && echo nonempty || echo empty
CASE_202

expect_status 0
expect_stdout_equals $'nonempty\n'
finish 'process-pipeline-builtin-failure-honors-its-stderr-redirect'
