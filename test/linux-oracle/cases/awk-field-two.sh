#!/usr/bin/env bash
# case: awk-field-two
# category: awk
# severity: must-match
# needs: awk
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs awk
printf '%s' $'1 two\n3 four\n' > 'c.txt'

snippet <<'CASE_066'
awk '{print $2}' c.txt
CASE_066

expect_status 0
expect_stdout_lines $'two\nfour\n'
finish 'awk-field-two'
