#!/usr/bin/env bash
# case: fd-redirect-bundled-tool-writes-to-dev-null
# category: descriptor
# severity: must-match
# needs: tail
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs tail
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'

snippet <<'CASE_215'
tail -n 1 a.txt > /dev/null; echo "rc=$?"
CASE_215

expect_status 0
expect_stdout_equals $'rc=0\n'
finish 'fd-redirect-bundled-tool-writes-to-dev-null'
