#!/usr/bin/env bash
# case: grep-count
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_038'
grep -c needle a.txt
CASE_038

expect_status 0
expect_stdout_equals $'2\n'
finish 'grep-count'
