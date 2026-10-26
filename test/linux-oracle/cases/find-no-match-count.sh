#!/usr/bin/env bash
# case: find-no-match-count
# category: find
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_073'
find . -name "zzz*" | wc -l
CASE_073

expect_status 0
expect_stdout_matches '\b0\b'
finish 'find-no-match-count'
