// Specs only. A Host over a real temp directory and real git. Never imported by non-spec code.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { DirEntry, FileStat, Host, Platform, RunOptions, RunResult } from '../core/host.ts'

// An empty global config keeps the developer's own git settings out of the specs
// (the null device path is not accepted by git on Windows).
const EMPTY_CONFIG = join(tmpdir(), 'jei-empty-gitconfig')
writeFileSync(EMPTY_CONFIG, '')

export class FakeHost implements Host {
  readonly platform: Platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux'
  /** Scripted answer for `complete`; `prompts` records what was asked. */
  completeReply = ''
  readonly prompts: { prompt: string; model: string }[] = []
  readonly calls: string[][] = []

  run(argv: readonly string[], options: RunOptions = {}): Promise<RunResult> {
    this.calls.push([...argv])
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = argv
      if (cmd === undefined) return reject(new Error('empty argv'))
      const child = spawn(cmd, args, {
        cwd: options.cwd,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: EMPTY_CONFIG,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_MERGE_AUTOEDIT: 'no',
          GIT_TERMINAL_PROMPT: '0',
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
