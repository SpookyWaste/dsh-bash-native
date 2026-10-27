#!/usr/bin/env bash
# case: diff-quiet-same
# category: diff
# severity: must-match
# needs: diff
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs diff
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_093'
diff -q a.txt a.txt > /dev/null 2>&1; echo rc=$?
CASE_093

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'diff-quiet-same'
