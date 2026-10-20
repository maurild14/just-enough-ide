export type Candidate = { hash: string; time: number }
export type ReflogEntry = { hash: string; action: string; identity: string }
export type ReflogBoundary = { entry: string | null }

export function parseReflog(stdout: string): ReflogEntry[] | null {
  if (stdout === '') return []
  const fields = stdout.split('\0')
  if (fields.pop() !== '' || fields.length % 3 !== 0) return null
  const entries: ReflogEntry[] = []
  for (let i = 0; i < fields.length; i += 3) {
    const [hash, selector, action] = fields.slice(i, i + 3) as [string, string, string]
    if (!/^[0-9a-f]{40}$/.test(hash) || !/^HEAD@\{\d+ [+-]\d{4}\}$/.test(selector) || !action) return null
    entries.push({ hash, action, identity: `${hash}\0${selector}\0${action}` })
  }
  return entries
}

export function creationAction(action: string): boolean {
  return /^(commit(?: \((?:initial|amend)\))?|revert|cherry-pick|rebase \((?:pick|reword|squash|fixup|continue)\)): /.test(action)
}

export class AgentCommits {
  private head: string | null = null
  private sequence = 0
  private windows = new Map<number, { time: number; valid: boolean }>()
  private hashes = new Set<string>()

  toolStart(head: string | null, now: number): number {
    const overlap = this.windows.size > 0
    if (overlap) this.invalidate()
    const token = ++this.sequence
    this.windows.set(token, { time: now, valid: !overlap && Number.isFinite(now) })
    this.observe(head)
    return token
  }

  toolEnd(token: number, head: string | null, candidates: readonly Candidate[]): void {
    const window = this.windows.get(token)
    if (!window) return
    this.windows.delete(token)
    if (window.valid) {
      for (const candidate of candidates) {
        if (candidate.time >= window.time - 2 && Number.isFinite(candidate.time)) this.add(candidate.hash)
      }
    }
    this.observe(head)
  }

  invalidate(): void {
    for (const window of this.windows.values()) window.valid = false
  }

  observe(head: string | null): void { this.head = head }
  lastHead(): string | null { return this.head }
  has(hash: string): boolean { return this.hashes.has(hash) }
  toJSON(): string[] { return [...this.hashes] }

  private add(hash: string): void {
    if (!/^[0-9a-f]{40}$/.test(hash)) return
    this.hashes.add(hash)
    if (this.hashes.size > 1000) this.hashes.delete(this.hashes.values().next().value!)
  }

  static from(hashes: readonly string[]): AgentCommits {
    const tracker = new AgentCommits()
    for (const hash of hashes) tracker.add(hash)
    return tracker
  }
}
