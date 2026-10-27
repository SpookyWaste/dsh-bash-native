#!/usr/bin/env bash
# case: shell-exit-code
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_010'
false; echo $?
CASE_010

expect_status 0
expect_stdout_equals $'1\n'
finish 'shell-exit-code'
