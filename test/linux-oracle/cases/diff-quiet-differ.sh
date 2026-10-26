#!/usr/bin/env bash
# case: diff-quiet-differ
# category: diff
# severity: must-match
# needs: diff
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs diff
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'b\na\nb\n' > 'd.txt'

snippet <<'CASE_092'
diff -q a.txt d.txt > /dev/null 2>&1; echo rc=$?
CASE_092

expect_status 0
expect_stdout_equals $'rc=1\n'
finish 'diff-quiet-differ'
