#!/usr/bin/env bash
# case: sed-bre-escaped-plus
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_057'
printf 'aaa\n' | sed 's/a\+/X/'
CASE_057

expect_status 0
expect_stdout_equals $'X\n'
finish 'sed-bre-escaped-plus'
