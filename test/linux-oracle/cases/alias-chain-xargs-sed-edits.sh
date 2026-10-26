#!/usr/bin/env bash
# case: alias-chain-xargs-sed-edits
# category: alias
# severity: must-match
# needs: xargs sed
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs sed
snippet <<'CASE_078'
printf 'x\n' > /tmp/alias-s.txt; printf '/tmp/alias-s.txt\n' | xargs sed -i s/x/y/; cat /tmp/alias-s.txt
CASE_078

expect_status 0
expect_stdout_equals $'y\n'
finish 'alias-chain-xargs-sed-edits'
