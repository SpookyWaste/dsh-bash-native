#!/usr/bin/env bash
# case: builtin-history-without-history
# category: shell
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_119'
history; echo "rc=$?"
CASE_119

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'builtin-history-without-history'
