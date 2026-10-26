#!/usr/bin/env bash
# case: alias-chain-xargs-jq-reads
# category: alias
# severity: must-match
# needs: xargs jq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs jq
snippet <<'CASE_081'
printf '{"a":1}' > /tmp/alias-j.json; printf '/tmp/alias-j.json\n' | xargs jq -c .a
CASE_081

expect_status 0
expect_stdout_equals $'1\n'
finish 'alias-chain-xargs-jq-reads'
