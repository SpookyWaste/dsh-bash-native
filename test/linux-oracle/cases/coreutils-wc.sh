#!/usr/bin/env bash
# case: coreutils-wc
# category: coreutils
# severity: must-match
# needs: wc
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs wc
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_100'
wc -l a.txt
CASE_100

expect_status 0
expect_stdout_matches '\b3\b'
finish 'coreutils-wc'
