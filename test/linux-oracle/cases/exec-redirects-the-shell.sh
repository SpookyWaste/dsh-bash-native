#!/usr/bin/env bash
# case: exec-redirects-the-shell
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_220'
exec 3>&1; exec > exec-out.txt; echo hi; exec 1>&3; cat exec-out.txt
CASE_220

expect_status 0
expect_stdout_equals $'hi\n'
finish 'exec-redirects-the-shell'
