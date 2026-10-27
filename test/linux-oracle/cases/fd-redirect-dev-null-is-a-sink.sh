#!/usr/bin/env bash
# case: fd-redirect-dev-null-is-a-sink
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_147'
echo hi > /dev/null; echo "rc=$?"
CASE_147

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'fd-redirect-dev-null-is-a-sink'
