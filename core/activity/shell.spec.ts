import { expect, test } from 'bun:test'
import { classifyShell } from './shell.ts'

test('readers', () => {
  expect(classifyShell('cat src/a.ts | head')).toEqual({ kind: 'read', paths: ['src/a.ts'] })
  expect(classifyShell('head -n 5 a.ts b.ts')).toEqual({ kind: 'read', paths: ['a.ts', 'b.ts'] })
  expect(classifyShell('tail -n5 a.ts')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('bat --color=always a.ts')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('CAT "a b.ts"')).toEqual({ kind: 'read', paths: ['a b.ts'] })
  expect(classifyShell('/usr/bin/less a.ts')).toEqual({ kind: 'read', paths: ['a.ts'] })
})

test('Get-Content', () => {
  expect(classifyShell('Get-Content -Path "a b.txt"')).toEqual({ kind: 'read', paths: ['a b.txt'] })
  expect(classifyShell('Get-Content a.txt -TotalCount 5')).toEqual({ kind: 'read', paths: ['a.txt'] })
})

test('grep and rg: the first word is the pattern', () => {
  expect(classifyShell('rg foo src/a.ts')).toEqual({ kind: 'read', paths: ['src/a.ts'] })
  expect(classifyShell('grep -n -e foo a.ts')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('rg foo')).toBeNull()
})

test('pipelines and redirection', () => {
  expect(classifyShell('cat a.ts > out.txt')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('cat a.ts >out.txt 2>&1')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('echo "a | b" && cat c.ts; head d.ts || true')).toEqual({ kind: 'read', paths: ['c.ts', 'd.ts'] })
})

test('git', () => {
  expect(classifyShell('git commit -m "x"')).toEqual({ kind: 'git', paths: [] })
  expect(classifyShell('git add . && git push')).toEqual({ kind: 'git', paths: [] })
  for (const s of ['commit', 'push', 'pull', 'checkout', 'switch', 'merge', 'rebase', 'reset']) {
    expect(classifyShell(`git ${s}`)?.kind).toBe('git')
  }
  expect(classifyShell('git status')).toBeNull()
  expect(classifyShell('git diff')).toBeNull()
  expect(classifyShell('git log')).toBeNull()
  expect(classifyShell('git show HEAD')).toBeNull()
})

test('git global options', () => {
  expect(classifyShell('git -C x commit')?.kind).toBe('git')
  expect(classifyShell('git -c a=b push')?.kind).toBe('git')
  expect(classifyShell('git --git-dir d push')?.kind).toBe('git')
  expect(classifyShell('git --git-dir=d push')?.kind).toBe('git')
  expect(classifyShell('git --no-pager log')).toBeNull()
})

test('quoted operators are arguments; &> and 2>&1 are redirects', () => {
  expect(classifyShell('grep ">" a.ts')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('cat a &> out')).toEqual({ kind: 'read', paths: ['a'] })
  expect(classifyShell('cat a >& out')).toEqual({ kind: 'read', paths: ['a'] })
  expect(classifyShell('cat a 2>&1 | head')).toEqual({ kind: 'read', paths: ['a'] })
})

test('redirect targets, quoted or attached', () => {
  expect(classifyShell('cat a.ts >"out.txt"')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell("cat a 2>'err.log'")).toEqual({ kind: 'read', paths: ['a'] })
  expect(classifyShell('cat a.ts>out')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('cat a.ts 2>&1 >out b.ts')).toEqual({ kind: 'read', paths: ['a.ts', 'b.ts'] })
  expect(classifyShell('cat <in.txt a.ts')).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyShell('grep ">" a.ts')).toEqual({ kind: 'read', paths: ['a.ts'] })
})

test('nothing relevant', () => {
  expect(classifyShell('npm test')).toBeNull()
  expect(classifyShell('')).toBeNull()
})
