#!/usr/bin/env bash
# case: crlf-escape-produced-carriage-return-is-data
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_185'
printf 'a\r\nb' | wc -c
CASE_185

expect_status 0
expect_stdout_equals $'4\n'
finish 'crlf-escape-produced-carriage-return-is-data'
