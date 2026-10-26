#!/usr/bin/env bash
# case: sed-address-step
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_062'
printf '1\n2\n3\n4\n' | sed -n '0~2p'
CASE_062

expect_status 0
expect_stdout_equals $'2\n4\n'
finish 'sed-address-step'
