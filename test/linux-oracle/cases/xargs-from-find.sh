#!/usr/bin/env bash
# case: xargs-from-find
# category: xargs
# severity: must-match
# needs: find xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find xargs
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_090'
find . -name "b.txt" | xargs cat
CASE_090

expect_status 0
expect_stdout_lines $'x:1\ny:2\n'
finish 'xargs-from-find'
