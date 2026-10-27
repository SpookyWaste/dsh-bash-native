#!/usr/bin/env bash
# case: fd-process-substitution-child-stdin
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_149'
cat < <(echo hi)
CASE_149

expect_status 0
expect_stdout_equals $'hi\n'
finish 'fd-process-substitution-child-stdin'
