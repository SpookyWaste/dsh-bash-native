#!/usr/bin/env bash
# case: grep-quiet-status
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_047'
grep -q needle a.txt; echo $?
CASE_047

expect_status 0
expect_stdout_equals $'0\n'
finish 'grep-quiet-status'
