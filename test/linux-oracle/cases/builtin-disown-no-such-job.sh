#!/usr/bin/env bash
# case: builtin-disown-no-such-job
# category: shell
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_121'
disown %7 2>/dev/null; echo "rc=$?"
CASE_121

expect_status 0
expect_stdout_equals $'rc=1\n'
finish 'builtin-disown-no-such-job'
