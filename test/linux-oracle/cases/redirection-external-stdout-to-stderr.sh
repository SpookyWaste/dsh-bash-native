#!/usr/bin/env bash
# case: redirection-external-stdout-to-stderr
# category: descriptor
# severity: must-match
# needs: node
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs node
snippet <<'CASE_217'
node -e "console.log('hi')" >&2
CASE_217

expect_status 0
expect_stdout_equals $''
finish 'redirection-external-stdout-to-stderr'
