#!/usr/bin/env bash
# case: process-kill-one-target
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_189'
"$BASH" -c 'i=0; while [ $i -lt 300000 ]; do i=$((i+1)); done' & kill "$!"; printf 'rc=%s\n' "$?"
CASE_189

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'process-kill-one-target'
