#!/usr/bin/env bash
# case: argv-tmp-builtin-rm-deletes-temp
# category: argv-semantics
# severity: must-match
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

snippet <<'CASE_132'
f=/tmp/dsh-tmp-rm.txt; echo x > "$f"; rm -f "$f"; test -f "$f" && echo left || echo deleted
CASE_132

expect_status 0
expect_stdout_equals $'deleted\n'
finish 'argv-tmp-builtin-rm-deletes-temp'
