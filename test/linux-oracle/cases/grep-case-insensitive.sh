#!/usr/bin/env bash
# case: grep-case-insensitive
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_044'
grep -i NEEDLE a.txt
CASE_044

expect_status 0
expect_stdout_lines $'needle\nneedle\n'
finish 'grep-case-insensitive'
