import type { EngineInterface } from 'claude-code'
import type { DirEntry, FileStat, Host, Platform, RunOptions, RunResult } from '../../core/host.ts'

function bytesOf(base64: string, maxBytes: number): Uint8Array {
  const raw = atob(base64)
  const n = Math.min(raw.length, Math.max(0, maxBytes))
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** The core Host over the engine's `$`: processes, files and the session's model. */
export function claudeHost($: EngineInterface, platform: Platform): Host {
  return {
    platform,

    async run(argv: readonly string[], options: RunOptions = {}): Promise<RunResult> {
      // $.process.run takes no signal: an aborted call never starts.
      if (options.signal?.aborted) throw new Error('aborted')
      const init: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number } = {}
      if (options.cwd !== undefined) init.cwd = options.cwd
      if (options.env !== undefined) init.env = options.env
      if (options.stdin !== undefined) init.stdin = options.stdin
      if (options.timeoutMs !== undefined) init.timeoutMs = options.timeoutMs
      const r = await $.process.run(argv, init)
      // A cut stdout would parse as a short list; fail loudly instead.
      if (r.isStdoutTruncated) throw new Error(`Output too large: ${argv.slice(0, 3).join(' ')}`)
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr }
    },

    async list(dir: string): Promise<DirEntry[]> {
      const entries = await $.fs.list(dir)
      return entries.map((e) => ({ name: e.name, kind: e.kind, size: e.size }))
    },

    async stat(path: string): Promise<FileStat | null> {
      try {
        const s = await $.fs.stat(path, { resolve: true })
        // No realPath means the engine could not (or would not) resolve it: fail closed.
        if (s.realPath === undefined) return null
        return { kind: s.kind, size: s.size, realPath: s.realPath }
      } catch {
        return null
      }
    },

    async readHead(path: string, maxBytes: number): Promise<Uint8Array | null> {
      try {
        const { base64 } = await $.fs.read(path, { as: 'bytes' })
        return bytesOf(base64, maxBytes)
      } catch {
        return null
      }
    },

    async readText(path: string): Promise<string | null> {
      try {
        return await $.fs.read(path)
      } catch {
        return null
      }
    },

    async complete(prompt: string, model: string): Promise<string> {
      const r = await $.model.complete({ model: model || 'haiku', prompt, timeoutMs: 30_000 })
      if (!r.isAnswered) throw new Error(`The model gave no answer (${r.reason}).`)
      return r.text
    },
  }
}
