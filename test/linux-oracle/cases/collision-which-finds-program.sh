#!/usr/bin/env bash
# case: collision-which-finds-program
# category: collision
# severity: must-match
# needs: which
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs which
snippet <<'CASE_116'
which grep
CASE_116

expect_status 0
expect_stdout_matches '^[A-Za-z]:[\\/]'
expect_stdout_excludes '\\?\'
finish 'collision-which-finds-program'
