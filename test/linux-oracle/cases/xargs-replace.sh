#!/usr/bin/env bash
# case: xargs-replace
# category: xargs
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
snippet <<'CASE_088'
printf 'a.txt\n' | xargs -I{} echo "pre-{}"
CASE_088

expect_status 0
expect_stdout_equals $'pre-a.txt\n'
finish 'xargs-replace'
