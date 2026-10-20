# uutils/sed patches

The pinned release is **0.3.0** (2026-10-18). It is the first release whose `-i` handling follows GNU on its
own: `e40667ff` added `gnu_in_place_args` and `require_equals(true)` so that `sed -i 's/a/b/' file` keeps the
script as the script operand instead of eating it as a backup suffix. The former
`0001-gnu-in-place-flag.patch` therefore no longer exists; the release notes also bring `F`/`W`/`R`, the
GNU `n`/`Q`/`l` semantics, a non-aborting unterminated `s`/`y`, and the `~`/`,` address panic fix.

What remains here:

- `0002-path-alias-in-argv.patch` rewrites the argv entry point so a path the shell already translated
  (`/tmp/...`, `/<letter>/...`) is not translated again by a program another program started. 0.3.0 moved
  parsing behind `parse_args`, so the hook is `parse_args(args.map(dsh_path_alias::translate))` and the
  shared module is injected at the crate root by `scripts/build-toolchain.mjs`.
- `0003-word-boundary-escape.patch` is still required: 0.3.0's `delimited_parser.rs` is byte-identical to
  0.2.0's, so a regex `\b` is still decoded to a backspace (0x08) before the regex engine sees it and
  `s/\bfoo\b/bar/g` silently prints its input unchanged. Upstream removed that decode in `dc249bd1`, which
  landed on `main` after the 0.3.0 tag; the patch applies cleanly to 0.3.0 and should be deleted when a
  release carries that commit.

Diagnostics were reworked in 0.3.0 (a caret-and-underline rendering when stderr is a terminal). Pipes keep
the single-line `sed: <script argument N>:<line>:<column>: error: ...` shape, and the wording of existing
errors is unchanged, so the corpus expectations and the sandbox refusal dialect (`(os error N)`) stay valid.