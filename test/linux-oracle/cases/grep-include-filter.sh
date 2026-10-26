#!/usr/bin/env bash
# case: grep-include-filter
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_046'
grep -rn --include='*.txt' needle .
CASE_046

expect_status 0
expect_stdout_contains 'a.txt'
expect_stdout_excludes 'b.txt'
finish 'grep-include-filter'
