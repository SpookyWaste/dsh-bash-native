#!/usr/bin/env bash
# case: process-ps-lists
# category: process
# severity: must-match
# needs: ps
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs ps
snippet <<'CASE_113'
ps -e | head -1
CASE_113

expect_status 0
expect_stdout_matches '^[[:space:]]*PID[[:space:]]+TTY[[:space:]]+TIME[[:space:]]+CMD$'
finish 'process-ps-lists'
