#!/usr/bin/env bash
# case: crlf-program-text-keeps-its-carriage-return
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_184'
printf 'aZ' | wc -c
CASE_184

expect_status 0
expect_stdout_equals $'3\n'
finish 'crlf-program-text-keeps-its-carriage-return'
