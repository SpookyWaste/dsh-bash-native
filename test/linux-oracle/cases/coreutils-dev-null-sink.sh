#!/usr/bin/env bash
# case: coreutils-dev-null-sink
# category: coreutils
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_106'
echo x > /dev/null && echo ok
CASE_106

expect_status 0
expect_stdout_equals $'ok\n'
finish 'coreutils-dev-null-sink'
