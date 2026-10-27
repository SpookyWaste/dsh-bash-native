#!/usr/bin/env bash
# case: argv-external-program-argv
# category: argv-semantics
# severity: must-match
# needs: node
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs node
snippet <<'CASE_033'
node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "*.txt"
CASE_033

expect_status 0
expect_stdout_equals $'["*.txt"]\n'
finish 'argv-external-program-argv'
