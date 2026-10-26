#!/usr/bin/env bash
# case: shell-printf-refused-conversion-status
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_206'
printf '%d' notanumber >/dev/null 2>/dev/null; echo "rc=$?"
CASE_206

expect_status 0
expect_stdout_equals $'rc=1\n'
finish 'shell-printf-refused-conversion-status'
