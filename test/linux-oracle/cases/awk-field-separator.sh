#!/usr/bin/env bash
# case: awk-field-separator
# category: awk
# severity: must-match
# needs: awk
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs awk
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_067'
awk -F: '{print $2}' b.txt
CASE_067

expect_status 0
expect_stdout_lines $'1\n2\n'
finish 'awk-field-separator'
