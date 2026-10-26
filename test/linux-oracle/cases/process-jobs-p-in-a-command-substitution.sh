#!/usr/bin/env bash
# case: process-jobs-p-in-a-command-substitution
# category: process
# severity: must-match
# known-gap: docs/research.md「命令替换里的作业表与 kill 的单目标」的「命令替换里的 jobs 与 jobs -p 是空表」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_187'
"$BASH" -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done' & jobs -p > pids.txt; printf 'direct=[%s] substitution=[%s]\n' "$(cat pids.txt)" "$(jobs -p)"; kill %1
CASE_187

expect_status 0
expect_stdout_matches '^direct=\[[0-9]+\] substitution=\[[0-9]+\]$'
finish 'process-jobs-p-in-a-command-substitution'
