import { spawn } from 'node:child_process'
import { open, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Host } from '../../core/host.ts'

const STREAM_CAP = 8 * 1024 * 1024

/** Processes and files stay on the server, next to the project. */
export function nodeHost(generate: (prompt: string, model: string) => Promise<string>): Host {
  return {
    platform: process.platform === 'win32' ? 'win32' : process.platform === 'darwin' ? 'darwin' : 'linux',

    stream(argv, options = {}) {
      const [command, ...args] = argv
      if (!command) throw new Error('empty argv')
      if (options.signal?.aborted) throw new Error('aborted')
      const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env },
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
    },

    async writeText(path, text) { await writeFile(path, text, 'utf8') },

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
