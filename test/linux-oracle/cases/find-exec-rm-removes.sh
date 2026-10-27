#!/usr/bin/env bash
# case: find-exec-rm-removes
# category: find
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
snippet <<'CASE_086'
printf 'x\n' > gone.txt; find . -name gone.txt -exec rm {} \;; test -e gone.txt && echo still-there || echo removed
CASE_086

expect_status 0
expect_stdout_equals $'removed\n'
finish 'find-exec-rm-removes'
