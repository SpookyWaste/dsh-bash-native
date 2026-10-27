#!/usr/bin/env bash
# case: pipe-small-loop-is-served
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_142'
i=0; while [ $i -lt 5 ]; do echo loop; i=$((i+1)); done | head -1
CASE_142

expect_status 0
expect_stdout_equals $'loop\n'
finish 'pipe-small-loop-is-served'
