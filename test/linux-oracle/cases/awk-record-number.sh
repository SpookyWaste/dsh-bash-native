#!/usr/bin/env bash
# case: awk-record-number
# category: awk
# severity: must-match
# needs: awk
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs awk
printf '%s' $'1 two\n3 four\n' > 'c.txt'

snippet <<'CASE_069'
awk 'NR==2' c.txt
CASE_069

expect_status 0
expect_stdout_equals $'3 four\n'
finish 'awk-record-number'
