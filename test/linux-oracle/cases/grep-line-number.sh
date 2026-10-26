#!/usr/bin/env bash
# case: grep-line-number
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_039'
grep -n needle a.txt
CASE_039

expect_status 0
expect_stdout_matches '^1:needle'
finish 'grep-line-number'
