#!/usr/bin/env bash
# case: pipe-closed-reader-builtin-status
# category: process
# severity: must-match
# needs: head seq
# known-gap: docs/research.md「rubash 的已知差异」的「断管的写端与 PIPESTATUS」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs head seq
snippet <<'CASE_141'
printf "%.0sx" $(seq 1 20000) | head -c 1; echo " st=${PIPESTATUS[0]}"
CASE_141

expect_status 0
expect_stdout_equals $'x st=1\n'
finish 'pipe-closed-reader-builtin-status'
