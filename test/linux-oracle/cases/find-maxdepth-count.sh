#!/usr/bin/env bash
# case: find-maxdepth-count
# category: find
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'
printf '%s' $'1 two\n3 four\n' > 'c.txt'
printf '%s' $'b\na\nb\n' > 'd.txt'
printf '%s' $'10\n9\n2\n' > 'n.txt'

snippet <<'CASE_072'
find . -maxdepth 1 -name "*.txt" | wc -l
CASE_072

expect_status 0
expect_stdout_matches '\b5\b'
finish 'find-maxdepth-count'
