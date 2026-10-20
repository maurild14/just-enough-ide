import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, FakeHost, makeRepo, makeTemp, writeFiles } from '../../test/fake-host.ts'
import type { RunOptions, Stream } from '../host.ts'
import { definitions, fileOutline, findSymbol, incoming, outgoing, references, symbolSendText } from './service.ts'
import { isDefinitionLine } from './approx.ts'

afterEach(cleanup)
const files = {
  'src/store.ts': 'export function getUser() {\n return load()\n}\nexport function load() {\n return 1\n}\n',
  'src/app.ts': 'export function start() {\n getUser()\n getUser()\n}\nexport function getUser() { return 2 }\n',
  'notes.txt': 'getUser()\n',
}
class NoRg extends FakeHost {
  override stream(argv: readonly string[], options?: RunOptions): Stream { return super.stream(argv[0] === 'rg' ? ['jei-missing-executable'] : argv, options) }
}

test('real rg definitions prefer the same file and workspace find filters declaration-shaped lines', async () => {
  const root = makeTemp()
  writeFiles(root, files)
  const host = new FakeHost()
  expect((await definitions(host, root, 'getUser', 'src/app.ts')).map((r) => r.rel)).toEqual(['src/app.ts', 'src/store.ts'])
  expect((await findSymbol(host, root, 'getUser')).length).toBe(2)
})

test('references fill cached containers, incoming groups callers and outgoing resolves first definitions', async () => {
  const root = makeTemp()
  writeFiles(root, files)
  const host = new FakeHost()
  const refs = await references(host, root, 'getUser')
  expect(refs.filter((r) => r.rel === 'src/app.ts').map((r) => r.container)).toEqual(['start', 'start', 'getUser'])
  expect(refs.find((r) => r.rel === 'notes.txt')?.container).toBeNull()
  expect((await incoming(host, root, 'getUser')).map((r) => [r.rel, r.line, r.container])).toEqual([['src/app.ts', 1, 'start']])
  const node = (await fileOutline(host, root, 'src/store.ts'))![0]!
  expect(await outgoing(host, root, 'src/store.ts', node)).toEqual([{ rel: 'src/store.ts', line: 4, text: 'export function load() {', container: null }])
})

test('git grep fallback supplies the same approximate service results', async () => {
  const repo = await makeRepo(files)
  const host = new NoRg()
  expect((await references(host, repo.dir, 'getUser')).length).toBe(5)
  expect((await definitions(host, repo.dir, 'getUser', 'src/app.ts'))[0]?.rel).toBe('src/app.ts')
})

test('real rg and Git grep definition queries cover the seven fixture languages and tab indentation', async () => {
  const fixturePaths = ['ts/store.ts', 'py/store.py', 'go/store.go', 'rs/store.rs', 'java/Store.java', 'cs/Store.cs', 'md/guide.md']
  const fixtureFiles = Object.fromEntries(fixturePaths.map((rel) => [rel, readFileSync(new URL(`../../test/fixtures/symbols/${rel}`, import.meta.url), 'utf8')]))
  const repo = await makeRepo(fixtureFiles)
  for (const host of [new FakeHost(), new NoRg()]) {
    for (const [name, rel] of [['get_user', 'py/store.py'], ['GetUser', 'go/store.go'], ['new', 'rs/store.rs'], ['getUser', 'java/Store.java'], ['GetUser', 'cs/Store.cs'], ['loadUser', 'ts/store.ts'], ['Users', 'md/guide.md']]) {
      expect([host.constructor.name, name, (await definitions(host, repo.dir, name!, rel!)).some((ref) => ref.rel === rel)]).toEqual([host.constructor.name, name, true])
    }
  }
})

for (const [engine, makeHost] of [['rg', () => new FakeHost()], ['Git grep', () => new NoRg()]] as const) {
  for (const [name, line] of [['declared', 2], ['defaulted', 5]] as const) {
    test(`${engine} finds the TS ${name} method and excludes ordinary calls`, async () => {
      const source = 'export interface Store {\n declared(): string;\n}\nexport class Users {\n defaulted(id = next()) { return id }\n}\nfunction start() {\n declared();\n defaulted(next());\n}\n'
      const repo = await makeRepo({ 'src/store.ts': source })
      const host = makeHost()
      expect(isDefinitionLine('ts', name, source.split('\n')[line - 1]!)).toBe(true)
      expect((await fileOutline(host, repo.dir, 'src/store.ts'))?.some((node) => node.children.some((child) => child.name === name))).toBe(true)
      expect((await findSymbol(host, repo.dir, name)).map((ref) => ref.line)).toEqual([line])
      expect((await definitions(host, repo.dir, name, 'src/store.ts')).map((ref) => ref.line)).toEqual([line])
    })
  }
}

test('references read each source outline once per request', async () => {
  const root = makeTemp()
  writeFiles(root, files)
  class Counted extends FakeHost {
    readonly reads = new Map<string, number>()
    override async readHead(path: string, max: number) { this.reads.set(path, (this.reads.get(path) ?? 0) + 1); return super.readHead(path, max) }
  }
  const host = new Counted()
  await references(host, root, 'getUser')
  expect([...host.reads.values()]).toEqual([1, 1])
})

test('outline reads reject outside-root, nonfiles, whole-file binary/invalid UTF-8 and oversized files', async () => {
  const root = makeTemp()
  writeFiles(root, { 'ok.ts': 'export function load() {}', 'binary.ts': 'export function load() {}\n' + ' '.repeat(9000) + '\0', 'large.ts': 'x'.repeat(4 * 1024 * 1024 + 1) })
  writeFileSync(join(root, 'invalid.ts'), Buffer.concat([Buffer.from(' '.repeat(9000)), Buffer.from([0x80])]))
  const host = new FakeHost()
  expect((await fileOutline(host, root, 'ok.ts'))?.[0]?.name).toBe('load')
  for (const rel of ['../secret.ts', 'missing.ts', 'binary.ts', 'invalid.ts', 'large.ts', '.']) expect(await fileOutline(host, root, rel)).toBeNull()
  class Escaped extends FakeHost { override async stat(path: string) { const info = await super.stat(path); return info && path.endsWith('ok.ts') ? { ...info, realPath: join(root, '..', 'outside.ts') } : info } }
  expect(await fileOutline(new Escaped(), root, 'ok.ts')).toBeNull()
})

test('native symbol paths keep POSIX colons and reject backslashes before any counterpart read', async () => {
  const source = Buffer.from('export function load() {}\n')
  class Posix extends FakeHost {
    override readonly platform = 'linux' as const
    readonly reads: string[] = []
    override async stat(path: string) { return { kind: path === '/acme-app' ? 'dir' as const : 'file' as const, size: source.length, realPath: path } }
    override async readHead(path: string) { this.reads.push(path); return new Uint8Array(source) }
  }
  const host = new Posix()
  expect((await fileOutline(host, '/acme-app', 'a:b.ts'))?.[0]?.name).toBe('load')
  expect(await fileOutline(host, '/acme-app', 'a\\b.ts')).toBeNull()
  expect(host.reads).toEqual(['/acme-app/a:b.ts'])
})

test('symbol agent text includes location, reference count and bounded omission suffix', () => {
  const def = { rel: 'src/store.ts', line: 1, text: '', container: null }
  expect(symbolSendText('getUser', def, [{ ...def, rel: 'src/app.ts', line: 2 }])).toBe('getUser (src/store.ts:1) and its 1 references: src/app.ts:2')
  const long = symbolSendText('getUser', def, Array.from({ length: 2000 }, (_, line) => ({ ...def, rel: 'src/' + 'x'.repeat(40) + '.ts', line })))
  expect(long.length).toBeLessThanOrEqual(12_000)
  expect(long).toMatch(/…and \d+ more\.$/)
  expect(symbolSendText('getUser', null, [])).toBe('getUser and its 0 references: ')
})
