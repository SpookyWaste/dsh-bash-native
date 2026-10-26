#!/usr/bin/env bash
# case: sed-bre-escaped-question
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_058'
printf 'ab\n' | sed 's/ab\?/X/'
CASE_058

expect_status 0
expect_stdout_equals $'X\n'
finish 'sed-bre-escaped-question'
