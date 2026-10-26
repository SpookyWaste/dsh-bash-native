// Emit a self-contained test suite from `corpus/compat.json`, for running on a real Linux bash.
//
// The corpus states what GNU bash and the GNU tools do; on Windows some of those statements were recorded
// against Git for Windows or against this project's own engine. Running the same snippets on Linux is how
// an expectation can be checked against GNU itself, so the fast-moving part (the snippets and their
// expectations) stays in the corpus and this script is the only thing that knows the file layout.
//
// Usage:
//   node scripts/emit-linux-oracle.mjs
//
// Writes `test/linux-oracle/cases/<id>.sh` (one case per file) and `test/linux-oracle/cases/INDEX.md`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(readFileSync(join(ROOT, "corpus", "compat.json"), "utf8"));
const OUT = join(ROOT, "test", "linux-oracle", "cases");

/** Single-quoted shell word. */
const q = (text) => `'${String(text).replaceAll("'", `'\\''`)}'`;

/** ANSI-C quoted word: newlines, carriage returns and tabs become escapes, so a generated file survives git. */
const ansiC = (text) =>
  `$'${String(text)
    .replaceAll("\\", "\\\\")
    .replaceAll("'", "\\'")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")}'`;

/**
 * Rewrite a JavaScript regular expression into the ERE dialect GNU grep takes, for the two escapes the
 * corpus uses that POSIX does not have. `\b` stays: GNU grep supplies it.
 */
const erePattern = (pattern) => pattern.replace(/\\d/g, "[0-9]").replace(/\\s/g, "[[:space:]]");

/** Why this case cannot run on Linux, or null when it can. */
function unportableReason(entry) {
  if (entry.category === "platform-difference") return "records a Windows platform shape";
  if (typeof entry.snippet !== "string") return "no snippet";
  // These carry CRLF inside the script text itself: on Windows the shell strips the carriage returns, on
  // GNU bash they are ordinary bytes, so the snippet measures the platform rather than the tool.
  if (entry.snippet.includes("\r\n")) return "the snippet is CRLF text: Windows strips the carriage returns";
  if ((entry.files ?? []).some((name) => corpus.fixtures[name]?.includes("\r\n")) && /(^|[;&|]\s*)(source|\.)\s/.test(entry.snippet))
    return "sources a CRLF script: Windows strips the carriage returns";
  if (/\bcmd\.exe\b|powershell|%TEMP%|\/c\/|\/d\/|MSYS_/i.test(entry.snippet)) return "names a Windows-only command or path";
  if (/\$TEMP\b/.test(entry.snippet)) return "uses the Windows TEMP variable";
  return null;
}

/** One case file: fixtures, the snippet through the shell under test, then the expectation. */
function emitCase(entry, index) {
  const lines = [];
  const delimiter = `CASE_${String(index).padStart(3, "0")}`;
  lines.push("#!/usr/bin/env bash");
  lines.push(`# case: ${entry.id}`);
  lines.push(`# category: ${entry.category}`);
  lines.push(`# severity: ${entry.severity ?? "must-match"}`);
  if ((entry.needs ?? []).length > 0) lines.push(`# needs: ${entry.needs.join(" ")}`);
  if (entry.knownGap !== undefined) lines.push(`# known-gap: ${entry.knownGap}`);
  lines.push(`. "$(dirname "\${BASH_SOURCE[0]}")/../lib.sh"`);
  lines.push("");
  if ((entry.needs ?? []).length > 0) lines.push(`needs ${entry.needs.join(" ")}`);
  for (const name of entry.files ?? []) {
    const content = corpus.fixtures[name];
    if (content === undefined) throw new Error(`${entry.id}: fixture ${name} is not in corpus.fixtures`);
    lines.push(`printf '%s' ${ansiC(content)} > ${q(name)}`);
  }
  if ((entry.files ?? []).length > 0) lines.push("");
  lines.push(`snippet <<'${delimiter}'`);
  lines.push(entry.snippet);
  lines.push(delimiter);
  lines.push("");
  const expect = entry.expect ?? {};
  if (expect.status !== undefined) lines.push(`expect_status ${expect.status}`);
  const stdout = expect.stdout ?? {};
  if (stdout.equals !== undefined) lines.push(`expect_stdout_equals ${ansiC(stdout.equals)}`);
  else if (stdout.lines !== undefined) lines.push(`expect_stdout_lines ${ansiC(stdout.lines.map((line) => `${line}\n`).join(""))}`);
  else if (stdout.matches !== undefined) lines.push(`expect_stdout_matches ${stdout.matches.map((pattern) => q(erePattern(pattern))).join(" ")}`);
  else if (stdout.contains !== undefined) lines.push(`expect_stdout_contains ${stdout.contains.map(q).join(" ")}`);
  if (stdout.notContains !== undefined) lines.push(`expect_stdout_excludes ${stdout.notContains.map(q).join(" ")}`);
  lines.push(`finish ${q(entry.id)}`);
  lines.push("");
  return lines.join("\n");
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const included = [];
const excluded = [];
corpus.cases.forEach((entry, index) => {
  const reason = unportableReason(entry);
  if (reason !== null) {
    excluded.push({ id: entry.id, category: entry.category, reason });
    return;
  }
  writeFileSync(join(OUT, `${entry.id}.sh`), emitCase(entry, index));
  included.push({ id: entry.id, category: entry.category, knownGap: entry.knownGap !== undefined });
});

const byCategory = new Map();
for (const entry of included) byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) + 1);
const excludedByReason = new Map();
for (const entry of excluded) excludedByReason.set(entry.reason, (excludedByReason.get(entry.reason) ?? 0) + 1);

const index = [
  "# Generated cases",
  "",
  "Written by `node scripts/emit-linux-oracle.mjs` from `corpus/compat.json`. Do not edit by hand: change the",
  "corpus and re-run the generator.",
  "",
  `Included: ${included.length} of ${corpus.cases.length} cases (${included.filter((entry) => entry.knownGap).length} of them known gaps).`,
  "",
  "| Category | Cases |",
  "|---|---|",
  ...[...byCategory.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([category, count]) => `| \`${category}\` | ${count} |`),
  "",
  "## Excluded",
  "",
  "| Reason | Cases |",
  "|---|---|",
  ...[...excludedByReason.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([reason, count]) => `| ${reason} | ${count} |`),
  "",
  "| Case | Category | Reason |",
  "|---|---|---|",
  ...excluded.map((entry) => `| \`${entry.id}\` | ${entry.category} | ${entry.reason} |`),
  "",
];
writeFileSync(join(OUT, "INDEX.md"), index.join("\n"));

console.log(`wrote ${included.length} cases to ${OUT}`);
console.log(`excluded ${excluded.length}:`);
for (const [reason, count] of [...excludedByReason.entries()].sort()) console.log(`  ${String(count).padStart(3)}  ${reason}`);