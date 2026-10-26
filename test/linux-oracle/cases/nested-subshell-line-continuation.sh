#!/usr/bin/env bash
# case: nested-subshell-line-continuation
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_224'
(\
(\
10 + 3)); echo rc=$?
CASE_224

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'nested-subshell-line-continuation'
