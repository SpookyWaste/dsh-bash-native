#!/usr/bin/env bash
# case: test-ef-different-files
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_198'
[[ a.txt -ef b.txt ]]; echo $?
CASE_198

expect_status 0
expect_stdout_equals $'1\n'
finish 'test-ef-different-files'
