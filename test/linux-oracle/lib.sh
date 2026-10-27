#!/usr/bin/env bash
# Helpers for one corpus case. Every generated case file sources this, lays out the fixtures it declares,
# runs its snippet through the shell under test, and states the expectation the corpus records.
#
# The case owns the comparison so the expectation stays readable: `expect_stdout_equals` is a heredoc of
# the exact bytes, `expect_stdout_matches` is the corpus's regular expressions, and `expect_stdout_lines`
# compares line sets the way `scripts/engine-harness.mjs` does.
#
# Environment:
#   SHELL_UNDER_TEST  shell to run the snippets with (default `bash`)
# Exit status of a case: 0 pass, 1 fail, 77 skip.

set -u

_status=0
_failures=0
# The case's own directory has to stay clean: a snippet may list it (`grep -r`, `find .`), and a capture
# file sitting next to the fixtures would be part of that listing. The diff header naming a temporary
# directory is the price.
_scratch_dir=$(mktemp -d) || exit 1
_stdout_file="$_scratch_dir/stdout"
_stderr_file="$_scratch_dir/stderr"
_expected_file="$_scratch_dir/expected"
_actual_file="$_scratch_dir/actual"

_cleanup() { rm -rf "$_scratch_dir"; }
trap _cleanup EXIT

fail() { printf '  FAIL: %s\n' "$*" >&2; _failures=$((_failures + 1)); }

# Skip when the snippet needs a program this host does not have.
needs() {
  local missing=()
  local name
  for name in "$@"; do
    command -v "$name" >/dev/null 2>&1 || missing+=("$name")
  done
  if (( ${#missing[@]} > 0 )); then
    printf 'SKIP missing %s\n' "${missing[*]}"
    exit 77
  fi
}

# `fixture NAME <<'EOF'` writes one corpus fixture into the working directory.
fixture() {
  local name=$1
  cat >"$name"
}

# `snippet <<'EOF'` runs the corpus snippet through the shell under test, then records its status and
# streams. `-c` mirrors how the harness hands a snippet to the engine.
snippet() {
  local script
  script=$(cat)
  "${SHELL_UNDER_TEST:-bash}" -c "$script" >"$_stdout_file" 2>"$_stderr_file"
  _status=$?
}

# CRLF is a file-format concern; the corpus compares text after `\r\n` became `\n` per line.
_actual() { sed -e 's/\r$//' "$_stdout_file"; }

expect_status() {
  local want=$1
  if (( _status != want )); then
    fail "status: want $want, got $_status"
  fi
}

# The expected bytes are an argument, not stdin: a pipeline would run this in a subshell and lose the
# failure count.
expect_stdout_equals() {
  printf '%s' "${1-}" >"$_expected_file"
  _actual >"$_actual_file"
  if ! cmp -s "$_actual_file" "$_expected_file"; then
    fail "stdout differs from the expected bytes"
    diff -u "$_expected_file" "$_actual_file" | sed -e 's/^/    /' >&2 || true
  fi
}

# The corpus compares line sets: the same lines in any order, with one trailing empty line ignored.
expect_stdout_lines() {
  printf '%s' "${1-}" >"$_expected_file"
  _actual | sed -e '${/^$/d;}' | sort >"$_actual_file"
  sed -e 's/\r$//' -e '${/^$/d;}' "$_expected_file" | sort >"$_expected_file.sorted"
  if ! cmp -s "$_actual_file" "$_expected_file.sorted"; then
    fail "stdout lines differ from the expected set"
    diff -u "$_expected_file.sorted" "$_actual_file" | sed -e 's/^/    /' >&2 || true
  fi
}

# Each pattern has to match the output, applied to the text with its trailing line breaks removed. GNU
# `grep -E` supplies the ERE dialect the corpus patterns are written in.
expect_stdout_matches() {
  local actual pattern
  actual=$(_actual)
  for pattern in "$@"; do
    if ! grep -Eq -- "$pattern" <<<"$actual"; then
      fail "stdout does not match /$pattern/"
    fi
  done
}

expect_stdout_contains() {
  local actual text
  actual=$(_actual)
  for text in "$@"; do
    case $actual in
      *"$text"*) ;;
      *) fail "stdout does not contain: $text" ;;
    esac
  done
}

expect_stdout_excludes() {
  local actual text
  actual=$(_actual)
  for text in "$@"; do
    case $actual in
      *"$text"*) fail "stdout must not contain: $text" ;;
    esac
  done
}

# `finish ID` reports the case result, showing the snippet's streams when it failed.
finish() {
  local id=$1
  if (( _failures == 0 )); then
    printf 'PASS %s\n' "$id"
    exit 0
  fi
  printf 'FAIL %s\n' "$id"
  printf '  --- stdout ---\n'
  _actual | sed -e 's/^/  /' >&2
  printf '  --- stderr ---\n'
  sed -e 's/^/  /' "$_stderr_file" >&2
  printf '  --- status: %s ---\n' "$_status" >&2
  exit 1
}