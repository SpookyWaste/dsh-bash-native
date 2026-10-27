#!/usr/bin/env bash
# case: redirection-bundled-stdout-to-stderr
# category: descriptor
# severity: must-match
# needs: seq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs seq
snippet <<'CASE_219'
seq 1 3 >&2
CASE_219

expect_status 0
expect_stdout_equals $''
finish 'redirection-bundled-stdout-to-stderr'
