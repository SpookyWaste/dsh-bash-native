#!/usr/bin/env bash
# case: awk-field-one
# category: awk
# severity: must-match
# needs: awk
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs awk
printf '%s' $'1 two\n3 four\n' > 'c.txt'

snippet <<'CASE_065'
awk '{print $1}' c.txt
CASE_065

expect_status 0
expect_stdout_lines $'1\n3\n'
finish 'awk-field-one'
