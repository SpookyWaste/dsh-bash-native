#!/usr/bin/env bash
# case: find-name
# category: find
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_070'
find . -name "*.txt"
CASE_070

expect_status 0
expect_stdout_contains 'a.txt'
finish 'find-name'
