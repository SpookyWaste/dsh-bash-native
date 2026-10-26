#!/usr/bin/env bash
# case: rmdir-refuses-a-final-dot
# category: coreutils
# severity: must-match
# known-gap: docs/research.md「rubash 的已知差异」的「自带工具层：rmdir 的简单形态吞掉错误」
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_226'
mkdir empty-dir; rmdir empty-dir/. 2>/dev/null; echo "rc=$?"; test -d empty-dir && echo kept || echo gone
CASE_226

expect_status 0
expect_stdout_equals $'rc=1\nkept\n'
finish 'rmdir-refuses-a-final-dot'
