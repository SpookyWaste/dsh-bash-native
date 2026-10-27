#!/usr/bin/env bash
# Runs the compatibility corpus on a real bash, which is the reference for what "GNU does X" means.
#
# The Windows suites compare this project's engine and toolchain against the corpus; this runner turns the
# same corpus into the Linux half of that comparison, so an expectation can be checked against bash and
# the GNU tools themselves instead of against Git for Windows.
#
# Usage:
#   bash test/linux-oracle/run.sh [--only TEXT]... [--category NAME] [--shell PATH] [--list] [--keep]
#
#   --only TEXT      run only cases whose id contains TEXT (repeatable: every value has to match)
#   --category NAME  run only one corpus category (`bash test/linux-oracle/run.sh --list` shows them)
#   --shell PATH     shell under test (default: bash from PATH; also read from SHELL_UNDER_TEST)
#   --list           print the cases and their categories, then exit
#   --keep           keep each case's working directory
#
# Exit status is non-zero when any case fails. A `known-gap` case is labelled GAP when it passes: the
# corpus says the Windows engine deviates there, and a Linux pass confirms the expectation is GNU's.
set -u

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
shell=${SHELL_UNDER_TEST:-bash}
only=()
category=""
list=0
keep=0

while (( $# > 0 )); do
  case $1 in
    --only)
      only+=("${2:-}")
      shift 2
      ;;
    --category)
      category=${2:-}
      shift 2
      ;;
    --shell)
      shell=${2:-}
      shift 2
      ;;
    --list)
      list=1
      shift
      ;;
    --keep)
      keep=1
      shift
      ;;
    -h | --help)
      sed -n '3,18p' "$0" | sed -e 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if ! command -v "$shell" >/dev/null 2>&1; then
  printf 'no shell found: %s\n' "$shell" >&2
  exit 2
fi

selected=()
for file in "$here"/cases/*.sh; do
  [[ -f $file ]] || continue
  id=$(basename "$file" .sh)
  case_category=$(sed -n 's/^# category: //p' "$file" | head -n 1)
  if [[ -n $category && $case_category != "$category" ]]; then
    continue
  fi
  matched=1
  for needle in ${only[@]+"${only[@]}"}; do
    case $id in
      *"$needle"*) ;;
      *) matched=0 ;;
    esac
  done
  (( matched == 1 )) || continue
  selected+=("$file")
done

if (( ${#selected[@]} == 0 )); then
  printf 'no case matches\n' >&2
  exit 2
fi

if (( list == 1 )); then
  for file in ${selected[@]+"${selected[@]}"}; do
    id=$(basename "$file" .sh)
    case_category=$(sed -n 's/^# category: //p' "$file" | head -n 1)
    gap=$(sed -n 's/^# known-gap: //p' "$file" | head -n 1)
    if [[ -n $gap ]]; then
      printf '%-8s %s\n' "$case_category" "$id (known gap)"
    else
      printf '%-8s %s\n' "$case_category" "$id"
    fi
  done
  exit 0
fi

printf 'shell under test: %s\n' "$(command -v "$shell")"
printf 'cases: %s\n\n' "${#selected[@]}"

passed=0
gaps=0
skipped=0
failed=0
for file in ${selected[@]+"${selected[@]}"}; do
  id=$(basename "$file" .sh)
  gap=$(sed -n 's/^# known-gap: //p' "$file" | head -n 1)
  workdir=$(mktemp -d) || exit 2
  output=$(cd "$workdir" && SHELL_UNDER_TEST="$shell" bash "$file" 2>&1)
  status=$?
  if (( keep == 1 )); then
    printf 'workdir for %s: %s\n' "$id" "$workdir"
  else
    rm -rf "$workdir"
  fi
  case $status in
    0)
      if [[ -n $gap ]]; then
        printf '%s\n' "$output" | sed -e '1s/^PASS /GAP  /'
        gaps=$((gaps + 1))
      else
        printf '%s\n' "$output"
        passed=$((passed + 1))
      fi
      ;;
    77)
      printf 'SKIP %s (%s)\n' "$id" "$(printf '%s\n' "$output" | head -n 1 | sed -e 's/^SKIP //')"
      skipped=$((skipped + 1))
      ;;
    *)
      printf '%s\n' "$output"
      if [[ -n $gap ]]; then
        printf '  note: this case is a known gap (%s); on GNU it has to pass, so a failure here points at the\n  expectation, not at the Windows engine\n' "$gap"
      fi
      failed=$((failed + 1))
      ;;
  esac
done

printf '\n%s cases: %s passed, %s known-gap confirmed, %s skipped, %s failed\n' \
  "${#selected[@]}" "$passed" "$gaps" "$skipped" "$failed"
(( failed == 0 ))