#!/usr/bin/env bash
# case: process-kill-list-signals
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_111'
kill -l 15
CASE_111

expect_status 0
expect_stdout_contains 'TERM'
finish 'process-kill-list-signals'
