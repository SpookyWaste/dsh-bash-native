#!/usr/bin/env bash
# case: find-type-name
# category: find
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_071'
find . -type f -name "b.txt"
CASE_071

expect_status 0
expect_stdout_contains 'b.txt'
expect_stdout_excludes 'a.txt'
finish 'find-type-name'
