#!/usr/bin/env bash
# case: shell-assoc-array
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_003'
declare -A m=([k]=v); echo "${m[k]}"
CASE_003

expect_status 0
expect_stdout_equals $'v\n'
finish 'shell-assoc-array'
