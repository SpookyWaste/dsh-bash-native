#!/usr/bin/env bash
# case: process-kill-zero-unknown-pid
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_164'
kill -0 999999; echo "rc=$?"
CASE_164

expect_status 0
expect_stdout_equals $'rc=1\n'
finish 'process-kill-zero-unknown-pid'
