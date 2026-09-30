// Measures whichever `awk` the toolchain installs against the reference implementation, gawk, over the
// idiom set a script actually uses. This is how the awk cell is decided: claims are not enough (section 32
// of docs/research.md rejected one candidate that advertised "100% POSIX" and agreed with gawk on 45 of
// these 55 idioms), so the same suite runs for every candidate.
//
// Usage:
//   node scripts/compare-awk-with-gawk.mjs                measure the installed toolchain `awk`
//   node scripts/compare-awk-with-gawk.mjs --awk=PATH     measure a candidate binary directly
//
// Requirements: Git for Windows (the reference is its gawk) and a tier where MSYS can start, which is why
// this is a development measurement rather than part of `npm test`.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunner, pathWithToolchain, toolsDirectory } from "./engine-harness.mjs";

const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const candidate = process.argv.find((argument) => argument.startsWith("--awk="))?.slice("--awk=".length)
  ?? join(toolsDirectory([], process.env), "awk.exe");

/** The Git Bash spelling of a Windows path, which is how the reference is pointed at the same directory. */
function posixPath(path) {
  return path.replace(/^([A-Za-z]):\\/, (_match, drive) => `/${drive.toLowerCase()}/`).replace(/\\/g, "/");
}

const scratch = mkdtempSync(join(tmpdir(), "awk-compare-"));
mkdirSync(scratch, { recursive: true });
writeFileSync(join(scratch, "a.txt"), "one two three\nfour five six\n");
writeFileSync(join(scratch, "b.txt"), "x:1:alpha\ny:2:beta\nz:3:gamma\n");
writeFileSync(join(scratch, "nums.txt"), "3\n1\n2\n10\n9\n");
writeFileSync(join(scratch, "prog.awk"), '{ print "p:" $1 }\n');

const engine = join(process.env.LOCALAPPDATA, "dsh-bash-native", "engine", "61946e691bcd9cfb83ca58c20969f25f3290d3d189f65e2a970e565ad8d499a3", "brush.exe");
const run = createRunner(engine, scratch);
// The candidate is staged as `awk.exe`, the name the toolchain installs it under: a `.cmd` shim would not
// be spawnable by the engine, and copying the binary is what the installer does anyway.
const binDir = join(scratch, "bin");
mkdirSync(binDir, { recursive: true });
copyFileSync(candidate, join(binDir, "awk.exe"));
const env = { ...process.env, PATH: pathWithToolchain({ withTools: true, toolsDir: binDir, basePath: process.env.PATH ?? "" }) };

/** The idioms: POSIX surface plus the gawk extensions every day-to-day script leans on. */
const IDIOMS = {
  "print default": 'awk "{print}" a.txt; echo rc=$?',
  fields: 'awk "{print \\$1, \\$2, \\$NF, \\$(NF-1)}" a.txt; echo rc=$?',
  "NF NR FNR FILENAME": 'awk "{print NF, NR, FNR, FILENAME}" a.txt b.txt; echo rc=$?',
  "field separator -F": 'awk -F: "{print \\$2}" b.txt; echo rc=$?',
  "OFS": 'awk "BEGIN{OFS=\\"-\\"} {print \\$1, \\$2}" a.txt; echo rc=$?',
  "ORS": 'awk "BEGIN{ORS=\\"|\\"} {print \\$1}" a.txt; echo rc=$?',
  "regex pattern": 'awk "/five/ {print \\$2}" a.txt; echo rc=$?',
  "expression pattern": 'awk "\\$1 == \\"one\\" {print \\$2}" a.txt; echo rc=$?',
  "range pattern": 'awk "/one/,/four/ {print NR}" a.txt; echo rc=$?',
  "BEGIN END": 'awk "BEGIN{print \\"b\\"} END{print NR}" a.txt; echo rc=$?',
  "-v assignment": 'awk -v x=7 "BEGIN{print x+1}"; echo rc=$?',
  "operand assignment": 'awk "{print v, \\$1}" v=9 a.txt; echo rc=$?',
  "array count": 'awk "{c[\\$1]++} END{print c[\\"one\\"]}" a.txt; echo rc=$?',
  "array iterate": 'awk "{a[\\$1]=1} END{n=0; for (k in a) n++; print n}" a.txt; echo rc=$?',
  "delete and in": 'awk "BEGIN{a[1]=1; delete a[1]; print (1 in a)}"; echo rc=$?',
  "split": 'awk "BEGIN{n=split(\\"a:b:c\\", parts, \\":\\"); print n, parts[2]}"; echo rc=$?',
  "substr index length": 'awk "BEGIN{s=\\"abcdef\\"; print substr(s,2,3), index(s,\\"cd\\"), length(s)}"; echo rc=$?',
  "length without parens": 'awk "{print length}" a.txt; echo rc=$?',
  "match RSTART RLENGTH": 'awk "BEGIN{s=\\"abcdef\\"; if (match(s,/cd/)) print RSTART, RLENGTH}"; echo rc=$?',
  "sub gsub": 'awk "BEGIN{s=\\"a-b-c\\"; sub(/-/,\\"+\\",s); gsub(/c/,\\"C\\",s); print s}"; echo rc=$?',
  "gsub ampersand": 'awk "BEGIN{s=\\"ab\\"; gsub(/b/,\\"[&]\\",s); print s}"; echo rc=$?',
  sprintf: 'awk "BEGIN{print sprintf(\\"%05.1f\\", 3.14159)}"; echo rc=$?',
  "printf formats": 'awk "BEGIN{printf \\"%d|%s|%5.2f|%c|%x|%o|%e\\\\n\\", 42, \\"s\\", 3.14159, 65, 255, 8, 12345.6789}"; echo rc=$?',
  "printf no newline": 'awk "BEGIN{printf \\"x\\"}"; echo "|"; echo rc=$?',
  "toupper tolower": 'awk "BEGIN{print toupper(\\"aB\\"), tolower(\\"aB\\")}"; echo rc=$?',
  "user function": 'awk "function f(n,  local) { local = n*2; return local } BEGIN{print f(21)}"; echo rc=$?',
  next: 'awk "{if (NR==1) next; print \\$1}" a.txt; echo rc=$?',
  "exit with END": 'awk "BEGIN{print \\"a\\"} {exit 3} END{print \\"end\\"}" a.txt; echo rc=$?',
  "ternary and logic": 'awk "BEGIN{print (1 ? \\"y\\" : \\"n\\"), (0 || 1), (1 && 0), !0, !1}"; echo rc=$?',
  "string vs number compare": 'awk "BEGIN{print (\\"10\\" < \\"9\\"), (10 < 9), (\\"10\\"+0 == 10)}"; echo rc=$?',
  "uninitialized value": 'awk "BEGIN{print \\"[\\" x \\"]\\", x+0}"; echo rc=$?',
  "assign to $0": 'awk "{\\$0 = \\"p q\\"; print \\$2, NF}" a.txt; echo rc=$?',
  "dollar NF": 'awk "{print \\$NF}" a.txt; echo rc=$?',
  "double dash": 'awk -- "{print \\$1}" a.txt; echo rc=$?',
  "two files NR FNR": 'awk "{print FNR, NR}" a.txt b.txt; echo rc=$?',
  "getline from file": 'awk "BEGIN{while ((getline line < \\"a.txt\\") > 0) n++; print n}"; echo rc=$?',
  "getline next record": 'awk "NR==1 {getline; print \\$1}" a.txt; echo rc=$?',
  "print to file and append": 'awk "BEGIN{print \\"one\\" > \\"o.txt\\"; print \\"two\\" >> \\"o.txt\\"; close(\\"o.txt\\")}"; cat o.txt; echo rc=$?',
  "number formatting": 'awk "BEGIN{print 1/3; print 0.1+0.2; print 1e10; print 1000000 * 1000000}"; echo rc=$?',
  "OFMT CONVFMT": 'awk "BEGIN{OFMT=\\"%.2f\\"; print 3.14159; x = 3.14159 \\"\\"; print x}"; echo rc=$?',
  "string to number": 'awk "BEGIN{print \\"3x\\" + 0, \\"abc\\" + 0, \\" 12 \\" + 1}"; echo rc=$?',
  concatenation: 'awk "BEGIN{print \\"a\\" \\"b\\", \\"a\\" 1+1}"; echo rc=$?',
  "RS custom": 'printf "a;b;c" | awk "BEGIN{RS=\\";\\"} {print NR, \\$0}"; echo rc=$?',
  "multi-dim SUBSEP": 'awk "BEGIN{a[1,2]=\\"v\\"; for (k in a) {split(k, p, SUBSEP); print p[1], p[2], a[k]}}"; echo rc=$?',
  "ARGV ARGC": 'awk "BEGIN{print ARGC, (ARGV[1] == \\"a.txt\\")}" a.txt; echo rc=$?',
  ENVIRON: 'awk "BEGIN{print (length(ENVIRON[\\"PATH\\"]) > 0)}"; echo rc=$?',
  "while do for": 'awk "BEGIN{i=0; while (i<2) i++; do {i++} while (i<3); for (j=0;j<2;j++); print i, j}"; echo rc=$?',
  "break continue": 'awk "BEGIN{for(i=0;i<5;i++){if(i==1) continue; if(i==3) break; s = s i} print s}"; echo rc=$?',
  "-f two files": "awk -f prog.awk a.txt b.txt; echo rc=$?",
  "dynamic regex": 'awk "BEGIN{r=\\"^a\\"; print (\\"abc\\" ~ r), (\\"xbc\\" !~ r)}"; echo rc=$?',
  "printf to stderr": 'awk "BEGIN{print \\"err\\" > \\"/dev/stderr\\"}" 2>err.txt; cat err.txt; echo rc=$?',
  "split empty string": 'awk "BEGIN{n=split(\\"\\", p, \\",\\"); print n}"; echo rc=$?',
  "default FS whitespace": 'printf "  a   b  \\n" | awk "{print NF, \\"|\\" \\$1 \\"|\\"}"; echo rc=$?',
  "tab separator": 'printf "a\\tb\\n" | awk -F"\\t" "{print \\$2}"; echo rc=$?',
  "quoted wildcard stays literal": 'printf "x\\n" > q.txt; awk "{print FILENAME}" "*.txt"; echo rc=$?',
};

const normalize = (text) => (text ?? "").replace(/\r/g, "").trim();
const perIdiomTimeout = Number(process.argv.find((argument) => argument.startsWith("--timeout="))?.slice("--timeout=".length) ?? 15000);

/**
 * Kill the staged candidate's surviving processes.
 *
 * The timeout kills the engine, and on Windows that does not kill the engine's child: a candidate that
 * loops without exiting (which is exactly what a broken awk does) leaves one process per piped idiom
 * behind — 55 of them after one full run, each holding the staged binary open, which then makes removing
 * the scratch directory fail with EPERM. Matching on the staged directory keeps this from touching the
 * toolchain's own `awk.exe`.
 */
function killStaged() {
  const script = `Get-CimInstance Win32_Process -Filter "Name='awk.exe'" | Where-Object { $_.ExecutablePath -like '${binDir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore", windowsHide: true });
  } catch (error) {
    // Best effort by design: the measurement is already recorded, and a machine without PowerShell only
    // loses the cleanup, not the result.
    console.log(`warn  could not clean up staged candidates: ${error.message}`);
  }
}
let agreed = 0;
for (const [label, script] of Object.entries(IDIOMS)) {
  const ours = run(script, { cwd: scratch, env, timeout: perIdiomTimeout });
  if (ours.status === null) killStaged();
  const outFile = join(scratch, "ref-out.txt");
  const errFile = join(scratch, "ref-err.txt");
  rmSync(outFile, { force: true });
  rmSync(errFile, { force: true });
  const reference = spawnSync(GIT_BASH, ["-c", `cd ${posixPath(scratch)} && { ${script}; } > ref-out.txt 2> ref-err.txt`], {
    cwd: scratch,
    env: { ...process.env },
    stdio: "ignore",
  });
  const refOut = normalize(readFileSync(outFile, "utf8"));
  const refErr = normalize(readFileSync(errFile, "utf8"));
  const ourOut = normalize(ours.stdout);
  const ourErr = normalize(ours.stderr);
  const same = ourOut === refOut && reference.status === ours.status;
  // Streamed, not collected: a candidate that hangs burns the per-idiom timeout on every piped case, and a
  // run that has to be stopped should still say what it saw. A candidate that loops without exiting can
  // also produce megabytes before the timeout, so every field is truncated before it is stringified.
  if (same) {
    agreed += 1;
    continue;
  }
  const brief = (text) => JSON.stringify(text.slice(0, 90));
  console.log(`DIFF  ${label}`);
  console.log(`        candidate: rc=${ours.status} ${brief(ourOut)} ${ourErr.split("\n")[0].slice(0, 46)}`);
  console.log(`        gawk     : rc=${reference.status} ${brief(refOut)} ${refErr.split("\n")[0].slice(0, 46)}`);
}
console.log(`\n${agreed}/${Object.keys(IDIOMS).length} agree with gawk 5.4.0 on stdout and exit status`);
console.log(`candidate: ${candidate}`);
killStaged();
try {
  rmSync(scratch, { recursive: true, force: true });
} catch (error) {
  // A candidate that ignored the kill keeps its binary mapped; the directory is under the temporary
  // directory and the operating system reclaims it, so this must not fail the measurement.
  console.log(`warn  could not remove ${scratch}: ${error.message}`);
}
if (agreed !== Object.keys(IDIOMS).length) process.exitCode = 1;