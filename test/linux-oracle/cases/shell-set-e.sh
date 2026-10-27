#!/usr/bin/env bash
# case: shell-set-e
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_007'
(set -e; false; echo nope); echo rc=$?
CASE_007

expect_status 0
expect_stdout_matches 'rc=1'
expect_stdout_excludes 'nope'
finish 'shell-set-e'
