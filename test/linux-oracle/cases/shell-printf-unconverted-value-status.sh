#!/usr/bin/env bash
# case: shell-printf-unconverted-value-status
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_207'
printf '%d' 08 >/dev/null 2>/dev/null; echo "rc=$?"
CASE_207

expect_status 0
expect_stdout_equals $'rc=1\n'
finish 'shell-printf-unconverted-value-status'
