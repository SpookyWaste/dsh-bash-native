#!/usr/bin/env bash
# case: argv-unquoted-variable-expands
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_031'
p='*.txt'; echo $p
CASE_031

expect_status 0
expect_stdout_contains 'a.txt'
finish 'argv-unquoted-variable-expands'
