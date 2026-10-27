#!/usr/bin/env bash
# case: fd-process-substitution-argument
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_150'
cat <(echo hi)
CASE_150

expect_status 0
expect_stdout_equals $'hi\n'
finish 'fd-process-substitution-argument'
