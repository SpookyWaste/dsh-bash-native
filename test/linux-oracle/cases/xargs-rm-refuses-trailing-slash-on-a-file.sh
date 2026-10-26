#!/usr/bin/env bash
# case: xargs-rm-refuses-trailing-slash-on-a-file
# category: xargs
# severity: must-match
# needs: xargs
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs xargs
printf '%s' $'x\n' > 'note.md'

snippet <<'CASE_196'
printf 'note.md/\n' | xargs rm -r 2>/dev/null; rc=$?; test -f note.md && echo "survived rc=$rc"
CASE_196

expect_status 0
expect_stdout_matches '^survived rc=[1-9][0-9]*$'
finish 'xargs-rm-refuses-trailing-slash-on-a-file'
