#!/usr/bin/env bash
# case: fd-redirect-input-from-dev-null
# category: descriptor
# severity: must-match
# needs: wc
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs wc
snippet <<'CASE_214'
wc -c < /dev/null
CASE_214

expect_status 0
expect_stdout_equals $'0\n'
finish 'fd-redirect-input-from-dev-null'
