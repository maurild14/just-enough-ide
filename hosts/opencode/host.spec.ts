import { afterEach, expect, spyOn, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { join } from 'node:path'
import { cleanup, makeTemp, writeFiles } from '../../test/fake-host.ts'
import { nodeHost } from './host.ts'

afterEach(cleanup)

test('run executes git without a shell or visible Windows window', async () => {
  const spawn = spyOn(childProcess, 'spawn')
  try {
    const result = await nodeHost(async () => '').run(['git', '--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toMatch(/^git version /)
    expect(spawn).toHaveBeenCalledWith('git', ['--version'], expect.objectContaining({ shell: false, windowsHide: true }))
  } finally {
    spawn.mockRestore()
  }
})

test('files report real paths, kinds and sizes and read only the requested bytes', async () => {
  const root = makeTemp()
  writeFiles(root, { 'a.txt': 'abc', 'src/b.txt': 'hello' })
  const host = nodeHost(async () => '')
  const path = join(root, 'a.txt')
  expect(await host.readHead(path, 100)).toEqual(new Uint8Array([97, 98, 99]))
  expect(await host.readHead(path, 2)).toEqual(new Uint8Array([97, 98]))
  expect(await host.readHead(path, 0)).toEqual(new Uint8Array())
  expect(await host.readText(path)).toBe('abc')
  expect(await host.stat(path)).toEqual({ kind: 'file', size: 3, realPath: path })
  expect((await host.stat(root))?.kind).toBe('dir')
  expect((await host.list(root)).sort((a, b) => a.name.localeCompare(b.name))).toEqual([
    { name: 'a.txt', kind: 'file', size: 3 }, { name: 'src', kind: 'dir', size: 0 },
  ])
  expect(await host.stat(join(root, 'missing'))).toBeNull()
  expect(await host.readHead(join(root, 'missing'), 10)).toBeNull()
  expect(await host.readText(join(root, 'missing'))).toBeNull()
  await expect(host.list(join(root, 'missing'))).rejects.toThrow()
})

test('run carries cwd, env, stdin, stderr and a nonzero exit without interpreting shell words', async () => {
  const root = makeTemp()
  const host = nodeHost(async (prompt, model) => `${model}: ${prompt}`)
  const script = "process.stdin.on('data', b => process.stdout.write(b)); process.stdin.on('end', () => { process.stdout.write('|' + process.env.JEI_TEST + '|' + process.cwd()); process.stderr.write('failed'); process.exitCode = 7 })"
  const result = await host.run([process.execPath, '-e', script], { cwd: root, env: { JEI_TEST: 'ok' }, stdin: '$(whoami); & echo literal' })
  expect(result).toEqual({ exitCode: 7, stdout: `$(whoami); & echo literal|ok|${root}`, stderr: 'failed' })
  expect(await host.complete('diff', 'small')).toBe('small: diff')
  expect(process.platform).toBe(host.platform)
})

test('run rejects empty argv and missing executables, and stops timed out children', async () => {
  const host = nodeHost(async () => '')
  await expect(host.run([])).rejects.toThrow('empty argv')
  await expect(host.run(['jei-missing-executable'])).rejects.toThrow()
  expect((await host.run([process.execPath, '-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 100 })).exitCode).not.toBe(0)
})

test('an already cancelled run never starts a process', async () => {
  const spawn = spyOn(childProcess, 'spawn')
  const controller = new AbortController()
  controller.abort()
  try {
    await expect(nodeHost(async () => '').run([process.execPath, '-e', ''], { signal: controller.signal })).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    spawn.mockRestore()
  }
})
