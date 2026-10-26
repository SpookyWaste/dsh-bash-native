#!/usr/bin/env bash
# case: jq-field
# category: jq
# severity: must-match
# needs: jq
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs jq
printf '%s' $'{"k":1,"arr":[1,2]}\n' > 'j.json'

snippet <<'CASE_095'
jq -r .k j.json
CASE_095

expect_status 0
expect_stdout_equals $'1\n'
finish 'jq-field'
