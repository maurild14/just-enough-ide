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

test('Search is tab 2 and the old Symbols command migrates there', () => {
  expect(parseJeiArgument('search')).toEqual({ tab: 'search', toggle: false })
  expect(parseJeiArgument('symbols')).toEqual({ tab: 'search', toggle: false })
})
