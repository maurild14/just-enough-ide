import { expect, test } from 'bun:test'
import { sensitivePaths } from './sensitive.ts'

test('flags secrets by basename', () => {
  expect(sensitivePaths(['src/a.ts', '.env.local', 'keys/id_rsa', '.envrc'])).toEqual(['.env.local', 'keys/id_rsa'])
})

test('all listed patterns, case-insensitive, both separators', () => {
  const hit = ['.env', 'a/B.PEM', 'c.key', 'id_ed25519.pub', 'x.p12', 'y.pfx', 'sub\\Credentials.json', '.npmrc', 'd/.netrc']
  expect(sensitivePaths(hit)).toEqual(hit)
})

test('env templates are not sensitive', () => {
  expect(sensitivePaths(['.env.example', 'app/.env.sample', '.ENV.template'])).toEqual([])
})
