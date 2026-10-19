export type Platform = 'win32' | 'darwin' | 'linux'

export type RunOptions = {
  cwd?: string
  env?: Record<string, string>
  stdin?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export type RunResult = { exitCode: number; stdout: string; stderr: string }

export type DirEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number }

export type FileStat = { kind: 'file' | 'dir' | 'other'; size: number; realPath: string }

/**
 * The process, file and model half of a host. UI actions (toast, confirm,
 * hand text to the agent) stay in each adapter.
 */
export interface Host {
  readonly platform: Platform
  run(argv: readonly string[], options?: RunOptions): Promise<RunResult>
  list(dir: string): Promise<DirEntry[]>
  stat(path: string): Promise<FileStat | null>
  readHead(path: string, maxBytes: number): Promise<Uint8Array | null>
  readText(path: string): Promise<string | null>
  complete(prompt: string, model: string): Promise<string>
}
