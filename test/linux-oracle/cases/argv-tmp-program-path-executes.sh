#!/usr/bin/env bash
# case: argv-tmp-program-path-executes
# category: argv-semantics
# severity: must-match
# needs: grep
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs grep
snippet <<'CASE_135'
cp "$(command -v grep)" /tmp/dsh-tmp-program.exe; /tmp/dsh-tmp-program.exe --version | head -1; rm -f /tmp/dsh-tmp-program.exe
CASE_135

expect_status 0
expect_stdout_contains 'grep'
finish 'argv-tmp-program-path-executes'
