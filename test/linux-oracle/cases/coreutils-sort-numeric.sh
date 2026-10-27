#!/usr/bin/env bash
# case: coreutils-sort-numeric
# category: coreutils
# severity: must-match
# needs: sort
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sort
printf '%s' $'10\n9\n2\n' > 'n.txt'

snippet <<'CASE_097'
sort -n n.txt
CASE_097

expect_status 0
expect_stdout_lines $'2\n9\n10\n'
finish 'coreutils-sort-numeric'
