#!/usr/bin/env bash
# case: xargs-null
# category: xargs
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_089'
printf 'a.txt\0' | xargs -0 wc -l
CASE_089

expect_status 0
expect_stdout_contains 'a.txt'
finish 'xargs-null'
