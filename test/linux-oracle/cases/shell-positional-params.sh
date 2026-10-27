#!/usr/bin/env bash
# case: shell-positional-params
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_019'
f() { echo "$#:$1:${2:-d}"; }; f a
CASE_019

expect_status 0
expect_stdout_equals $'1:a:d\n'
finish 'shell-positional-params'
