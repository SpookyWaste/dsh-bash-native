#!/usr/bin/env bash
# case: argv-single-quoted-literal
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_029'
echo '*.txt'
CASE_029

expect_status 0
expect_stdout_equals $'*.txt\n'
finish 'argv-single-quoted-literal'
