#!/usr/bin/env bash
# case: test-ef-same-file
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_197'
[[ a.txt -ef a.txt ]]; echo $?
CASE_197

expect_status 0
expect_stdout_equals $'0\n'
finish 'test-ef-same-file'
