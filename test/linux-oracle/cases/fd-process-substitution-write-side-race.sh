#!/usr/bin/env bash
# case: fd-process-substitution-write-side-race
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_151'
echo hi > >(cat); sleep 0.5
CASE_151

expect_status 0
expect_stdout_equals $'hi\n'
finish 'fd-process-substitution-write-side-race'
