#!/usr/bin/env bash
# case: builtin-umask-symbolic
# category: shell
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_118'
umask -S
CASE_118

expect_status 0
expect_stdout_equals $'u=rwx,g=rx,o=rx\n'
finish 'builtin-umask-symbolic'
