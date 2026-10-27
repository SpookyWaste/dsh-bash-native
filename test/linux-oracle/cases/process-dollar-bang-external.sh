#!/usr/bin/env bash
# case: process-dollar-bang-external
# category: process
# severity: must-match
# needs: node
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs node
snippet <<'CASE_107'
node -e "setTimeout(()=>{},300)" & p=$!; case $p in ''|*[!0-9]*) echo bad;; *) echo good;; esac
CASE_107

expect_status 0
expect_stdout_equals $'good\n'
finish 'process-dollar-bang-external'
