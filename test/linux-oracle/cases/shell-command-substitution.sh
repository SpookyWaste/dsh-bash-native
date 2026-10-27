#!/usr/bin/env bash
# case: shell-command-substitution
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_001'
x=$(echo hi); echo "sub=$x"; false; echo "rc=$?"
CASE_001

expect_status 0
expect_stdout_matches 'sub=hi' 'rc=1'
finish 'shell-command-substitution'
