# Corpus on a real Linux bash

These are the same snippets and expectations as [`corpus/compat.json`](../../corpus/compat.json), emitted as one self-contained bash script per case, so the reference half of the corpus can be checked against **bash and the GNU tools themselves** instead of against Git for Windows.

The Windows suites compare this project's engine and toolchain against the corpus; this runner turns the corpus into the Linux half of that comparison. A case that fails here means the *expectation* is wrong — or that it was recorded from a Windows measurement rather than from GNU — and the corpus needs fixing before the Windows result can be trusted.

## Run it

```sh
bash test/linux-oracle/run.sh                      # every case
bash test/linux-oracle/run.sh --list               # ids with their categories
bash test/linux-oracle/run.sh --category sed       # one category
bash test/linux-oracle/run.sh --only grep --only count
bash test/linux-oracle/run.sh --shell /bin/bash    # a specific bash
```

Each case runs in a fresh temporary directory (`mktemp -d`), with the fixtures it declares written into it, through `"$shell" -c '<snippet>'`. A case prints one of:

| Line | Meaning |
|---|---|
| `PASS <id>` | bash and the GNU tools produce the expectation |
| `GAP  <id>` | the case is a `knownGap`: the corpus says the Windows engine deviates, and GNU confirming it is what makes that statement meaningful |
| `SKIP <id> (missing …)` | a program the snippet needs is not installed here |
| `FAIL <id>` | the expectation does not hold on GNU; the case then prints the snippet's stdout, stderr and status |

The exit status is non-zero when any case fails.

To check only what the toolchain provides (the categories the Windows suites score against the shipped bundle):

```sh
bash test/linux-oracle/run.sh --category grep
bash test/linux-oracle/run.sh --category sed
bash test/linux-oracle/run.sh --category coreutils
# and awk, find, xargs, diff, jq, alias, argv-semantics
```

## Layout

| Path | What it is |
|---|---|
| `run.sh` | the driver: selection, one temporary directory per case, summary |
| `lib.sh` | the assertions (`expect_stdout_equals`, `expect_stdout_lines`, `expect_stdout_matches`, `expect_stdout_contains`, `expect_stdout_excludes`) and the fixture/snippet helpers |
| `cases/<id>.sh` | one case: header comments (`category`, `needs`, `known-gap`), its fixtures, the snippet, then the expectation |
| `cases/INDEX.md` | what was emitted, what was left out and why |
| `scripts/emit-linux-oracle.mjs` | the generator; edit the corpus, not these files |

## What is left out, and why

`cases/INDEX.md` is the authoritative list. The reasons are:

- **`platform-difference`**: the expectation records a Windows shape (`/c/Windows`, `MSYS_NT-…`) that has no Linux counterpart.
- **Windows-only commands**: cases that run `cmd.exe` or `powershell` as their long-lived child (the `wait`/`kill` group) have nothing to spawn on Linux.
- **Windows paths and variables**: `/c/...`, `/d/...`, `%TEMP%` and `$TEMP` would test the alias this project implements, which is the Windows side's job, not GNU's.

## Details worth knowing

- Assertions mirror `scripts/engine-harness.mjs`: `equals` is byte-exact after `\r\n` → `\n`; `lines` compares the line *set* and ignores one trailing empty line; `matches` applies each pattern to the output with trailing line breaks removed.
- `matches` patterns are JavaScript regular expressions in the corpus. The generator rewrites `\d` and `\s` to `[0-9]` and `[[:space:]]` for GNU `grep -E`; `\b` is left alone because GNU grep supplies it.
- Fixtures are written from ANSI-C quoted strings, so the two fixtures that carry CRLF (`crlf-source.sh`, `crlf-data.txt`) keep their carriage returns through git.
- The environment is inherited: `LANG`, `TZ`, `PATH` and anything else a case might read are whatever the invoking shell has.
- Regenerate after changing the corpus: `node scripts/emit-linux-oracle.mjs` (Node, on any platform; the emitted cases need only bash).