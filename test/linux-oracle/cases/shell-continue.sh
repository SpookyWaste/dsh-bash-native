#!/usr/bin/env bash
# case: shell-continue
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_017'
for i in 1 2 3; do [ "$i" = 2 ] && continue; echo "$i"; done
CASE_017

expect_status 0
expect_stdout_lines $'1\n3\n'
finish 'shell-continue'
