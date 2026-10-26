#!/usr/bin/env bash
# case: process-lastpipe-runs-in-the-parent-shell
# category: process
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_194'
echo hello | read v; echo "plain=[$v]"; shopt -s lastpipe; echo hello | read w; echo "lastpipe=[$w]"
CASE_194

expect_status 0
expect_stdout_matches 'plain=\[\]' 'lastpipe=\[hello\]'
finish 'process-lastpipe-runs-in-the-parent-shell'
