#!/usr/bin/env bash
# case: shell-printf-failure-does-not-linger
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_208'
printf '%d' x >/dev/null 2>/dev/null; printf 'ok\n'; echo "rc=$?"
CASE_208

expect_status 0
expect_stdout_equals $'ok\nrc=0\n'
finish 'shell-printf-failure-does-not-linger'
