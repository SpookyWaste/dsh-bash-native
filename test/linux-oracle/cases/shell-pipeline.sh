#!/usr/bin/env bash
# case: shell-pipeline
# category: shell-syntax
# severity: must-match
# needs: sort uniq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sort uniq
snippet <<'CASE_000'
printf 'b\na\nb\n' | sort | uniq -c
CASE_000

expect_status 0
expect_stdout_matches '1 a' '2 b'
finish 'shell-pipeline'
