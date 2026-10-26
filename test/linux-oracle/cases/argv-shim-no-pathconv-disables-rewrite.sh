#!/usr/bin/env bash
# case: argv-shim-no-pathconv-disables-rewrite
# category: argv-semantics
# severity: must-match
# needs: cat xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs cat xargs
snippet <<'CASE_140'
f=/tmp/dsh-tmp-escape.txt; echo x > "$f"; printf '%s\n' "$f" | DSH_BASH_NATIVE_NO_PATHCONV=1 xargs cat; echo "rc=$?"; rm -f "$f"
CASE_140

expect_status 0
expect_stdout_lines $'rc=123\n'
finish 'argv-shim-no-pathconv-disables-rewrite'
