#!/usr/bin/env bash
# case: alias-chain-xargs-awk
# category: alias
# severity: must-match
# needs: xargs awk
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs awk
snippet <<'CASE_079'
printf 'ok\n' > /tmp/alias-a.txt; printf '/tmp/alias-a.txt\n' | xargs awk '{print}'
CASE_079

expect_status 0
expect_stdout_equals $'ok\n'
finish 'alias-chain-xargs-awk'
