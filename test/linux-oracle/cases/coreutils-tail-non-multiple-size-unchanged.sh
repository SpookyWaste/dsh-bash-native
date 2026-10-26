#!/usr/bin/env bash
# case: coreutils-tail-non-multiple-size-unchanged
# category: coreutils
# severity: must-match
# needs: head tail wc yes
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs head tail wc yes
snippet <<'CASE_211'
yes 1234567 | head -n 8189 > h.txt; wc -c < h.txt; tail -n 2 h.txt
CASE_211

expect_status 0
expect_stdout_equals $'65512\n1234567\n1234567\n'
finish 'coreutils-tail-non-multiple-size-unchanged'
