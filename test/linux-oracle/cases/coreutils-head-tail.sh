#!/usr/bin/env bash
# case: coreutils-head-tail
# category: coreutils
# severity: must-match
# needs: head tail
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs head tail
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_101'
head -1 a.txt; tail -1 a.txt
CASE_101

expect_status 0
expect_stdout_equals $'needle\nneedle\n'
finish 'coreutils-head-tail'
