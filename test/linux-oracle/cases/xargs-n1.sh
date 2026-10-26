#!/usr/bin/env bash
# case: xargs-n1
# category: xargs
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
snippet <<'CASE_087'
printf '1\n2\n' | xargs -n1 echo item
CASE_087

expect_status 0
expect_stdout_lines $'item 1\nitem 2\n'
finish 'xargs-n1'
