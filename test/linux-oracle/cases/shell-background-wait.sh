#!/usr/bin/env bash
# case: shell-background-wait
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_023'
sleep 0.05 & wait; echo done
CASE_023

expect_status 0
expect_stdout_equals $'done\n'
finish 'shell-background-wait'
