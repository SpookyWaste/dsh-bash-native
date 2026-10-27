#!/usr/bin/env bash
# case: alias-chain-xargs-grep-finds
# category: alias
# severity: must-match
# needs: xargs grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs grep
snippet <<'CASE_077'
printf 'needle\n' > /tmp/alias-g.txt; printf '/tmp/alias-g.txt\n' | xargs grep -l needle | wc -l
CASE_077

expect_status 0
expect_stdout_equals $'1\n'
finish 'alias-chain-xargs-grep-finds'
