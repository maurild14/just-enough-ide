// Specs only. A Host over a real temp directory and real git. Never imported by non-spec code.
import { setDefaultTimeout } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DirEntry, FileStat, Host, Platform, RunOptions, RunResult, Stream } from '../core/host.ts'

// A real-git spec spawns 20 to 40 git processes. Under load (three OSes in CI, or both test suites at
// once) that outlasts bun's 5 s default; a timed-out spec then keeps running after `cleanup` deleted its
// repos and fails the next one with a `.git/FETCH_HEAD` or `git exited with 1` error. Every spec that
// imports the fake host gets a budget that fits.
setDefaultTimeout(60_000)
const STREAM_CAP = 8 * 1024 * 1024

// An empty global config keeps the developer's own git settings out of the specs
// (the null device path is not accepted by git on Windows).
let configDir: string | null = null
function emptyConfig(): string {
  if (configDir === null) {
    configDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'jei-cfg-')))
    writeFileSync(join(configDir, 'gitconfig'), '')
  }
  return join(configDir, 'gitconfig')
}
function dropConfig(): void {
  if (configDir !== null) rmSync(configDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  configDir = null
}
process.on('exit', dropConfig)

/** The ambient environment without any GIT_* variable, so specs never see the developer's git setup. */
function cleanEnv(): Record<string, string> {
  return Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !k.toUpperCase().startsWith('GIT_') && v !== undefined)) as Record<string, string>
}

export class FakeHost implements Host {
  readonly platform: Platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
  /** Scripted answer for `complete`; `prompts` records what was asked. */
  completeReply = ''
  readonly prompts: { prompt: string; model: string }[] = []
  readonly calls: string[][] = []

  stream(argv: readonly string[], options: RunOptions = {}): Stream {
    this.calls.push([...argv])
    const [command, ...args] = argv
    if (!command) throw new Error('empty argv')
    if (options.signal?.aborted) throw new Error('aborted')
    const child = spawn(command, args, { cwd: options.cwd,
      env: { ...cleanEnv(), GIT_CONFIG_GLOBAL: emptyConfig(), GIT_CONFIG_NOSYSTEM: '1', ...options.env },
      shell: false, windowsHide: true, signal: options.signal, timeout: options.timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    let stderr = ''
    let closed = false
    let failure: Error | undefined
    child.stderr.on('data', (text: string) => {
      if (stderr.length + text.length > STREAM_CAP) { failure ??= new Error('Process stderr exceeds 8 MiB.'); child.kill() }
      else stderr += text
    })
    const done = new Promise<{ exitCode: number; stderr: string }>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => { closed = true; if (failure) reject(failure); else resolve({ exitCode: code ?? 1, stderr }) })
    })
    void done.catch(() => {})
    child.stdin.on('error', () => {})
    child.stdin.end(options.stdin ?? '')
    const cancel = () => { if (!closed) child.kill() }
    const lines = (async function* () {
      let pending = ''
      try {
        for await (const chunk of child.stdout) {
          const parts = String(chunk).split('\n')
          for (let i = 0; i < parts.length; i++) {
            if (pending.length + parts[i]!.length > STREAM_CAP) throw new Error('Process output line exceeds 8 MiB.')
            pending += parts[i]!
            if (i < parts.length - 1) { yield pending; pending = '' }
          }
        }
        if (pending) yield pending
        await done
      } catch (error) { failure ??= error instanceof Error ? error : new Error(String(error)); cancel(); await done; throw error }
      finally { cancel() }
    })()
    return { lines, done, cancel }
  }

  async writeText(path: string, text: string): Promise<void> { await writeFile(path, text, 'utf8') }

  run(argv: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    this.calls.push([...argv])
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = argv
      if (cmd === undefined) return reject(new Error('empty argv'))
      const child = spawn(cmd, args, {
        shell: false,
        cwd: options.cwd,
        env: {
          ...cleanEnv(),
          GIT_CONFIG_GLOBAL: emptyConfig(),
          GIT_CONFIG_NOSYSTEM: '1',
          ...options.env,
        },
        windowsHide: true,
        signal: options.signal,
        timeout: options.timeoutMs,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const out: Buffer[] = []
      const err: Buffer[] = []
      child.stdout.on('data', (b: Buffer) => out.push(b))
      child.stderr.on('data', (b: Buffer) => err.push(b))
      child.on('error', reject)
      child.on('close', (code) =>
        resolve({ exitCode: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }),
      )
      child.stdin.on('error', () => {})
      child.stdin.end(options.stdin ?? '')
    })
  }

  async list(dir: string): Promise<DirEntry[]> {
    return readdirSync(dir, { withFileTypes: true }).map((d) => {
      const kind = d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other'
      let size = 0
      if (kind === 'file') {
        try {
          size = statSync(join(dir, d.name)).size
        } catch {}
      }
      return { name: d.name, kind, size }
    })
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const s = statSync(path)
      return { kind: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other', size: s.size, realPath: realpathSync.native(path) }
    } catch {
      return null
    }
  }

  async readHead(path: string, maxBytes: number): Promise<Uint8Array | null> {
    try {
      const fh = await open(path, 'r')
      try {
        const buf = new Uint8Array(maxBytes)
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0)
        return buf.subarray(0, bytesRead)
      } finally {
        await fh.close()
      }
    } catch {
      return null
    }
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8')
    } catch {
      return null
    }
  }

  async complete(prompt: string, model: string): Promise<string> {
    this.prompts.push({ prompt, model })
    return this.completeReply
  }
}

const made: string[] = []

/** Removes every temp directory created by `makeTemp` and `makeRepo`. Call from `afterEach`. */
export function cleanup(): void {
  dropConfig()
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

export type TempRepo = {
  host: FakeHost
  /** Absolute path of the working tree, `<tmp>/acme-app`. */
  dir: string
  /** Runs real git in `dir` (or `cwd`) and returns trimmed stdout; throws on failure. */
  git(...args: string[]): Promise<string>
  write(rel: string, text: string): void
}

/** A fresh temp directory (resolved to its real path) with a child folder `name`. */
export function makeTemp(name = 'acme-app'): string {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'jei-')))
  made.push(base)
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, text)
  }
}

export async function gitIn(host: FakeHost, dir: string, ...args: string[]): Promise<string> {
  const r = await host.run(['git', '-C', dir, ...args])
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

export async function configure(host: FakeHost, dir: string, author: { name: string; email: string } = { name: 'Ana Rivera', email: 'ana@example.com' }): Promise<void> {
  await gitIn(host, dir, 'config', 'user.name', author.name)
  await gitIn(host, dir, 'config', 'user.email', author.email)
  await gitIn(host, dir, 'config', 'commit.gpgsign', 'false')
  await gitIn(host, dir, 'config', 'core.autocrlf', 'false')
}

/**
 * A temp `acme-app` repo on `main`, identity Ana Rivera. `files` are written; when `commits` > 0 the
 * first commit holds them and each further commit is empty. `commits: 0` leaves them uncommitted.
 */
export async function makeRepo(files: Record<string, string> = {}, commits = 1): Promise<TempRepo> {
  const host = new FakeHost()
  const dir = makeTemp()
  await gitIn(host, dir, '-c', 'init.defaultBranch=main', 'init')
  await configure(host, dir)
  writeFiles(dir, files)
  for (let i = 0; i < commits; i++) {
    if (i === 0) await gitIn(host, dir, 'add', '-A')
    await gitIn(host, dir, 'commit', '--allow-empty', '-m', i === 0 ? 'chore: initial commit' : `chore: commit ${i + 1}`)
  }
  return { host, dir, git: (...args) => gitIn(host, dir, ...args), write: (rel, text) => writeFiles(dir, { [rel]: text }) }
}
