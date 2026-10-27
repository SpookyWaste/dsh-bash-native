#!/usr/bin/env bash
# case: shell-read-splits-fields
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_024'
printf 'x y\n' | { read -r a b; echo "$b-$a"; }
CASE_024

expect_status 0
expect_stdout_equals $'y-x\n'
finish 'shell-read-splits-fields'
