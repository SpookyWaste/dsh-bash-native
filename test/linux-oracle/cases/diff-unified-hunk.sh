#!/usr/bin/env bash
# case: diff-unified-hunk
# category: diff
# severity: must-match
# needs: diff
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs diff
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'b\na\nb\n' > 'd.txt'

snippet <<'CASE_091'
diff -u a.txt d.txt | head -1
CASE_091

expect_status 0
expect_stdout_contains '---'
finish 'diff-unified-hunk'
