#!/usr/bin/env bash
# case: builtin-umask-round-trip
# category: shell
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_117'
umask; umask 077; umask; umask 022; umask
CASE_117

expect_status 0
expect_stdout_equals $'0022\n0077\n0022\n'
finish 'builtin-umask-round-trip'
