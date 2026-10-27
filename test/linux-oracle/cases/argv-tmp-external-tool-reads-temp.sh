#!/usr/bin/env bash
# case: argv-tmp-external-tool-reads-temp
# category: argv-semantics
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
snippet <<'CASE_136'
f=/tmp/dsh-tmp-grep.txt; echo external-ok > "$f"; grep external "$f"; rm -f "$f"
CASE_136

expect_status 0
expect_stdout_equals $'external-ok\n'
finish 'argv-tmp-external-tool-reads-temp'
