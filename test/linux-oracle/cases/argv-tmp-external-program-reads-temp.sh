#!/usr/bin/env bash
# case: argv-tmp-external-program-reads-temp
# category: argv-semantics
# severity: must-match
# needs: node
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs node
snippet <<'CASE_137'
f=/tmp/dsh-tmp-node.txt; echo probe > "$f"; node -e 'const fs=require("fs");console.log(fs.readFileSync(process.argv[1],"utf8").trim())' /tmp/dsh-tmp-node.txt; rm -f "$f"
CASE_137

expect_status 0
expect_stdout_equals $'probe\n'
finish 'argv-tmp-external-program-reads-temp'
