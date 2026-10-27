#!/usr/bin/env bash
# case: xargs-rm-removes
# category: xargs
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
snippet <<'CASE_085'
printf 'gone.txt\n' > gone.txt; printf 'gone.txt\n' | xargs rm; test -e gone.txt && echo still-there || echo removed
CASE_085

expect_status 0
expect_stdout_equals $'removed\n'
finish 'xargs-rm-removes'
