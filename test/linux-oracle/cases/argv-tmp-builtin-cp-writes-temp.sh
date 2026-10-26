#!/usr/bin/env bash
# case: argv-tmp-builtin-cp-writes-temp
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_133'
f=/tmp/dsh-tmp-cp.txt; echo src > "$f"; cp "$f" /tmp/dsh-tmp-cp-copy.txt; test -f /tmp/dsh-tmp-cp-copy.txt && echo copied; rm -f "$f" /tmp/dsh-tmp-cp-copy.txt
CASE_133

expect_status 0
expect_stdout_equals $'copied\n'
finish 'argv-tmp-builtin-cp-writes-temp'
