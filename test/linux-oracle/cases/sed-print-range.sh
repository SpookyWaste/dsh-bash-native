#!/usr/bin/env bash
# case: sed-print-range
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_052'
sed -n 1,2p a.txt
CASE_052

expect_status 0
expect_stdout_lines $'needle\nhay\n'
finish 'sed-print-range'
