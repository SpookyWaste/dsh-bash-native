#!/usr/bin/env bash
# case: shell-crlf-passthrough
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_027'
printf 'x\r\n' | wc -c
CASE_027

expect_status 0
expect_stdout_matches '\b3\b'
finish 'shell-crlf-passthrough'
