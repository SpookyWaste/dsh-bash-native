#!/usr/bin/env bash
# case: awk-quoted-wildcard-stays-literal
# category: awk
# severity: must-match
# needs: awk
# known-gap: docs/research.md「已知引擎差异」的「awk 的带引号通配符：已修，退出码仍与 gawk 不同」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs awk
printf '%s' $'needle\nhay\nneedle\n' > 'a.txt'
printf '%s' $'x:1\ny:2\n' > 'b.txt'

snippet <<'CASE_064'
awk '{print FILENAME}' "*.txt" >/dev/null; echo rc=$?
CASE_064

expect_status 0
expect_stdout_equals $'rc=2\n'
finish 'awk-quoted-wildcard-stays-literal'
