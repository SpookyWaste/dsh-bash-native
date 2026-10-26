#!/usr/bin/env bash
# case: collision-timeout-runs-command
# category: collision
# severity: must-match
# needs: timeout
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs timeout
snippet <<'CASE_115'
timeout 5 echo ok
CASE_115

expect_status 0
expect_stdout_equals $'ok\n'
finish 'collision-timeout-runs-command'
