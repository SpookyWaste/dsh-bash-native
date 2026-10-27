#!/usr/bin/env bash
# case: jq-length
# category: jq
# severity: must-match
# needs: jq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs jq
printf '%s' $'{"k":1,"arr":[1,2]}\n' > 'j.json'

snippet <<'CASE_096'
jq -r '.arr|length' j.json
CASE_096

expect_status 0
expect_stdout_equals $'2\n'
finish 'jq-length'
