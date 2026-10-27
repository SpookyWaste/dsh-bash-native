#!/usr/bin/env bash
# case: shell-trap-err-in-function-not-errtrace
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_013'
f() { false; }; trap 'echo caught' ERR; f; echo done
CASE_013

expect_status 0
expect_stdout_lines $'caught\ndone\n'
finish 'shell-trap-err-in-function-not-errtrace'
