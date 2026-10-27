#!/usr/bin/env bash
# case: coreutils-md5sum-shape
# category: coreutils
# severity: must-match
# needs: cut md5sum wc
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs cut md5sum wc
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_102'
md5sum a.txt | cut -c1-32 | wc -c
CASE_102

expect_status 0
expect_stdout_matches '\b33\b'
finish 'coreutils-md5sum-shape'
