import { expect, test } from 'bun:test'
import { classifyTool } from './classify.ts'

test('Claude Code ids', () => {
  expect(classifyTool('Read', { file_path: '/r/a.ts' })).toEqual({ kind: 'read', paths: ['/r/a.ts'] })
  expect(classifyTool('Edit', { file_path: '/r/a.ts' })).toEqual({ kind: 'write', paths: ['/r/a.ts'] })
  expect(classifyTool('Write', { file_path: '/r/a.ts' })).toEqual({ kind: 'write', paths: ['/r/a.ts'] })
  expect(classifyTool('NotebookEdit', { notebook_path: '/r/n.ipynb' })).toEqual({ kind: 'write', paths: ['/r/n.ipynb'] })
  expect(classifyTool('Grep', { pattern: 'x' })).toEqual({ kind: 'read', paths: [] })
  expect(classifyTool('Glob', { pattern: '*.ts', path: '/r/src' })).toEqual({ kind: 'read', paths: ['/r/src'] })
  expect(classifyTool('Bash', { command: 'cat src/a.ts' })).toEqual({ kind: 'read', paths: ['src/a.ts'] })
  expect(classifyTool('PowerShell', { command: 'git push' })).toEqual({ kind: 'git', paths: [] })
})

test('OpenCode ids, case-insensitive', () => {
  expect(classifyTool('edit', { filePath: '/r/a.ts' })).toEqual({ kind: 'write', paths: ['/r/a.ts'] })
  expect(classifyTool('multiedit', { filePath: '/r/a.ts' })?.kind).toBe('write')
  expect(classifyTool('patch', { patchText: 'x' })).toEqual({ kind: 'write', paths: [] })
  expect(classifyTool('READ', { filePath: '/r/a.ts' })?.kind).toBe('read')
  expect(classifyTool('list', { path: 'src' })).toEqual({ kind: 'read', paths: ['src'] })
  expect(classifyTool('bash', { command: 'git merge x' })?.kind).toBe('git')
})

test('unknown ids fall back', () => {
  expect(classifyTool('mystery', { path: 'x' })).toEqual({ kind: 'read', paths: ['x'] })
  expect(classifyTool('mystery', { command: 'head a.ts' })).toEqual({ kind: 'read', paths: ['a.ts'] })
  expect(classifyTool('mystery', { other: 1 })).toBeNull()
  expect(classifyTool('mystery', null)).toBeNull()
  expect(classifyTool('Read', {})).toBeNull()
})
