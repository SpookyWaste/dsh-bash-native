#!/usr/bin/env bash
# case: alias-chain-find-exec-cp-copies
# category: alias
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
snippet <<'CASE_082'
mkdir -p /tmp/alias-out; printf 'x\n' > alias-src.txt; find . -maxdepth 1 -name alias-src.txt -exec cp {} /tmp/alias-out \;; test -e /tmp/alias-out/alias-src.txt && echo copied || echo missing
CASE_082

expect_status 0
expect_stdout_equals $'copied\n'
finish 'alias-chain-find-exec-cp-copies'
