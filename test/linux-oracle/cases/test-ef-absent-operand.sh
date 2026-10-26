#!/usr/bin/env bash
# case: test-ef-absent-operand
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_199'
[[ a.txt -ef absent.txt ]]; echo $?
CASE_199

expect_status 0
expect_stdout_equals $'1\n'
finish 'test-ef-absent-operand'
