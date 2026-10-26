#!/usr/bin/env bash
# case: alias-chain-attached-option-value
# category: alias
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
snippet <<'CASE_084'
printf 'x\n' > /tmp/alias-opt.txt; xargs -a /tmp/alias-opt.txt echo read-ok
CASE_084

expect_status 0
expect_stdout_equals $'read-ok x\n'
finish 'alias-chain-attached-option-value'
