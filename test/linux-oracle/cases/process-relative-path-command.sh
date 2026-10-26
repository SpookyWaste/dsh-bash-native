#!/usr/bin/env bash
# case: process-relative-path-command
# category: process
# severity: must-match
# needs: find
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs find
snippet <<'CASE_190'
mkdir -p sub && cp "$(command -v find)" sub/relfind.exe && cd sub && ./relfind.exe --version | head -1
CASE_190

expect_status 0
expect_stdout_matches 'find \(Rust\) 0\.10\.0'
finish 'process-relative-path-command'
