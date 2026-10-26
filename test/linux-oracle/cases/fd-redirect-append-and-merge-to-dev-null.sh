#!/usr/bin/env bash
# case: fd-redirect-append-and-merge-to-dev-null
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_213'
echo x >> /dev/null; echo y &> /dev/null; echo "rc=$?"
CASE_213

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'fd-redirect-append-and-merge-to-dev-null'
