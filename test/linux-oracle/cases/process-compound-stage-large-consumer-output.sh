#!/usr/bin/env bash
# case: process-compound-stage-large-consumer-output
# category: process
# severity: must-match
# needs: seq head
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs seq head
snippet <<'CASE_228'
big=$(printf 'x%.0s' $(seq 1 70000)); { printf '%s\n' "$big"; } | head -1 > got.txt; line=$(cat got.txt); echo ${#line}
CASE_228

expect_status 0
expect_stdout_equals $'70000\n'
finish 'process-compound-stage-large-consumer-output'
