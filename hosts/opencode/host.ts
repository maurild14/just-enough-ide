import { spawn } from 'node:child_process'
import { open, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Host } from '../../core/host.ts'

/** Processes and files stay on the server, next to the project. */
export function nodeHost(generate: (prompt: string, model: string) => Promise<string>): Host {
  return {
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',

    run(argv, options = {}) {
      return new Promise((resolve, reject) => {
        const [command, ...args] = argv
        if (!command) return reject(new Error('empty argv'))
        if (options.signal?.aborted) return reject(new Error('aborted'))
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          shell: false,
          windowsHide: true,
          signal: options.signal,
          timeout: options.timeoutMs,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        child.on('error', reject)
        child.on('close', (code) => resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        }))
        // A command may close stdin before consuming it (EPIPE).
        child.stdin.on('error', () => {})
        child.stdin.end(options.stdin ?? '')
      })
    },

    async list(dir) {
      const entries = await readdir(dir, { withFileTypes: true })
      return Promise.all(entries.map(async (entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' as const : entry.isFile() ? 'file' as const : 'other' as const,
        size: entry.isFile() ? await stat(join(dir, entry.name)).then((s) => s.size, () => 0) : 0,
      })))
    },

    async stat(path) {
      try {
        const [info, realPath] = await Promise.all([stat(path), realpath(path)])
        return { kind: info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'other', size: info.size, realPath }
      } catch {
        return null
      }
    },

    async readHead(path, maxBytes) {
      try {
        const file = await open(path, 'r')
        try {
          const bytes = new Uint8Array(maxBytes)
          const { bytesRead } = await file.read(bytes, 0, maxBytes, 0)
          return bytes.subarray(0, bytesRead)
        } finally {
          await file.close()
        }
      } catch {
        return null
      }
    },

    async readText(path) {
      try {
        return await readFile(path, 'utf8')
      } catch {
        return null
      }
    },

    complete: generate,
  }
}
