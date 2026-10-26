#!/usr/bin/env bash
# case: coreutils-stat-size
# category: coreutils
# severity: must-match
# needs: stat
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs stat
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_105'
stat -c %s a.txt
CASE_105

expect_status 0
expect_stdout_equals $'18\n'
finish 'coreutils-stat-size'
