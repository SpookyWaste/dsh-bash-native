#!/usr/bin/env bash
# case: coreutils-uniq-count
# category: coreutils
# severity: must-match
# needs: uniq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs uniq
snippet <<'CASE_099'
printf 'a\na\nb\n' | uniq -c
CASE_099

expect_status 0
expect_stdout_contains '2 a'
finish 'coreutils-uniq-count'
