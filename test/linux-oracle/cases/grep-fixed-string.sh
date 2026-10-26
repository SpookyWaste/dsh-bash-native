#!/usr/bin/env bash
# case: grep-fixed-string
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_043'
grep -F needle a.txt
CASE_043

expect_status 0
expect_stdout_lines $'needle\nneedle\n'
finish 'grep-fixed-string'
