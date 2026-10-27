#!/usr/bin/env bash
# case: shell-subshell-isolation
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_022'
x=1; (x=2); echo $x
CASE_022

expect_status 0
expect_stdout_equals $'1\n'
finish 'shell-subshell-isolation'
