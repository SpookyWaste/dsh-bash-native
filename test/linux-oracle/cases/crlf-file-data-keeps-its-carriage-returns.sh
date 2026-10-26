#!/usr/bin/env bash
# case: crlf-file-data-keeps-its-carriage-returns
# category: coreutils
# severity: must-match
# needs: cat wc
. "$(dirname "${BASH_SOURCE[0]}")/../lib.sh"

needs cat wc
printf '%s' $'a\r\nb' > 'crlf-data.txt'

snippet <<'CASE_186'
cat crlf-data.txt | wc -c
CASE_186

expect_status 0
expect_stdout_equals $'4\n'
finish 'crlf-file-data-keeps-its-carriage-returns'
