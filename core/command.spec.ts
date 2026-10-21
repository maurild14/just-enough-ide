import { expect, test } from 'bun:test'
import { parseJeiArgument } from './command.ts'

test('parseJeiArgument', () => {
  expect(parseJeiArgument('')).toEqual({ toggle: true })
  expect(parseJeiArgument('   ')).toEqual({ toggle: true })
  expect(parseJeiArgument('git')).toEqual({ tab: 'git', toggle: false })
  expect(parseJeiArgument('GIT ')).toEqual({ tab: 'git', toggle: false })
  expect(parseJeiArgument('src/a.ts')).toEqual({ tab: 'files', reveal: 'src/a.ts', toggle: false })
  expect(parseJeiArgument('./src\\a.ts')).toEqual({ tab: 'files', reveal: 'src/a.ts', toggle: false })
})

test('unknown tab commands follow ordinary Files path handling', () => {
  expect(parseJeiArgument('search')).toEqual({ tab: 'search', toggle: false })
  expect(parseJeiArgument('symbols')).toEqual({ tab: 'files', reveal: 'symbols', toggle: false })
})
