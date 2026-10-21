import { expect, test } from 'bun:test'
import type { DirEntry, FileStat, Host, Platform } from './host.ts'

import * as fsops from './fsops.ts'

function fixture(platform: Platform = 'linux') {
  const root = platform === 'win32' ? 'C:/acme-app' : '/acme-app'
  const nodes = new Map<string, FileStat>([[root, { kind: 'dir', size: 0, realPath: root }]])
  const links = new Set<string>()
  const calls: string[] = []
  const add = (rel: string, kind: FileStat['kind'] = 'file', realPath = `${root}/${rel}`) => nodes.set(`${root}/${rel}`, { kind, size: kind === 'file' ? 4 : 0, realPath })
  add('src', 'dir'); add('src/file.txt'); add('src/sub', 'dir'); add('other', 'dir'); add('keep.txt')
  const host = {
    platform,
    async stat(path: string) { calls.push(`stat:${path}`); return nodes.get(path) ?? null },
    async list(path: string) {
      calls.push(`list:${path}`)
      if (nodes.get(path)?.kind !== 'dir') throw new Error('Unreadable directory.')
      return [...nodes].filter(([p]) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')).map(([p, s]): DirEntry => ({ name: p.slice(path.length + 1), kind: links.has(p) ? 'other' : s.kind, size: s.size }))
    },
    async run() { throw new Error('Unexpected effect.') }, async writeText() { throw new Error('Unexpected effect.') },
  } as unknown as Host
  return { host, root, nodes, links, calls, add }
}

test('new uses selected directory, selected file parent, or project root and preserves legal whitespace', async () => {
  const f = fixture()
  for (const [source, parent] of [['src', 'src'], ['src/file.txt', 'src'], ['', '']] as const) {
    const prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'new', source })
    const plan = await fsops.planFsOp(f.host, prepared!, ' new.txt ')
    expect(plan).toMatchObject({ kind: 'new', destination: parent ? `${parent}/ new.txt ` : ' new.txt ', targetKind: 'file' })
  }
  const prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'new', source: 'src' })
  expect(await fsops.planFsOp(f.host, prepared!, 'folder/')).toMatchObject({ destination: 'src/folder', targetKind: 'dir' })
})

test('Windows canonical UNC accepts dotted hosts and IPs while refusing exact device hosts', async () => {
  const f = fixture('win32')
  for (const host of ['files.example', '192.0.2.1']) {
    const root = `//${host}/share/acme-app`
    f.nodes.set(root, { kind: 'dir', size: 0, realPath: root })
    f.nodes.set(`${root}/source.txt`, { kind: 'file', size: 4, realPath: `${root}/source.txt` })
    const prepared = await fsops.prepareFsOp(f.host, root, { kind: 'rename', source: 'source.txt' })
    expect(await fsops.planFsOp(f.host, prepared, 'renamed.txt')).toMatchObject({ realRoot: root, destination: 'renamed.txt' })
  }
  for (const host of ['.', '?']) {
    const root = `//${host}/share/acme-app`
    f.nodes.set(root, { kind: 'dir', size: 0, realPath: root })
    await expect(fsops.prepareFsOp(f.host, root, { kind: 'new', source: '' })).rejects.toThrow()
  }
})

test('rename is same-parent basename and move is an exact project-relative path', async () => {
  const f = fixture()
  const rename = await fsops.prepareFsOp(f.host, f.root, { kind: 'rename', source: 'src/file.txt' })
  expect(await fsops.planFsOp(f.host, rename!, 'renamed.txt')).toMatchObject({ source: 'src/file.txt', destination: 'src/renamed.txt' })
  const move = await fsops.prepareFsOp(f.host, f.root, { kind: 'move', source: 'src/file.txt' })
  expect(await fsops.planFsOp(f.host, move!, 'other/moved.txt')).toMatchObject({ destination: 'other/moved.txt' })
  await expect(fsops.planFsOp(f.host, rename!, 'other/name')).rejects.toThrow()
  await expect(fsops.planFsOp(f.host, move!, 'missing/name')).rejects.toThrow()
})

test('new and rename accept only one nonblank basename; only new permits one trailing slash', async () => {
  const f = fixture()
  for (const kind of ['new', 'rename'] as const) {
    const prepared = await fsops.prepareFsOp(f.host, f.root, { kind, source: 'src/file.txt' })
    for (const value of ['', ' ', '.', '..', 'a/b', 'a\\b', 'folder//', '/']) await expect(fsops.planFsOp(f.host, prepared, value)).rejects.toThrow()
    if (kind === 'rename') await expect(fsops.planFsOp(f.host, prepared, 'folder/')).rejects.toThrow()
  }
})

test('directory moves to a sibling parent work while changed captured parent and stat aliases refuse', async () => {
  const f = fixture()
  const directory = await fsops.prepareFsOp(f.host, f.root, { kind: 'move', source: 'src' })
  expect(await fsops.planFsOp(f.host, directory, 'other/moved')).toMatchObject({ destination: 'other/moved' })
  const prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'rename', source: 'src/file.txt' })
  const stat = f.host.stat
  f.host.stat = async path => path === `${f.root}/src/alias` ? { kind: 'file', size: 4, realPath: `${f.root}/keep.txt` } : stat(path)
  await expect(fsops.planFsOp(f.host, prepared, 'alias')).rejects.toThrow()
  f.host.stat = stat; f.nodes.get(`${f.root}/src`)!.realPath = `${f.root}/other`
  await expect(fsops.planFsOp(f.host, prepared, 'new')).rejects.toThrow()
})

for (const platform of ['linux', 'darwin', 'win32'] as const) test(`${platform} refuses raw traversal, absolute/root/unknown/source links and every existing target kind`, async () => {
  const f = fixture(platform)
  for (const source of ['', '.', '..', 'src/..', '/outside', 'src//file.txt', 'src\\file.txt']) await expect(fsops.prepareFsOp(f.host, f.root, { kind: 'delete', source })).rejects.toThrow()
  const prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'move', source: 'src/file.txt' })
  for (const value of ['', ' ', '.', '..', '../sibling', 'src/../name', '/name', '//server/share', '\\server\share', 'src\\name', 'src//name', 'src/']) await expect(fsops.planFsOp(f.host, prepared!, value)).rejects.toThrow()
  for (const [name, kind] of [['taken', 'file'], ['folder', 'dir'], ['dangling', 'other']] as const) {
    f.add(name, kind)
    await expect(fsops.planFsOp(f.host, prepared!, name)).rejects.toThrow()
  }
  f.links.add(`${f.root}/src/file.txt`)
  await expect(fsops.prepareFsOp(f.host, f.root, { kind: 'delete', source: 'src/file.txt' })).rejects.toThrow()
  f.links.clear(); f.nodes.delete(`${f.root}/src/file.txt`)
  await expect(fsops.prepareFsOp(f.host, f.root, { kind: 'delete', source: 'src/file.txt' })).rejects.toThrow()
})

test('Windows rejects ADS, device aliases, drive-relative and trailing-dot/space components before metadata reads', async () => {
  const f = fixture('win32'), prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'move', source: 'src/file.txt' })
  for (const value of ['C:x', 'C:/x', 'C:', 'a:b', 'CON', 'con.txt', 'CON .txt', 'COM¹.txt', 'lpt9', 'CONIN$', 'conout$.txt', 'other./x', 'other /x', '.. /x', 'name.', 'name ', 'x?y', 'x*y', 'x|y', 'x"y', 'x\0y']) {
    f.calls.length = 0
    await expect(fsops.planFsOp(f.host, prepared!, value)).rejects.toThrow()
    expect(f.calls).toEqual([])
  }
  f.add('TAKEN')
  await expect(fsops.planFsOp(f.host, prepared!, 'taken')).rejects.toThrow()
})

test('POSIX colon and option-like names stay literal', async () => {
  const f = fixture(), prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'new', source: '' })
  expect(await fsops.planFsOp(f.host, prepared!, 'C:name')).toMatchObject({ destination: 'C:name' })
  expect(await fsops.planFsOp(f.host, prepared!, '-name')).toMatchObject({ destination: '-name' })
})

test('request property order does not change captured evidence', async () => {
  const f = fixture(), prepared = await fsops.prepareFsOp(f.host, f.root, { source: '', kind: 'new' })
  expect(await fsops.planFsOp(f.host, prepared, 'new')).toMatchObject({ destination: 'new' })
})

test('POSIX control characters cannot create names the native listing and confirmation cannot display', async () => {
  const f = fixture(), prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'new', source: '' })
  for (const value of ['line\nname', 'tab\tname', 'escape\x1bname']) await expect(fsops.planFsOp(f.host, prepared, value)).rejects.toThrow()
})

for (const platform of ['linux', 'win32'] as const) test(`${platform} refuses relative or malformed canonical source/parent evidence`, async () => {
  for (const real of ['relative', './src', '../src', platform === 'win32' ? 'C:src' : '/acme-app/src/../src']) {
    const f = fixture(platform)
    f.nodes.get(`${f.root}/src/file.txt`)!.realPath = real
    await expect(fsops.prepareFsOp(f.host, f.root, { kind: 'delete', source: 'src/file.txt' })).rejects.toThrow()
    f.add('src/file.txt'); f.nodes.get(`${f.root}/src`)!.realPath = real
    await expect(fsops.prepareFsOp(f.host, f.root, { kind: 'new', source: 'src/file.txt' })).rejects.toThrow()
  }
})

test('canonical root aliases, escaped parent chains, descendant moves and changed evidence fail closed', async () => {
  const f = fixture()
  f.add('alias', 'dir', f.root)
  await expect(fsops.prepareFsOp(f.host, f.root, { kind: 'delete', source: 'alias' })).rejects.toThrow()
  f.add('escape', 'dir', '/outside'); f.add('escape/back', 'dir', `${f.root}/other`)
  await expect(fsops.prepareFsOp(f.host, f.root, { kind: 'new', source: 'escape/back' })).rejects.toThrow()
  const dir = await fsops.prepareFsOp(f.host, f.root, { kind: 'move', source: 'src' })
  await expect(fsops.planFsOp(f.host, dir!, 'src/sub/moved')).rejects.toThrow()
  f.add('alias', 'dir', `${f.root}/src/sub`)
  await expect(fsops.planFsOp(f.host, dir!, 'alias/moved')).rejects.toThrow()
  const file = await fsops.prepareFsOp(f.host, f.root, { kind: 'delete', source: 'src/file.txt' })
  f.add('src/file.txt', 'dir')
  await expect(fsops.planFsOp(f.host, file!)).rejects.toThrow()
  f.add('src/file.txt'); f.nodes.get(f.root)!.realPath = '/different-root'
  await expect(fsops.planFsOp(f.host, file!)).rejects.toThrow()
})

test('root opened through a link is anchored to its verified canonical root; failed metadata/listing refuses', async () => {
  const f = fixture()
  for (const node of f.nodes.values()) node.realPath = node.realPath.replace('/acme-app', '/real-app')
  const prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'new', source: 'src' })
  expect(await fsops.planFsOp(f.host, prepared!, 'new')).toMatchObject({ realRoot: '/real-app', destination: 'src/new' })
  const stat = f.host.stat; f.host.stat = async p => p === `${f.root}/src` ? null : stat(p)
  await expect(fsops.planFsOp(f.host, prepared!, 'new')).rejects.toThrow()
  f.host.stat = stat; f.host.list = async () => { throw new Error('Denied.') }
  await expect(fsops.planFsOp(f.host, prepared!, 'new')).rejects.toThrow()
})

for (const platform of ['linux', 'darwin', 'win32'] as const) test(`${platform} argv contains literal operands and fixed program source only`, async () => {
  const f = fixture(platform), name = " spaced [x] ' $;é"
  for (const [kind, value] of [['new', `${name}/`], ['rename', name], ['move', `other/${name}`], ['delete', undefined]] as const) {
    const prepared = await fsops.prepareFsOp(f.host, f.root, { kind, source: kind === 'new' ? '' : 'src/file.txt' })
    const plan = await fsops.planFsOp(f.host, prepared!, value)
    const command = fsops.fsOpCommand(plan!, platform)
    expect(command).not.toBeNull()
    if (platform === 'win32') {
      expect(command!.argv.slice(0, 5)).toEqual(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command'])
      expect(command!.argv.at(-1)).not.toContain(name)
      expect(command!.argv.at(-1)).toContain('-ErrorAction Stop')
      expect(command!.env).toBeDefined()
      if (kind === 'new') { expect(command!.argv.at(-1)).toContain('New-Item'); expect(command!.argv.at(-1)).not.toContain('-LiteralPath') }
      else expect(command!.argv.at(-1)).toContain('-LiteralPath')
    } else {
      expect(command!.argv).toContain('--')
      expect(command!.argv.at(-1)).toBe(kind === 'delete' ? `${f.root}/src/file.txt` : kind === 'rename' ? `${f.root}/src/${name}` : kind === 'move' ? `${f.root}/other/${name}` : `${f.root}/${name}`)
      if (kind === 'move' || kind === 'rename') expect(command!.argv.slice(0, 3)).toEqual(['mv', '-n', '--'])
    }
  }
})

test('postconditions reject a skipped successful mv and a changed canonical destination', async () => {
  const f = fixture(), prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'move', source: 'src/file.txt' })
  const plan = await fsops.planFsOp(f.host, prepared!, 'other/new.txt')
  await expect(fsops.verifyFsOp(f.host, plan!)).rejects.toThrow()
  f.nodes.delete(`${f.root}/src/file.txt`); f.add('other/new.txt')
  expect(await fsops.verifyFsOp(f.host, plan!)).toBe('other/new.txt')
  f.nodes.get(`${f.root}/other/new.txt`)!.realPath = `${f.root}/src/new.txt`
  await expect(fsops.verifyFsOp(f.host, plan!)).rejects.toThrow()
})

test('verified result uses actual canonical parent casing and paths for selection', async () => {
  const f = fixture('win32'), stat = f.host.stat, list = f.host.list
  const actual = (path: string) => path.replace(/\/SRC(?=\/|$)/g, '/src').replace(/\/alias(?=\/|$)/g, '/src')
  f.host.stat = path => stat(actual(path)); f.host.list = path => list(actual(path))
  const prepared = await fsops.prepareFsOp(f.host, f.root, { kind: 'move', source: 'src/file.txt' })
  const plan = await fsops.planFsOp(f.host, prepared, 'SRC/renamed.txt')
  f.nodes.delete(`${f.root}/src/file.txt`); f.add('src/renamed.txt')
  expect(await fsops.verifyFsOp(f.host, plan)).toBe('src/renamed.txt')
  f.add('alias', 'dir', `${f.root}/src`)
  const deletion = await fsops.planFsOp(f.host, await fsops.prepareFsOp(f.host, f.root, { kind: 'delete', source: 'alias/renamed.txt' }))
  f.nodes.delete(`${f.root}/src/renamed.txt`)
  expect(await fsops.verifyFsOp(f.host, deletion)).toBe('src')
})
