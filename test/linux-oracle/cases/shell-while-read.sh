#!/usr/bin/env bash
# case: shell-while-read
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_016'
printf 'a\nb\n' | while read -r l; do echo "L:$l"; done
CASE_016

expect_status 0
expect_stdout_lines $'L:a\nL:b\n'
finish 'shell-while-read'
