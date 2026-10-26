#!/usr/bin/env bash
# case: sed-print-line
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_051'
sed -n 1p a.txt
CASE_051

expect_status 0
expect_stdout_equals $'needle\n'
finish 'sed-print-line'
