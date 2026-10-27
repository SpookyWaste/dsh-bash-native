#!/usr/bin/env bash
# case: sed-delete-last
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_054'
sed '$d' a.txt
CASE_054

expect_status 0
expect_stdout_lines $'needle\nhay\n'
finish 'sed-delete-last'
