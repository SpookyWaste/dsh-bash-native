#!/usr/bin/env bash
# case: alias-chain-xargs-rm-removes
# category: alias
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
snippet <<'CASE_076'
printf 'x\n' > /tmp/alias-gone.txt; printf '/tmp/alias-gone.txt\n' | xargs rm; test -e /tmp/alias-gone.txt && echo still-there || echo removed
CASE_076

expect_status 0
expect_stdout_equals $'removed\n'
finish 'alias-chain-xargs-rm-removes'
