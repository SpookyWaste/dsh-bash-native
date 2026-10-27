#!/usr/bin/env bash
# case: coreutils-mktemp-dir
# category: coreutils
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_104'
d=$(mktemp -d) && test -d "$d" && echo ok
CASE_104

expect_status 0
expect_stdout_equals $'ok\n'
finish 'coreutils-mktemp-dir'
