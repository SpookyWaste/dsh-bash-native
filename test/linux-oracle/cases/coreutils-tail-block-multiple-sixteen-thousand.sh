#!/usr/bin/env bash
# case: coreutils-tail-block-multiple-sixteen-thousand
# category: coreutils
# severity: must-match
# needs: head tail wc yes
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs head tail wc yes
snippet <<'CASE_210'
yes 1234567 | head -n 16384 > g.txt; tail -n 16384 g.txt | wc -l
CASE_210

expect_status 0
expect_stdout_equals $'16384\n'
finish 'coreutils-tail-block-multiple-sixteen-thousand'
