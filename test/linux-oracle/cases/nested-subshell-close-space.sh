#!/usr/bin/env bash
# case: nested-subshell-close-space
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_223'
( (echo IN))
CASE_223

expect_status 0
expect_stdout_equals $'IN\n'
finish 'nested-subshell-close-space'
