#!/usr/bin/env bash
# case: grep-files-with-matches
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_041'
grep -l needle a.txt b.txt
CASE_041

expect_status 0
expect_stdout_contains 'a.txt'
expect_stdout_excludes 'b.txt'
finish 'grep-files-with-matches'
