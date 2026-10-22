import { expect, test } from 'bun:test'
import { isAbort } from './abort.ts'

test('host process cancellation is recognized with or without terminal punctuation', () => {
  for (const message of ['jei: $.process.run(git) aborted', 'jei: $.process.run(git) aborted.', '$.process.spawn(rg) aborted.']) {
    expect(isAbort(new Error(message))).toBe(true)
  }
  for (const message of ['git merge aborted', 'fatal: Git operation aborted.', 'jei: $.process.run(git) failed.']) {
    expect(isAbort(new Error(message))).toBe(false)
  }
})
