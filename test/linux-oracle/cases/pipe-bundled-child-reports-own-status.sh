#!/usr/bin/env bash
# case: pipe-bundled-child-reports-own-status
# category: process
# severity: must-match
# known-gap: docs/research.md「已知引擎差异」的「断管的写端：自带诊断与自带退出码」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_143'
seq 1 200000 2>/dev/null | head -1; echo " st=${PIPESTATUS[0]}"
CASE_143

expect_status 0
expect_stdout_equals $'1\n st=1\n'
finish 'pipe-bundled-child-reports-own-status'
