#!/usr/bin/env bash
# case: grep-basic
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_037'
grep needle a.txt
CASE_037

expect_status 0
expect_stdout_lines $'needle\nneedle\n'
finish 'grep-basic'
