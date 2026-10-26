#!/usr/bin/env bash
# case: fd-redirect-arbitrary-descriptor
# category: descriptor
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_146'
printf "a\nb\n" > /tmp/fd3.txt; while read l < /dev/fd/3; do echo "got=$l"; break; done 3< /tmp/fd3.txt
CASE_146

expect_status 0
expect_stdout_equals $'got=a\n'
finish 'fd-redirect-arbitrary-descriptor'
