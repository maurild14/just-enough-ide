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
