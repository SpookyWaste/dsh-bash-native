#!/usr/bin/env bash
# case: grep-invert
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_040'
grep -v needle a.txt
CASE_040

expect_status 0
expect_stdout_equals $'hay\n'
finish 'grep-invert'
