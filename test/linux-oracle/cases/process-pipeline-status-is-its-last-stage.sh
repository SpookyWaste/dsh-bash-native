#!/usr/bin/env bash
# case: process-pipeline-status-is-its-last-stage
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_203'
cd /definitely/absent 2>/dev/null | true; echo "rc=$?"
CASE_203

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'process-pipeline-status-is-its-last-stage'
