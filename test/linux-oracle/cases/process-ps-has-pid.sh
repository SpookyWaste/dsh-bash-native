#!/usr/bin/env bash
# case: process-ps-has-pid
# category: process
# severity: must-match
# needs: ps
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs ps
snippet <<'CASE_114'
ps -e | head -2 | tail -1 | awk '{print $1}'
CASE_114

expect_status 0
expect_stdout_matches '^[0-9]+$'
finish 'process-ps-has-pid'
