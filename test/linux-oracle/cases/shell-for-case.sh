#!/usr/bin/env bash
# case: shell-for-case
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_006'
for i in 1 2; do case $i in 1) echo one;; 2) echo two;; esac; done
CASE_006

expect_status 0
expect_stdout_lines $'one\ntwo\n'
finish 'shell-for-case'
