#!/usr/bin/env bash
# case: coreutils-cut
# category: coreutils
# severity: must-match
# needs: cut
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs cut
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_098'
cut -d: -f2 b.txt
CASE_098

expect_status 0
expect_stdout_lines $'1\n2\n'
finish 'coreutils-cut'
