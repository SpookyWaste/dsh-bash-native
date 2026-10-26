#!/usr/bin/env bash
# case: alias-chain-bare-mount-root-is-a-switch
# category: alias
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
snippet <<'CASE_083'
printf '/c\n' | xargs -n1 echo
CASE_083

expect_status 0
expect_stdout_equals $'/c\n'
finish 'alias-chain-bare-mount-root-is-a-switch'
