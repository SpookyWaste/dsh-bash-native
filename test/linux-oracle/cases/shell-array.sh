#!/usr/bin/env bash
# case: shell-array
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_002'
a=(x y); a+=(z); echo "${#a[@]} ${a[2]}"
CASE_002

expect_status 0
expect_stdout_equals $'3 z\n'
finish 'shell-array'
