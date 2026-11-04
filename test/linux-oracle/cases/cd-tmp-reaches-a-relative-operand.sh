#!/usr/bin/env bash
# case: cd-tmp-reaches-a-relative-operand
# category: shell
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_227'
printf x > /tmp/cd-relative-probe.txt; cd /tmp; test -f cd-relative-probe.txt && echo found; rm -f /tmp/cd-relative-probe.txt
CASE_227

expect_status 0
expect_stdout_equals $'found\n'
finish 'cd-tmp-reaches-a-relative-operand'
