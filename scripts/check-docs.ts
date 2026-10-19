// Lints the agent index and docs/ (run with `bun run check:docs`). Dev script: no dependencies.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const problems: string[] = []
const fail = (message: string) => problems.push(message)
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const posix = (p: string) => p.replaceAll(String.fromCharCode(92), '/')

// Files that docs may name before they exist. Remove an entry when its task creates the file.
const PLANNED = new Set(['docs/qa.md', 'CHANGELOG.md'])

// AGENTS.md and CLAUDE.md: identical bytes, at most 150 lines.
if (!Buffer.from(readFileSync(join(root, 'AGENTS.md'))).equals(readFileSync(join(root, 'CLAUDE.md')))) {
  fail('CLAUDE.md differs from AGENTS.md (run `bun run sync:agents`).')
}
const agentLines = read('AGENTS.md').split('\n').length
if (agentLines > 150) fail(`AGENTS.md has ${agentLines} lines (max 150).`)

// Markdown files under docs/ (plans are not scanned: they quote paths that do not exist yet).
const walk = (dir: string): string[] =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) return entry.name === 'plans' ? [] : walk(rel)
    return entry.name.endsWith('.md') ? [rel] : []
  })
const docs = walk('docs')

// Links: relative Markdown links and backticked docs/... or *.md paths, outside fenced code.
const exists = (path: string, from: string) =>
  [join(root, path), join(root, dirname(from), path)].some(existsSync) || PLANNED.has(path)
for (const file of ['AGENTS.md', ...docs]) {
  const text = read(file).replace(/^```[\s\S]*?^```/gm, '')
  const targets = new Set<string>()
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) targets.add(m[1]!)
  for (const m of text.matchAll(/`((?:docs\/|[\w.\/-]+\.md)[^`\s]*)`/g)) targets.add(m[1]!)
  for (const raw of targets) {
    if (/^[a-z]+:/i.test(raw) || raw.startsWith('#') || /[*<>{}…]|NNNN|YYYY/.test(raw)) continue
    const path = raw.split('#')[0]!
    if (path && !exists(path, file)) fail(`${file}: broken reference ${raw}`)
  }
}

// Headers, index and ADRs.
const index = existsSync(join(root, 'docs/README.md')) ? read('docs/README.md') : ''
for (const file of docs) {
  const lines = read(file).split('\n')
  if (!lines.slice(0, 6).some((l) => l.includes('Last reviewed:'))) fail(`${file}: missing "Last reviewed:" header.`)
  const name = posix(relative('docs', file))
  const isAdr = name.startsWith('decisions/') && name !== 'decisions/README.md'
  if (isAdr) {
    const base = name.slice('decisions/'.length)
    if (!/^\d{4}-[a-z0-9-]+\.md$/.test(base)) fail(`${file}: ADR file name must be NNNN-kebab-title.md.`)
    if (!lines.some((l) => l.startsWith('Status:'))) fail(`${file}: ADR is missing a "Status:" line.`)
  } else if (name !== 'README.md' && !index.includes(name.startsWith('decisions/') ? 'decisions/' : name)) {
    fail(`${file}: not mentioned in docs/README.md.`)
  }
}

if (problems.length) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(`docs ok (${docs.length} files, AGENTS.md ${agentLines} lines).`)
