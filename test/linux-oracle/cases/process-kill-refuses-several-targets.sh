#!/usr/bin/env bash
# case: process-kill-refuses-several-targets
# category: process
# severity: must-match
# known-gap: docs/research.md「命令替换里的作业表与 kill 的单目标」的「kill 一次只接受一个目标」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_188'
"$BASH" -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done' & "$BASH" -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done' & kill %1 %2; printf 'rc=%s\n' "$?"; kill %1; kill %2
CASE_188

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'process-kill-refuses-several-targets'
