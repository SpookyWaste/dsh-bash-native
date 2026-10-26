#!/usr/bin/env bash
# case: coreutils-tail-block-multiple-last-line
# category: coreutils
# severity: must-match
# needs: head tail wc yes
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs head tail wc yes
snippet <<'CASE_209'
yes 1234567 | head -n 8192 > f.txt; wc -c < f.txt; tail -n 1 f.txt
CASE_209

expect_status 0
expect_stdout_equals $'65536\n1234567\n'
finish 'coreutils-tail-block-multiple-last-line'
