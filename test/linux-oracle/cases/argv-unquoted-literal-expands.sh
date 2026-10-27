#!/usr/bin/env bash
# case: argv-unquoted-literal-expands
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_032'
echo *.txt
CASE_032

expect_status 0
expect_stdout_contains 'a.txt'
finish 'argv-unquoted-literal-expands'
