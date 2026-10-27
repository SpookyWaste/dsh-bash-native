#!/usr/bin/env bash
# case: process-jobs-p-reports-pid
# category: process
# severity: must-match
# needs: node
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs node
snippet <<'CASE_108'
node -e "setTimeout(()=>{},300)" & jobs -p
CASE_108

expect_status 0
expect_stdout_matches '^[0-9]+$'
finish 'process-jobs-p-reports-pid'
