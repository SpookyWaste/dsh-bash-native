#!/usr/bin/env bash
# case: awk-sum
# category: awk
# severity: must-match
# needs: awk
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs awk
printf '%s' $'1 two\n3 four\n' > 'c.txt'

snippet <<'CASE_068'
awk '{s+=$1} END {print s}' c.txt
CASE_068

expect_status 0
expect_stdout_equals $'4\n'
finish 'awk-sum'
