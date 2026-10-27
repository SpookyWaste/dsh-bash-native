#!/usr/bin/env bash
# case: shell-set-u
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_008'
(set -u; echo "$CORPUS_UNSET") 2>/dev/null; echo rc=$?
CASE_008

expect_status 0
expect_stdout_matches 'rc=1'
finish 'shell-set-u'
