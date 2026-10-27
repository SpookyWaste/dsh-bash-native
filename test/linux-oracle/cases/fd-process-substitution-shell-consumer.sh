#!/usr/bin/env bash
# case: fd-process-substitution-shell-consumer
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_148'
read x < <(echo hi); echo "x=$x"
CASE_148

expect_status 0
expect_stdout_equals $'x=hi\n'
finish 'fd-process-substitution-shell-consumer'
