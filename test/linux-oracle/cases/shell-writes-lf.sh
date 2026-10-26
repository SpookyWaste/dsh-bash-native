#!/usr/bin/env bash
# case: shell-writes-lf
# category: shell-syntax
# severity: must-match
# needs: wc
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs wc
snippet <<'CASE_026'
printf 'a\nb\n' > f.txt; wc -c < f.txt
CASE_026

expect_status 0
expect_stdout_matches '\b4\b'
finish 'shell-writes-lf'
