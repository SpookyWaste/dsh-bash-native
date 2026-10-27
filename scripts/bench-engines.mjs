/**
 * Times the same bash workload on this package's rubash and on Git Bash's MSYS2 bash, and on WSL when it is
 * installed.
 *
 * The numbers this prints are the ones the README quotes. Every case is builtins and control flow plus one
 * external spawn, so the comparison is about the engine rather than whose coreutils happen to be on `PATH`;
 * each case runs five times and the minimum is reported, which is the discipline rubash's own ledger uses
 * (the minimum is the least noisy estimate of the work, and a sequential run keeps the two engines from
 * competing for a core).
 *
 * MSYS2's runtime creates a named pipe when it starts, which some confined sessions refuse (`Win32 error 5`).
 * Run this from a normal terminal — the comparison is meaningless without the runtime that is being measured.
 *
 * Usage:
 *   node scripts/bench-engines.mjs                      auto-detect Git Bash and WSL
 *   node scripts/bench-engines.mjs --msys=<bash.exe>    point at another MSYS bash
 *   node scripts/bench-engines.mjs --runs=9             more samples (the minimum is reported)
 * @module dsh-bash-native/scripts/bench-engines
 */

import { spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** The workload: a label, a script, and the number of whole runs to take the minimum of. */
const CASES = [
  ['startup (`-c :`)', ':', 20],
  ['`echo hi`', 'echo hi', 20],
  ['arith loop 10k', 'i=0; while [ $i -lt 10000 ]; do i=$((i+1)); done', 3],
  ['expansion 10k', 's=abc; i=0; while [ $i -lt 10000 ]; do t=${s^^}; i=$((i+1)); done', 3],
  ['`[ ]` 20k', 'i=0; while [ $i -lt 20000 ]; do [ 1 -eq 2 ]; i=$((i+1)); done', 3],
  ['command sub 300', 'i=0; while [ $i -lt 300 ]; do x=$(true); i=$((i+1)); done', 3],
  ['subshell 300', 'i=0; while [ $i -lt 300 ]; do ( : ); i=$((i+1)); done', 3],
  ['external spawn 20', 'i=0; while [ $i -lt 20 ]; do cmd.exe /c exit; i=$((i+1)); done', 3],
]

/** Read `--name=value`. */
function option(argv, name, fallback) {
  return argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
}

/** The engines to measure: the artifact this package ships, Git Bash when it is installed, and WSL. */
function engines(argv) {
  const rubash = join(ROOT, 'engine', 'win32-x64', 'rubash.exe')
  const found = [{ name: 'rubash', binary: rubash, prefix: [], label: 'rubash（本插件）' }]
  const gitBash = option(argv, 'msys', join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'))
  if (existsSync(gitBash)) found.push({ name: 'msys', binary: gitBash, prefix: [], label: 'Git Bash / MSYS2' })
  else console.log(`note: no MSYS bash at ${gitBash} (pass --msys=<bash.exe>)`)
  const wsl = spawnSync('wsl.exe', ['-e', 'true'], { stdio: 'ignore', timeout: 20000 })
  if (wsl.status === 0) found.push({ name: 'wsl', binary: 'wsl.exe', prefix: ['bash'], label: 'WSL' })
  else console.log('note: WSL is not installed here, so it is not measured')
  return found
}

/**
 * Run one case once and time it.
 * @param engine - a value from {@link engines}.
 * @param script - the script to run.
 * @param directory - scratch directory for the captured streams.
 * @returns elapsed milliseconds, and whether the run succeeded.
 */
function timeOnce(engine, script, directory) {
  const out = join(directory, `${engine.name}.out`)
  const err = join(directory, `${engine.name}.err`)
  const outFd = openSync(out, 'w')
  const errFd = openSync(err, 'w')
  const start = process.hrtime.bigint()
  const result = spawnSync(engine.binary, [...engine.prefix, '-c', script], { stdio: ['ignore', outFd, errFd], timeout: 240000 })
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6
  closeSync(outFd)
  closeSync(errFd)
  const stderr = readFileSync(err, 'utf8').trim().split('\n').pop() ?? ''
  return { elapsed, ok: result.status === 0, detail: result.error?.message ?? stderr }
}

const argv = process.argv.slice(2)
const runs = Number.parseInt(option(argv, 'runs', '5'), 10)
const measured = engines(argv)
const directory = mkdtempSync(join(tmpdir(), 'bench-engines-'))
const results = new Map(measured.map((engine) => [engine.name, {}]))

for (const [label, script] of CASES) {
  for (const engine of measured) {
    let best = Number.POSITIVE_INFINITY
    let detail = ''
    for (let run = 0; run < runs; run += 1) {
      const sample = timeOnce(engine, script, directory)
      if (!sample.ok) {
        detail = sample.detail
        best = Number.NaN
        break
      }
      best = Math.min(best, sample.elapsed)
    }
    results.get(engine.name)[label] = Number.isNaN(best) ? null : best
    if (detail.length > 0) console.log(`note: ${engine.name} could not run "${label}": ${detail}`)
  }
}

console.log('')
console.log(`| 工作负载 | ${measured.map((engine) => engine.label).join(' | ')} |`)
console.log(`|---|---:|${measured.slice(1).map(() => '---:|').join('')}`)
for (const [label] of CASES) {
  const cells = measured.map((engine) => {
    const value = results.get(engine.name)[label]
    return value === null || value === undefined ? '—' : `${value.toFixed(0)} ms`
  })
  console.log(`| ${label} | ${cells.join(' | ')} |`)
}
rmSync(directory, { recursive: true, force: true })