#!/usr/bin/env bash
# case: glob-trailing-slash-requires-directory
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

printf '%s' $'x\n' > 'note.md'

snippet <<'CASE_195'
mkdir -p mydir; echo */; echo *.md/
CASE_195

expect_status 0
expect_stdout_equals $'mydir/\n*.md/\n'
finish 'glob-trailing-slash-requires-directory'
