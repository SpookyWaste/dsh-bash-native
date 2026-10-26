#!/usr/bin/env bash
# case: redirection-bundled-stderr-to-stdout
# category: descriptor
# severity: must-match
# needs: tail
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs tail
snippet <<'CASE_218'
tail no-such-file 2>&1
CASE_218

expect_status 1
expect_stdout_contains 'no-such-file'
finish 'redirection-bundled-stderr-to-stdout'
