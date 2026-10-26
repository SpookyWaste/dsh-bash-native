#!/usr/bin/env bash
# case: process-kill-accepts-several-targets
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_188'
"$BASH" -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done' & "$BASH" -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done' & kill %1 %2; printf 'rc=%s\n' "$?"; true
CASE_188

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'process-kill-accepts-several-targets'
