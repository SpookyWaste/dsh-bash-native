#!/usr/bin/env bash
# case: fd-redirect-stderr-to-dev-null
# category: descriptor
# severity: must-match
# needs: ls
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs ls
snippet <<'CASE_212'
ls /definitely/absent 2>/dev/null; echo "rc=$?"
CASE_212

expect_status 0
expect_stdout_equals $'rc=2\n'
finish 'fd-redirect-stderr-to-dev-null'
