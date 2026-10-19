import { expect, test } from 'bun:test'
import { mentionText } from './mention.ts'

test('mentions end with one trailing space', () => {
  expect(mentionText(['src/a.ts', 'src/b'])).toBe('@src/a.ts @src/b ')
  expect(mentionText(['a.ts'])).toBe('@a.ts ')
})
test('quotes paths with spaces; posix separators', () => {
  expect(mentionText(['my file.ts', 'x/y.ts'])).toBe('@"my file.ts" @x/y.ts ')
  expect(mentionText(['src\\a.ts'])).toBe('@src/a.ts ')
})
test('nothing to mention', () => expect(mentionText([])).toBe(''))
