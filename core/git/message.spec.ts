import { expect, test } from 'bun:test'
import { cleanMessage, commitPrompt } from './message.ts'

test('commitPrompt cuts the diff and notes it', () => {
  const p = commitPrompt('x'.repeat(50_000), 8000)
  expect(p.length).toBeLessThan(9000)
  expect(p).toContain('truncated')
  expect(p).toContain('Conventional Commits')
  expect(p).toContain('72')
})

test('commitPrompt does not split a surrogate pair at the cut', () => {
  const p = commitPrompt('a'.repeat(7) + '\u{1F600}'.repeat(5), 8)
  expect(p).toContain('a'.repeat(7) + '\n[diff truncated')
  expect(p).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
})

test('commitPrompt keeps a short diff whole', () => {
  const p = commitPrompt('+a', 8000)
  expect(p).toContain('+a')
  expect(p).not.toContain('truncated')
})

test('cleanMessage', () => {
  expect(cleanMessage('```\nfeat: add x\n```')).toBe('feat: add x')
  expect(cleanMessage('```text\nfeat: add x\n\nbody\n```\n')).toBe('feat: add x\n\nbody')
  expect(cleanMessage('"feat: add x"')).toBe('feat: add x')
  expect(cleanMessage('Commit message: fix: y')).toBe('fix: y')
  expect(cleanMessage('  Commit message:\n`fix: y`  ')).toBe('fix: y')
  expect(cleanMessage('```\nfeat: add x\n\nbody')).toBe('feat: add x\n\nbody')
  expect(cleanMessage('feat: x\n\nUse:\n```\nfoo\n```')).toBe('feat: x\n\nUse:\n```\nfoo\n```')
  expect(cleanMessage('Commit message:\n```\nfix: y\n```')).toBe('fix: y')
  expect(cleanMessage("feat: it's fine")).toBe("feat: it's fine")
})
