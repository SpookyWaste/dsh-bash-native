#!/usr/bin/env bash
# case: shell-trap-err-in-function-errtrace
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_014'
set -E; f() { false; }; trap 'echo caught' ERR; f; echo done
CASE_014

expect_status 0
expect_stdout_lines $'caught\ncaught\ndone\n'
finish 'shell-trap-err-in-function-errtrace'
