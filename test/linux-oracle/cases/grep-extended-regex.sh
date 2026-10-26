#!/usr/bin/env bash
# case: grep-extended-regex
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_042'
grep -E '^n(eedle)?' a.txt
CASE_042

expect_status 0
expect_stdout_lines $'needle\nneedle\n'
finish 'grep-extended-regex'
