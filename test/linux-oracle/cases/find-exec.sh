#!/usr/bin/env bash
# case: find-exec
# category: find
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_074'
find . -name "a.txt" -exec echo FOUND {} \;
CASE_074

expect_status 0
expect_stdout_contains 'FOUND'
finish 'find-exec'
