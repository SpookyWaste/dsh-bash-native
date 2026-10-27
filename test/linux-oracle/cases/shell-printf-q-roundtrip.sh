#!/usr/bin/env bash
# case: shell-printf-q-roundtrip
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_020'
v='a b'; eval "echo $(printf '%q' "$v")"
CASE_020

expect_status 0
expect_stdout_equals $'a b\n'
finish 'shell-printf-q-roundtrip'
