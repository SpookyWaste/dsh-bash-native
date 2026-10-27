#!/usr/bin/env bash
# case: shell-trap-exit
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_011'
trap 'echo bye' EXIT; echo hi
CASE_011

expect_status 0
expect_stdout_lines $'hi\nbye\n'
finish 'shell-trap-exit'
