#!/usr/bin/env bash
# case: process-compound-stage-concurrency
# category: process
# severity: must-match
# needs: head seq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs head seq
snippet <<'CASE_192'
for i in $(seq 1 20000); do echo x; done | head -1
CASE_192

expect_status 0
expect_stdout_equals $'x\n'
finish 'process-compound-stage-concurrency'
