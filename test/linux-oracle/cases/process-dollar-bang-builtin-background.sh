#!/usr/bin/env bash
# case: process-dollar-bang-builtin-background
# category: process
# severity: must-match
# known-gap: docs/research.md「已知引擎差异」的「内建命令的后台作业没有 PID」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_110'
sleep 0.05 & p=$!; case $p in ''|*[!0-9]*) echo bad;; *) echo good;; esac; wait
CASE_110

expect_status 0
expect_stdout_equals $'good\n'
finish 'process-dollar-bang-builtin-background'
