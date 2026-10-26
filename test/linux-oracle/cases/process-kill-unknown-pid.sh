#!/usr/bin/env bash
# case: process-kill-unknown-pid
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_163'
kill 999999; echo "rc=$?"
CASE_163

expect_status 0
expect_stdout_equals $'rc=1\n'
finish 'process-kill-unknown-pid'
