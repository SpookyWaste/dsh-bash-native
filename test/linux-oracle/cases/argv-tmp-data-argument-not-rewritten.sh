#!/usr/bin/env bash
# case: argv-tmp-data-argument-not-rewritten
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_139'
f=/tmp/dsh-tmp-data.txt; echo data > "$f"; echo /tmp/dsh-tmp-data.txt; rm -f "$f"
CASE_139

expect_status 0
expect_stdout_equals $'/tmp/dsh-tmp-data.txt\n'
finish 'argv-tmp-data-argument-not-rewritten'
