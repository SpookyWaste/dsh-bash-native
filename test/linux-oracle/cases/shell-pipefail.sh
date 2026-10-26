#!/usr/bin/env bash
# case: shell-pipefail
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_009'
(set -o pipefail; false | true); echo rc=$?
CASE_009

expect_status 0
expect_stdout_matches 'rc=1'
finish 'shell-pipefail'
