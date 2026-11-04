#!/usr/bin/env bash
# case: process-dollar-bang-builtin-background
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_110'
sleep 0.05 & p=$!; case $p in ''|*[!0-9]*) echo bad;; *) echo good;; esac; wait
CASE_110

expect_status 0
expect_stdout_equals $'good\n'
finish 'process-dollar-bang-builtin-background'
