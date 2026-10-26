#!/usr/bin/env bash
# case: builtin-wait-f-unknown-pid
# category: shell
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_123'
wait -f 999999 2>/dev/null; echo "rc=$?"
CASE_123

expect_status 0
expect_stdout_equals $'rc=127\n'
finish 'builtin-wait-f-unknown-pid'
