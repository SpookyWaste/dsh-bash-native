#!/usr/bin/env bash
# case: process-function-stage-concurrency
# category: process
# severity: must-match
# needs: head seq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs head seq
snippet <<'CASE_193'
f() { for i in $(seq 1 20000); do echo x; done; }; f | head -1
CASE_193

expect_status 0
expect_stdout_equals $'x\n'
finish 'process-function-stage-concurrency'
