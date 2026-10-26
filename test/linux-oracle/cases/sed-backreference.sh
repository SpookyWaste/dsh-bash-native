#!/usr/bin/env bash
# case: sed-backreference
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_055'
printf 'abc\n' | sed 's/b/[&]/'
CASE_055

expect_status 0
expect_stdout_equals $'a[b]c\n'
finish 'sed-backreference'
