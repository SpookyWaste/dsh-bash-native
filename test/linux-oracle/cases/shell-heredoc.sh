#!/usr/bin/env bash
# case: shell-heredoc
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_004'
cat <<EOF
line1
line2
EOF
CASE_004

expect_status 0
expect_stdout_lines $'line1\nline2\n'
finish 'shell-heredoc'
