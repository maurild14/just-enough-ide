import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { enclosing, languageFor, outline, SYMBOL_CAP, type SymbolNode } from './outline.ts'

const fixture = (path: string) => readFileSync(new URL(`../../test/fixtures/symbols/${path}`, import.meta.url), 'utf8')
const n = (name: string, kind: SymbolNode['kind'], line: number, endLine: number, children: SymbolNode[] = []): SymbolNode => ({ name, kind, line, endLine, children })

test('TS/JS outline nests methods/functions, ignores braces in strings/comments and detects arrows', () => {
  expect(outline('store.ts', fixture('ts/store.ts'))).toEqual([
    n('UserStore', 'class', 2, 11, [n('getUser', 'method', 4, 10, [n('pick', 'function', 6, 8)])]),
    n('User', 'interface', 12, 14), n('UserId', 'type', 15, 15), n('Role', 'enum', 16, 18),
    n('loadUser', 'function', 19, 21), n('version', 'const', 22, 22),
  ])
  for (const ext of ['js', 'jsx', 'tsx', 'mjs', 'cjs', 'mts', 'cts']) expect(languageFor(`store.${ext}`)).toBe('ts')
})

test('Python tabs use eight-column indentation and nested definitions close at dedent', () => {
  expect(outline('store.py', fixture('py/store.py'))).toEqual([
    n('Store', 'class', 2, 8, [n('get_user', 'method', 3, 6, [n('normalize', 'function', 4, 5)]), n('save', 'method', 7, 8)]),
    n('load_user', 'function', 9, 10),
  ])
})

test('mixed Python indentation advances a tab to the next eight-column stop', () => {
  const text = 'class Store:\n \tdef get_user(self):\n         def nested():\n          pass\n        def save(self):\n         pass'
  expect(outline('store.py', text)).toEqual([n('Store', 'class', 1, 6, [n('get_user', 'method', 2, 4, [n('nested', 'function', 3, 4)]), n('save', 'method', 5, 6)])])
})

test('Go receiver functions attach to the declared type', () => {
  expect(outline('store.go', fixture('go/store.go'))).toEqual([
    n('Svc', 'type', 1, 3, [n('GetUser', 'method', 4, 6)]), n('UserID', 'type', 7, 7), n('getUser', 'function', 8, 10),
  ])
})

test('Rust impl blocks and traits own their methods', () => {
  expect(outline('store.rs', fixture('rs/store.rs'))).toEqual([
    n('User', 'class', 1, 3), n('impl User', 'type', 4, 8, [n('new', 'method', 5, 7)]),
    n('Store', 'interface', 9, 11, [n('get', 'method', 10, 10)]), n('Role', 'enum', 12, 14),
  ])
})

test('Rust impl waits for a delayed opening brace without making aliases capture later scopes', () => {
  const rust = outline('store.rs', 'impl<T> Store<T>\n{\n fn get_user(&self) {\n  load()\n }\n}\nfn after() {}')!
  expect(rust).toEqual([n('impl Store', 'type', 1, 6, [n('get_user', 'method', 3, 5)]), n('after', 'function', 7, 7)])
  expect(enclosing(rust, 4)?.name).toBe('get_user')
  expect(enclosing(rust, 7)?.name).toBe('after')
  expect(outline('store.ts', 'export type UserID = string\nexport function later() {\n}')).toEqual([n('UserID', 'type', 1, 1), n('later', 'function', 2, 3)])
  expect(outline('store.go', 'type UserID string\nfunc later() {\n}')).toEqual([n('UserID', 'type', 1, 1), n('later', 'function', 2, 3)])
})

test('Java and C# nest classes and detect generic-return methods and interface signatures', () => {
  for (const [rel, get, save, read] of [['java/Store.java', 'getUser', 'save', 'read'], ['cs/Store.cs', 'GetUser', 'Save', 'Read']]) {
    const offset = rel!.startsWith('cs/') ? 1 : 0
    expect(outline(rel!, fixture(rel!))).toEqual([
      n('Store', 'class', 1 + offset, 10 + offset, [n('Row', 'class', 2 + offset, 6 + offset, [n(save!, 'method', 3 + offset, 5 + offset)]), n(get!, 'method', 7 + offset, 9 + offset)]),
      n('Reader', 'interface', 11 + offset, 13 + offset, [n(read!, 'method', 12 + offset, 12 + offset)]), n('Role', 'enum', 14 + offset, 16 + offset),
    ])
  }
})

test('Markdown headings nest by level and ignore fenced code', () => {
  expect(outline('guide.md', fixture('md/guide.md'))).toEqual([
    n('Acme app', 'heading', 1, 9, [n('Users', 'heading', 3, 5, [n('Read', 'heading', 4, 5)]), n('Storage', 'heading', 6, 9)]),
    n('Notes', 'heading', 10, 10),
  ])
})

test('unsupported files, unbalanced input, innermost enclosure and delayed braces', () => {
  expect(outline('store.txt', 'class Store {}')).toBeNull()
  const nodes = outline('store.ts', fixture('ts/unbalanced.ts'))!
  expect(nodes).toEqual([n('Store', 'class', 1, 3, [n('getUser', 'method', 2, 3)])])
  expect(enclosing(nodes, 3)?.name).toBe('getUser')
  expect(enclosing(nodes, 0)).toBeNull()
  expect(outline('Store.java', 'class Store\n{\n void save()\n {\n }\n}')).toEqual([n('Store', 'class', 1, 6, [n('save', 'method', 3, 5)])])
  expect(outline('Store.cs', 'class Store {\n public int GetUser() => Load();\n}')).toEqual([n('Store', 'class', 1, 3, [n('GetUser', 'method', 2, 2)])])
  expect(outline('store.ts', 'class Store {\n getUser(id = 1) { return id }\n}')).toEqual([n('Store', 'class', 1, 3, [n('getUser', 'method', 2, 2)])])
})

test('minified 5 MiB input is bounded below 200 ms and outlines stop at the symbol cap', () => {
  const minified = 'export const data = "' + 'x'.repeat(5 * 1024 * 1024) + '"'
  const start = performance.now()
  expect(outline('large.js', minified)).toEqual([n('data', 'const', 1, 1)])
  expect(performance.now() - start).toBeLessThan(200)
  expect(outline('many.ts', 'export const item = 1\n'.repeat(2500))?.length).toBe(SYMBOL_CAP)
  expect(outline('long.ts', ' '.repeat(2001) + 'function hidden() {}')).toEqual([])
})
