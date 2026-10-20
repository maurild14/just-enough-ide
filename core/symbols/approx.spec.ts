import { expect, test } from 'bun:test'
import { calleeNames, definitionArgs, isDefinitionLine, referencesQuery } from './approx.ts'
import { outline } from './outline.ts'

test('definition shapes distinguish declarations from calls/comments and escape names', () => {
  for (const [lang, name, text] of [['ts', 'getUser', 'export function getUser('], ['py', 'get_user', 'def get_user('], ['go', 'GetUser', 'func (s *Svc) GetUser('], ['rs', 'get_user', 'pub fn get_user('], ['java', 'getUser', 'public User getUser('], ['cs', 'GetUser', 'public User GetUser(']] as const) {
    expect(isDefinitionLine(lang, name, text)).toBe(true)
    expect(isDefinitionLine(lang, name, `${name}(id)`)).toBe(false)
    expect(isDefinitionLine(lang, name, `// ${name}`)).toBe(false)
  }
  expect(isDefinitionLine('ts', 'getUser', 'function getUserExtra()')).toBe(false)
  expect(isDefinitionLine('ts', '$load', 'export const $load = () => 1')).toBe(true)
  expect(isDefinitionLine('md', 'Users', '## Users')).toBe(true)
  for (const [lang, name, text] of [['py', 'get_user', '\tdef get_user(self):'], ['go', 'GetUser', '\tfunc (s *Svc) GetUser(id string) {}'], ['java', 'getUser', 'public User<T> getUser(String id) {}'], ['cs', 'GetUser', 'public User<T> GetUser(string id) {}']] as const) expect(new RegExp(definitionArgs(name, lang).text).test(text)).toBe(true)
  const q = definitionArgs('-x', null)
  expect(q.regex).toBe(true)
  expect(() => new RegExp(q.text)).not.toThrow()
  expect(referencesQuery('-x')).toEqual({ text: '-x', regex: false, wholeWord: true, caseSensitive: true, include: [], exclude: [] })
})

test('callees exclude keywords, self, comments and strings, and deduplicate in source order', () => {
  const text = 'function run() {\n if (ready()) { load(); load() }\n for (;;) run()\n return finish()\n // fake()\n const s = "hidden()"\n}\nother()'
  const node = outline('app.ts', text)![0]!
  expect(calleeNames(text, node, 'ts')).toEqual(['ready', 'load', 'finish'])
  expect(calleeNames('class Store {\n getUser() { load() }\n}', { name: 'getUser', kind: 'method', line: 2, endLine: 2, children: [] }, 'ts')).toEqual(['load'])
  expect(calleeNames('def run():\n    load()\n    # fake()\n    text = "hidden()"', { name: 'run', kind: 'function', line: 1, endLine: 4, children: [] }, 'py')).toEqual(['load'])
  expect(calleeNames(Array.from({ length: 2500 }, (_, i) => `call${i}()`).join('\n'), { name: 'run', kind: 'function', line: 1, endLine: 2500, children: [] }, 'ts').length).toBe(2000)
})
