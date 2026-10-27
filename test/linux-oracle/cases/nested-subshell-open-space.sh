#!/usr/bin/env bash
# case: nested-subshell-open-space
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_222'
((echo IN) )
CASE_222

expect_status 0
expect_stdout_equals $'IN\n'
finish 'nested-subshell-open-space'
