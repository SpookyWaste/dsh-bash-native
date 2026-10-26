#!/usr/bin/env bash
# case: fd-redirect-descriptor-paths
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_144'
echo a > /dev/stdout; echo c > /dev/fd/1; echo d > /proc/self/fd/1
CASE_144

expect_status 0
expect_stdout_lines $'a\nc\nd\n'
finish 'fd-redirect-descriptor-paths'
