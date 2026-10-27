#!/usr/bin/env bash
# case: grep-env-pipeline
# category: grep
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
snippet <<'CASE_050'
env | grep -q PATH; echo $?
CASE_050

expect_status 0
expect_stdout_equals $'0\n'
finish 'grep-env-pipeline'
