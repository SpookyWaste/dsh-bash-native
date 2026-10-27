#!/usr/bin/env bash
# case: redirection-external-stderr-to-stdout
# category: descriptor
# severity: must-match
# needs: node
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs node
snippet <<'CASE_216'
node -e "console.error('boom')" 2>&1
CASE_216

expect_status 0
expect_stdout_equals $'boom\n'
finish 'redirection-external-stderr-to-stdout'
