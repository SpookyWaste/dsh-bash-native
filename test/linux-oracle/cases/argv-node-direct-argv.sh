#!/usr/bin/env bash
# case: argv-node-direct-argv
# category: argv-semantics
# severity: must-match
# needs: node
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs node
snippet <<'CASE_034'
node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "*.txt"
CASE_034

expect_status 0
expect_stdout_equals $'["*.txt"]\n'
finish 'argv-node-direct-argv'
