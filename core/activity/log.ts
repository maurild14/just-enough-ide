import type { Options } from '../options.ts'
import type { ActivityKind } from './classify.ts'

export const GLOW_MS = 2000

type Row = { kind: ActivityKind; at: number }

/** Per-session record of what the agent touched. The clock is always injected. */
export class ActivityLog {
  private rows = new Map<string, Row>()

  touch(rel: string, kind: ActivityKind, now: number): void {
    this.rows.set(rel, { kind, at: now })
  }

  /** 1 at the touch, falling linearly to 0 over GLOW_MS. */
  glow(rel: string, now: number): number {
    const row = this.rows.get(rel)
    if (!row) return 0
    return Math.min(1, Math.max(0, 1 - (now - row.at) / GLOW_MS))
  }

  kindOf(rel: string): ActivityKind | null {
    return this.rows.get(rel)?.kind ?? null
  }

  touched(rel: string): boolean {
    return this.rows.has(rel)
  }

  isGlowing(now: number): boolean {
    for (const rel of this.rows.keys()) if (this.glow(rel, now) > 0) return true
    return false
  }

  toJSON(): Record<string, Row> {
    const out: Record<string, Row> = {}
    for (const [rel, row] of this.rows) out[rel] = { kind: row.kind, at: row.at }
    return out
  }

  static from(json: Record<string, Row>): ActivityLog {
    const log = new ActivityLog()
    for (const [rel, row] of Object.entries(json)) log.touch(rel, row.kind, row.at)
    return log
  }
}

/** Whether the `activity` option lets this kind of touch show. Git shows unless 'none'. */
export function allows(setting: Options['activity'], kind: ActivityKind): boolean {
  if (setting === 'none') return false
  if (kind === 'git' || setting === 'reads and writes') return true
  return setting === 'writes' ? kind === 'write' : kind === 'read'
}
