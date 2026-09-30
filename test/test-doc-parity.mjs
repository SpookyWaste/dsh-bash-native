// The Chinese documents are the source of truth. The root README is the one document published in both
// languages, and its English copy is brought back into line before a release — so the alignment check is
// a release-time gate rather than something every `npm test` has to satisfy.
//
// Where it runs, it defends the mirror's structure: same line count, every heading, table, list item and
// blank line at the same line number, and the same number of columns in every table row. It deliberately
// does not compare text: the two files are different languages, and the gate is that the translation is
// aligned, not that it is machine-generated from the Chinese one.
//
// `docs/` holds local working notes rather than tracked documents — `.gitignore` keeps the whole directory
// out of the repository and out of the package — and they are Chinese-only now, so the root README is the
// only pair left to keep in sync.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * Every document pair this repository keeps in sync.
 *
 * Only the READMEs are tracked: `docs/` is Chinese-only working notes, and the English half of the README
 * is the only English document that ships in the package.
 */
const PAIRS = [
  ['README.md', 'README.en.md'],
]

if (!process.argv.includes('--release')) {
  console.log(`SKIP  ${PAIRS.map(([chinese, english]) => `${chinese} / ${english}`).join(', ')}: the English copies are synchronised before a release, so pass --release to check them now`)
  process.exit(0)
}

// Both halves of a tracked pair have to be present at release time — a missing English README is a broken
// package, not a pair this run leaves alone.
const incomplete = PAIRS.filter(([chinese, english]) => !existsSync(join(root, chinese)) || !existsSync(join(root, english)))
assert.deepEqual(incomplete, [], `a tracked document pair is incomplete:\n  ${incomplete.map(([chinese, english]) => `${chinese} / ${english}`).join('\n  ')}`)

/** Reads a document as lines, normalising line endings so the counts are comparable. */
function readLines(path) {
  return readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n').split('\n')
}

/** The structural role of a line, used to compare the two documents position by position. */
function role(line) {
  if (/^#{1,6} /.test(line)) return 'heading'
  if (line.startsWith('|')) return 'table row'
  // The READMEs are written mostly as HTML tables, where a cell occupies its own line. Without this every
  // one of those lines reads as prose, and a translation could drop a cell without the check noticing.
  if (/^\s*<\/?(tr|thead|tbody)\b/.test(line) || /^\s*<(td|th)\b/.test(line)) return 'table row'
  if (line.startsWith('```')) return 'code fence'
  if (/^[-*] /.test(line) || /^\d+\. /.test(line)) return 'list item'
  if (line.trim().length === 0) return 'blank'
  return 'prose'
}

/** The number of cells a table row is divided into, so a row that loses a column is caught. */
function tableCells(line) {
  const html = line.match(/<(td|th)\b/g)
  return html !== null ? html.length : line.split('|').length
}

let passed = 0
const problems = []

for (const [chinese, english] of PAIRS) {
  const source = readLines(chinese)
  const mirror = readLines(english)

  if (mirror.length !== source.length) {
    problems.push(`${english} has ${mirror.length} lines but ${chinese} has ${source.length}; the mirror has to line up`)
    continue
  }

  const wrongRole = []
  const wrongCells = []
  for (let index = 0; index < source.length; index += 1) {
    const left = source[index]
    const right = mirror[index]
    if (role(left) !== role(right)) {
      wrongRole.push(`${index + 1}: ${role(left)} vs ${role(right)}`)
    }
    if (role(left) === 'table row' && tableCells(left) !== tableCells(right)) {
      wrongCells.push(`${index + 1}: ${tableCells(left)} vs ${tableCells(right)} cells`)
    }
  }

  if (wrongRole.length > 0) {
    problems.push(`${english} is not aligned with ${chinese} at ${wrongRole.slice(0, 5).join(', ')}${wrongRole.length > 5 ? ` (+${wrongRole.length - 5} more)` : ''}`)
  }
  if (wrongCells.length > 0) {
    problems.push(`${english} has table rows of a different shape at ${wrongCells.slice(0, 5).join(', ')}${wrongCells.length > 5 ? ` (+${wrongCells.length - 5} more)` : ''}`)
  }
  if (wrongRole.length === 0 && wrongCells.length === 0) {
    passed += 1
    console.log(`ok    ${chinese} and ${english} are aligned line for line (${source.length - 1} content lines)`)
  }
}

assert.deepEqual(problems, [], `document pairs are not aligned:\n  ${problems.join('\n  ')}`)

console.log(`\n${passed}/${PAIRS.length} 文档对逐行对齐`)
