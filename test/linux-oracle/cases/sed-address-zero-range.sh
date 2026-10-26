#!/usr/bin/env bash
# case: sed-address-zero-range
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_061'
printf 'a\nb\nc\n' | sed '0,/b/d'
CASE_061

expect_status 0
expect_stdout_equals $'c\n'
finish 'sed-address-zero-range'
