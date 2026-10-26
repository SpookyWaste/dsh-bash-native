#!/usr/bin/env bash
# case: shell-heredoc-expansion
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_005'
x=1; cat <<EOF
v=$x
EOF
CASE_005

expect_status 0
expect_stdout_equals $'v=1\n'
finish 'shell-heredoc-expansion'
