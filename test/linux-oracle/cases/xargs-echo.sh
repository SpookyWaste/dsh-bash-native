#!/usr/bin/env bash
# case: xargs-echo
# category: xargs
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_075'
printf 'a.txt\n' | xargs wc -l
CASE_075

expect_status 0
expect_stdout_contains 'a.txt'
finish 'xargs-echo'
