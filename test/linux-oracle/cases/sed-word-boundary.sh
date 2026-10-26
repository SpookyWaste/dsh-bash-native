#!/usr/bin/env bash
# case: sed-word-boundary
# category: sed
# severity: must-match
# needs: sed
# known-gap: docs/research.md「rubash 的已知差异」的「自带工具层：sed 的简单形态走引擎实现」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs sed
snippet <<'CASE_063'
printf 'foo x\n' | sed 's/\bfoo\b/bar/'
CASE_063

expect_status 0
expect_stdout_equals $'bar x\n'
finish 'sed-word-boundary'
