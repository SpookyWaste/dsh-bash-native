#!/usr/bin/env bash
# case: process-relative-path-missing-keeps-the-callers-text
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_191'
./definitely-missing-tool 2>&1; echo rc=$?
CASE_191

expect_status 0
expect_stdout_matches './definitely-missing-tool: No such file or directory' 'rc=127'
finish 'process-relative-path-missing-keeps-the-callers-text'
