import type { EngineInterface } from 'claude-code'
import type { DirEntry, FileStat, Host, Platform, RunOptions, RunResult, Stream } from '../../core/host.ts'

const STREAM_CAP = 8 * 1024 * 1024

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

    stream(argv, options = {}): Stream {
      if (options.signal?.aborted) throw new Error('aborted')
      const source = $.process.spawn({ argv, ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }), ...(options.stdin === undefined ? {} : { input: options.stdin }) })
      const queue: string[] = []
      let queued = 0
      let wake: (() => void) | undefined
      let resume: (() => void) | undefined
      let finished = false
      let cancelled = false
      const cancel = () => {
        if (finished || cancelled) return
        cancelled = true
        resume?.(); resume = undefined
        void source.return({ code: null, signal: 'SIGTERM' }).catch(() => {})
      }
      const timer = options.timeoutMs === undefined ? undefined : $.clock.after(options.timeoutMs, cancel)
      options.signal?.addEventListener('abort', cancel, { once: true })
      const done = (async () => {
        let pending = ''
        let stderr = ''
        try {
          while (!cancelled) {
            const next = await source.next()
            if (next.done) {
              if (pending) queue.push(pending)
              return { exitCode: next.value.code ?? 1, stderr }
            }
            if (next.value.stream === 'stderr') {
              if (stderr.length + next.value.text.length > STREAM_CAP) throw new Error('Process stderr exceeds 8 MiB.')
              stderr += next.value.text; continue
            }
            const parts = next.value.text.split('\n')
            for (let i = 0; i < parts.length; i++) {
              if (pending.length + parts[i]!.length > STREAM_CAP) throw new Error('Process output line exceeds 8 MiB.')
              pending += parts[i]!
              if (i === parts.length - 1) continue
              const line = pending
              queue.push(line); queued += line.length
              pending = ''
              wake?.(); wake = undefined
              if (queued >= 1_048_576 || queue.length >= 64) await new Promise<void>((resolve) => { resume = resolve })
              if (cancelled) break
            }
            wake?.(); wake = undefined
          }
          return { exitCode: 1, stderr }
        } catch (error) { cancel(); throw error }
        finally {
          finished = true
          timer?.cancel()
          options.signal?.removeEventListener('abort', cancel)
          wake?.(); wake = undefined
        }
      })()
      void done.catch(() => {})
      const lines = (async function* () {
        try {
          while (!finished || queue.length) {
            if (queue.length) {
              const line = queue.shift()!
              queued -= line.length
              resume?.(); resume = undefined
              yield line
            }
            else await new Promise<void>((resolve) => { wake = resolve })
          }
          await done
        } finally { cancel() }
      })()
      return { lines, done, cancel }
    },

    async writeText(path, text) { await $.fs.write(path, text) },

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
