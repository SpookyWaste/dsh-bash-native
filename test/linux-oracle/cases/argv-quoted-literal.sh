#!/usr/bin/env bash
# case: argv-quoted-literal
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_028'
echo "*.txt"
CASE_028

expect_status 0
expect_stdout_equals $'*.txt\n'
finish 'argv-quoted-literal'
