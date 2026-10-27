#!/usr/bin/env bash
# case: sed-in-place
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_056'
sed -i 's/needle/N/' a.txt; head -1 a.txt
CASE_056

expect_status 0
expect_stdout_equals $'N\n'
finish 'sed-in-place'
