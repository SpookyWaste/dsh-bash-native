#!/usr/bin/env bash
# case: shell-printf-partial-output-before-an-error
# category: shell-syntax
# severity: must-match
# needs: wc
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs wc
snippet <<'CASE_204'
printf 'abc%' > o.txt 2>/dev/null; echo "rc=$? bytes=$(wc -c < o.txt)"
CASE_204

expect_status 0
expect_stdout_equals $'rc=1 bytes=3\n'
finish 'shell-printf-partial-output-before-an-error'
