#!/usr/bin/env bash
# case: wait-n-internal-job
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_159'
sleep 0.1 & wait -n; echo "rc=$?"
CASE_159

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'wait-n-internal-job'
