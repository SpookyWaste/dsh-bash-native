#!/usr/bin/env bash
# case: argv-find-direct-pattern
# category: argv-semantics
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_036'
find . -name "[ab].txt"
CASE_036

expect_status 0
expect_stdout_contains 'a.txt'
finish 'argv-find-direct-pattern'
