#!/usr/bin/env bash
# case: process-pipeline-builtin-failure-does-not-end-the-script
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_201'
cd /definitely/absent 2>/dev/null | cat; echo after
CASE_201

expect_status 0
expect_stdout_equals $'after\n'
finish 'process-pipeline-builtin-failure-does-not-end-the-script'
