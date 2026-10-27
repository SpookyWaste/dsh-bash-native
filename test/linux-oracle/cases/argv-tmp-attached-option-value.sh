#!/usr/bin/env bash
# case: argv-tmp-attached-option-value
# category: argv-semantics
# severity: must-match
# needs: cat sort
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs cat sort
snippet <<'CASE_134'
f=/tmp/dsh-tmp-attached.txt; echo one > "$f"; sort --output=/tmp/dsh-tmp-attached-out.txt "$f"; cat /tmp/dsh-tmp-attached-out.txt; rm -f "$f" /tmp/dsh-tmp-attached-out.txt
CASE_134

expect_status 0
expect_stdout_equals $'one\n'
finish 'argv-tmp-attached-option-value'
