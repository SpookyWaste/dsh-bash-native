#!/usr/bin/env bash
# case: sed-bre-interval
# category: sed
# severity: must-match
# needs: sed
# known-gap: docs/research.md「rubash 的已知差异」的「自带工具层：sed 的简单形态走引擎实现」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_060'
printf 'aaaa\n' | sed 's/a\{2,3\}/X/'
CASE_060

expect_status 0
expect_stdout_equals $'Xa\n'
finish 'sed-bre-interval'
