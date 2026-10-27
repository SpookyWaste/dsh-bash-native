#!/usr/bin/env bash
# case: process-kill-zero-self
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_112'
kill -0 $$; echo rc=$?
CASE_112

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'process-kill-zero-self'
