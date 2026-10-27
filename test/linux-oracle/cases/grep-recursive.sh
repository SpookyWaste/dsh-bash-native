#!/usr/bin/env bash
# case: grep-recursive
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_045'
grep -r needle .
CASE_045

expect_status 0
expect_stdout_contains 'needle'
finish 'grep-recursive'
