# Generated cases

Written by `node scripts/emit-linux-oracle.mjs` from `corpus/compat.json`. Do not edit by hand: change the
corpus and re-run the generator.

Included: 183 of 227 cases (11 of them known gaps).

| Category | Cases |
|---|---|
| `alias` | 9 |
| `argv-semantics` | 16 |
| `awk` | 6 |
| `coreutils` | 15 |
| `descriptor` | 16 |
| `diff` | 4 |
| `find` | 6 |
| `grep` | 14 |
| `jq` | 2 |
| `process` | 24 |
| `sed` | 13 |
| `shell` | 5 |
| `shell-syntax` | 46 |
| `xargs` | 7 |

## Excluded

| Reason | Cases |
|---|---|
| a name that only collides with a Windows program | 2 |
| names a Windows-only command or path | 12 |
| records a Windows platform shape | 19 |
| runs a Windows executable the toolchain provides | 2 |
| sources a CRLF script: Windows strips the carriage returns | 1 |
| tests the Windows path-translation escape hatch | 2 |
| the snippet is CRLF text: Windows strips the carriage returns | 6 |

| Case | Category | Reason |
|---|---|---|
| `process-kill-with-dollar-bang` | process | names a Windows-only command or path |
| `collision-timeout-runs-command` | collision | a name that only collides with a Windows program |
| `collision-which-finds-program` | collision | a name that only collides with a Windows program |
| `builtin-disown-removes-and-leaves-the-process-running` | shell | names a Windows-only command or path |
| `builtin-wait-f-reports-the-child-status` | shell | names a Windows-only command or path |
| `platform-uname` | platform-difference | records a Windows platform shape |
| `platform-ls-long` | platform-difference | records a Windows platform shape |
| `platform-dev-stdin` | platform-difference | records a Windows platform shape |
| `platform-tmp-location` | platform-difference | records a Windows platform shape |
| `platform-tmp-is-writable` | platform-difference | records a Windows platform shape |
| `platform-tmp-round-trip` | platform-difference | records a Windows platform shape |
| `platform-tmp-glob-expands` | platform-difference | records a Windows platform shape |
| `argv-tmp-program-path-executes` | argv-semantics | runs a Windows executable the toolchain provides |
| `argv-tmp-pattern-stays-verbatim` | argv-semantics | tests the Windows path-translation escape hatch |
| `argv-shim-no-pathconv-disables-rewrite` | argv-semantics | tests the Windows path-translation escape hatch |
| `wait-pid-status` | process | names a Windows-only command or path |
| `wait-n-status` | process | names a Windows-only command or path |
| `wait-job-spec-status` | process | names a Windows-only command or path |
| `wait-n-without-children` | process | names a Windows-only command or path |
| `wait-n-reports-identifier` | process | names a Windows-only command or path |
| `wait-pid-after-finish` | process | names a Windows-only command or path |
| `wait-two-pids-report-the-last` | process | names a Windows-only command or path |
| `process-kill-job-spec` | process | names a Windows-only command or path |
| `process-kill-signal-status` | process | names a Windows-only command or path |
| `platform-root-is-drive` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-root` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-subdir` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-collapses-parent` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-reads-and-tests` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-argument-copy` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-glob` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-leaves-multi-letter-roots` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-hits-a-script-operand` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-script-operand-escape-hatch` | platform-difference | records a Windows platform shape |
| `platform-drive-mount-hits-awk-program-text` | platform-difference | records a Windows platform shape |
| `platform-od-bytes` | platform-difference | records a Windows platform shape |
| `crlf-string-plain-lines` | shell-syntax | the snippet is CRLF text: Windows strips the carriage returns |
| `crlf-string-redirect-target` | shell-syntax | the snippet is CRLF text: Windows strips the carriage returns |
| `crlf-string-if-block` | shell-syntax | the snippet is CRLF text: Windows strips the carriage returns |
| `crlf-string-function` | shell-syntax | the snippet is CRLF text: Windows strips the carriage returns |
| `crlf-string-backslash-continuation` | shell-syntax | the snippet is CRLF text: Windows strips the carriage returns |
| `crlf-string-heredoc-body` | shell-syntax | the snippet is CRLF text: Windows strips the carriage returns |
| `crlf-file-sourced` | shell-syntax | sources a CRLF script: Windows strips the carriage returns |
| `process-relative-path-command` | process | runs a Windows executable the toolchain provides |
