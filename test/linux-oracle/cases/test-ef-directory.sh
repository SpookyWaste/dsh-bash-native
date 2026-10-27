#!/usr/bin/env bash
# case: test-ef-directory
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_200'
mkdir -p d; [[ d -ef ./d ]]; echo $?
CASE_200

expect_status 0
expect_stdout_equals $'0\n'
finish 'test-ef-directory'
