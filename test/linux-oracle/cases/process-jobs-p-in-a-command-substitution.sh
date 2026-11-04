#!/usr/bin/env bash
# case: process-jobs-p-in-a-command-substitution
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_187'
"$BASH" -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done' & jobs -p > pids.txt; printf 'direct=[%s] substitution=[%s]\n' "$(cat pids.txt)" "$(jobs -p)"; kill %1
CASE_187

expect_status 0
expect_stdout_matches '^direct=\[[0-9]+\] substitution=\[[0-9]+\]$'
finish 'process-jobs-p-in-a-command-substitution'
