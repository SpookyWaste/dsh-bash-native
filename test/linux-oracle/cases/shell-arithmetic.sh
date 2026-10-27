#!/usr/bin/env bash
# case: shell-arithmetic
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_021'
echo $((2+3*4))
CASE_021

expect_status 0
expect_stdout_equals $'14\n'
finish 'shell-arithmetic'
