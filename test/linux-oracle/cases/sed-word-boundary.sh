#!/usr/bin/env bash
# case: sed-word-boundary
# category: sed
# severity: must-match
# needs: sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_063'
printf 'foo x\n' | sed 's/\bfoo\b/bar/'
CASE_063

expect_status 0
expect_stdout_equals $'bar x\n'
finish 'sed-word-boundary'
