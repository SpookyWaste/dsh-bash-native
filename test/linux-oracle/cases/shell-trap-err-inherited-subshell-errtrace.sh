#!/usr/bin/env bash
# case: shell-trap-err-inherited-subshell-errtrace
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_015'
set -E; trap 'echo t' ERR; (false) 2>/dev/null; echo done
CASE_015

expect_status 0
expect_stdout_lines $'t\nt\ndone\n'
finish 'shell-trap-err-inherited-subshell-errtrace'
