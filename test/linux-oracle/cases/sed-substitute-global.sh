#!/usr/bin/env bash
# case: sed-substitute-global
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_053'
sed 's/needle/N/g' a.txt
CASE_053

expect_status 0
expect_stdout_lines $'N\nhay\nN\n'
finish 'sed-substitute-global'
