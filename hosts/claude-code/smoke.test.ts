import { expect, test } from 'claude-code/testing'
import { VERSION } from '../../core/version.ts'

test('module loads', async () => {
  expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
})
