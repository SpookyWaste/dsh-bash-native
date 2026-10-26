#!/usr/bin/env bash
# case: shell-trap-err
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_012'
(trap 'echo caught' ERR; false) 2>/dev/null; echo done
CASE_012

expect_status 0
expect_stdout_lines $'caught\ndone\n'
finish 'shell-trap-err'
