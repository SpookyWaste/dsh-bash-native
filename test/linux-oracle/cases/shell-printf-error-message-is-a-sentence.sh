#!/usr/bin/env bash
# case: shell-printf-error-message-is-a-sentence
# category: shell-syntax
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_205'
printf 'abc%' 2>&1 >/dev/null; true
CASE_205

expect_status 0
expect_stdout_matches 'missing format character'
expect_stdout_excludes 'format-error-'
finish 'shell-printf-error-message-is-a-sentence'
