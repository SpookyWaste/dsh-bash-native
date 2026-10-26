#!/usr/bin/env bash
# case: grep-in-pipeline
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
snippet <<'CASE_049'
printf 'a\nb\n' | grep -c .
CASE_049

expect_status 0
expect_stdout_equals $'2\n'
finish 'grep-in-pipeline'
