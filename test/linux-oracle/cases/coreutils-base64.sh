#!/usr/bin/env bash
# case: coreutils-base64
# category: coreutils
# severity: must-match
# needs: base64
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs base64
snippet <<'CASE_103'
printf 'a\n' | base64
CASE_103

expect_status 0
expect_stdout_equals $'YQo=\n'
finish 'coreutils-base64'
