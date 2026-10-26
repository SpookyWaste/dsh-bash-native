#!/usr/bin/env bash
# case: fd-redirect-dev-stdin-reads
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_145'
read x < /dev/stdin <<< hi; echo "x=$x"
CASE_145

expect_status 0
expect_stdout_equals $'x=hi\n'
finish 'fd-redirect-dev-stdin-reads'
