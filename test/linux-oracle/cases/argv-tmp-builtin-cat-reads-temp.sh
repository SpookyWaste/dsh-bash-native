#!/usr/bin/env bash
# case: argv-tmp-builtin-cat-reads-temp
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_131'
f=/tmp/dsh-tmp-cat.txt; echo operand-ok > "$f"; cat "$f"; rm -f "$f"
CASE_131

expect_status 0
expect_stdout_equals $'operand-ok\n'
finish 'argv-tmp-builtin-cat-reads-temp'
