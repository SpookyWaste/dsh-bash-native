#!/usr/bin/env bash
# case: shell-function-local
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_018'
f() { local x=1; echo "$x"; }; f
CASE_018

expect_status 0
expect_stdout_equals $'1\n'
finish 'shell-function-local'
