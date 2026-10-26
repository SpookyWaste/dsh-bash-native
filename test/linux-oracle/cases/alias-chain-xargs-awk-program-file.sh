#!/usr/bin/env bash
# case: alias-chain-xargs-awk-program-file
# category: alias
# severity: must-match
# needs: xargs awk
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs awk
snippet <<'CASE_080'
printf '{print}' > /tmp/alias-awk-prog.awk; printf 'ok\n' > /tmp/alias-awk-prog.txt; printf '/tmp/alias-awk-prog.awk\n' | xargs -I{} awk -f {} /tmp/alias-awk-prog.txt
CASE_080

expect_status 0
expect_stdout_equals $'ok\n'
finish 'alias-chain-xargs-awk-program-file'
