import type { Host, RunOptions, RunResult } from '../host.ts'

export const GIT_ENV: Readonly<Record<string, string>> = Object.freeze({ GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1', GIT_MERGE_AUTOEDIT: 'no', GIT_TERMINAL_PROMPT: '0' })

export function gitArgv(root: string, args: readonly string[]): string[] {
  return ['git', '--no-optional-locks', '-C', root, ...args]
}

export class GitError extends Error {
  readonly argv: readonly string[]
  readonly exitCode: number
  readonly stderr: string
  /** First non-empty stderr line, else first non-empty stdout line, else `git exited with <code>`. */
  readonly firstLine: string

  constructor(argv: readonly string[], result: RunResult) {
    const firstLine = firstNonEmptyLine(result.stderr) ?? firstNonEmptyLine(result.stdout) ?? `git exited with ${result.exitCode}`
    super(firstLine)
    this.name = 'GitError'
    this.argv = argv
    this.exitCode = result.exitCode
    this.stderr = result.stderr
    this.firstLine = firstLine
  }
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (t !== '') return t
  }
  return null
}

/** Runs one git command through the host. Throws `GitError` on a non-zero exit. */
export async function git(host: Host, root: string, args: readonly string[], options?: RunOptions): Promise<RunResult> {
  const argv = gitArgv(root, args)
  const result = await host.run(argv, { ...options, env: { ...GIT_ENV, ...options?.env } })
  if (result.exitCode !== 0) throw new GitError(argv, result)
  return result
}
