#!/usr/bin/env bash
# case: nested-subshell-parens
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_221'
( (echo IN) )
CASE_221

expect_status 0
expect_stdout_equals $'IN\n'
finish 'nested-subshell-parens'
