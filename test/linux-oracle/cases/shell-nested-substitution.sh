#!/usr/bin/env bash
# case: shell-nested-substitution
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_025'
echo "$(echo "$(echo deep)")"
CASE_025

expect_status 0
expect_stdout_equals $'deep\n'
finish 'shell-nested-substitution'
