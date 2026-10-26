#!/usr/bin/env bash
# case: grep-no-match-status
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_048'
grep zzz a.txt > /dev/null 2>&1; echo rc=$?
CASE_048

expect_status 0
expect_stdout_equals $'rc=1\n'
finish 'grep-no-match-status'
