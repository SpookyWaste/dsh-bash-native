#!/usr/bin/env bash
# case: cmp-identical
# category: diff
# severity: must-match
# needs: cmp
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs cmp
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_094'
cmp a.txt a.txt; echo rc=$?
CASE_094

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'cmp-identical'
