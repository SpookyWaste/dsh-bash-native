#!/usr/bin/env bash
# case: arithmetic-command-still-parses
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_225'
x=0; ((x++)); echo $x
CASE_225

expect_status 0
expect_stdout_equals $'1\n'
finish 'arithmetic-command-still-parses'
