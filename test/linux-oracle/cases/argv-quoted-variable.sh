#!/usr/bin/env bash
# case: argv-quoted-variable
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_030'
p='*.txt'; echo "$p"
CASE_030

expect_status 0
expect_stdout_equals $'*.txt\n'
finish 'argv-quoted-variable'
