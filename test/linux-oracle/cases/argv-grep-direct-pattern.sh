#!/usr/bin/env bash
# case: argv-grep-direct-pattern
# category: argv-semantics
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_035'
grep -c "[ab].txt" a.txt
CASE_035

expect_status 1
expect_stdout_equals $'0\n'
finish 'argv-grep-direct-pattern'
