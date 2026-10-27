#!/usr/bin/env bash
# case: wait-unknown-pid
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_156'
wait 999999; echo "rc=$?"
CASE_156

expect_status 0
expect_stdout_equals $'rc=127\n'
finish 'wait-unknown-pid'
