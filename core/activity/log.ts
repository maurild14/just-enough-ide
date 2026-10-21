import type { Options } from '../options.ts'
import type { ActivityKind } from './classify.ts'

export const GLOW_MS = 2000

type Row = { kind: ActivityKind; at: number; active?: number }

/** Per-session record of what the agent touched. The clock is always injected. */
export class ActivityLog {
  private rows = new Map<string, Row>()

  touch(rel: string, kind: ActivityKind, now: number): void {
    const active = this.rows.get(rel)?.active
    this.rows.set(rel, { kind, at: now, ...(active ? { active } : {}) })
  }

  start(rel: string, kind: ActivityKind, now: number): void {
    const active = (this.rows.get(rel)?.active ?? 0) + 1
    this.rows.set(rel, { kind, at: now, active })
  }

  finish(rel: string, kind: ActivityKind, now: number): void {
    const active = (this.rows.get(rel)?.active ?? 1) - 1
    this.rows.set(rel, { kind, at: now, ...(active > 0 ? { active } : {}) })
  }

  /** 1 at the touch, falling linearly to 0 over GLOW_MS. */
  glow(rel: string, now: number): number {
    const row = this.rows.get(rel)
    if (!row) return 0
    if (row.active) return 1
    return Math.min(1, Math.max(0, 1 - (now - row.at) / GLOW_MS))
  }

  kindOf(rel: string): ActivityKind | null {
    return this.rows.get(rel)?.kind ?? null
  }

  /** Latest eligible touch; folders inherit only currently glowing descendants. */
  forRow(rel: string, directory: boolean, now: number, setting: Options['activity']): { kind: ActivityKind; glow: number; inherited: boolean } | null {
    const own = this.rows.get(rel)
    let path = own && allows(setting, own.kind) ? rel : undefined
    let latest = path === undefined || !this.glow(rel, now) ? -Infinity : own!.at
    if (directory) for (const [child, row] of this.rows) {
      if (child.startsWith(rel + '/') && row.at > latest && allows(setting, row.kind) && this.glow(child, now) > 0) {
        path = child; latest = row.at
      }
    }
    return path === undefined ? null : { kind: this.rows.get(path)!.kind, glow: this.glow(path, now), inherited: path !== rel }
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
    for (const [rel, row] of this.rows) out[rel] = { ...row }
    return out
  }

  static from(json: Record<string, Row>): ActivityLog {
    const log = new ActivityLog()
    for (const [rel, row] of Object.entries(json)) log.rows.set(rel, { ...row })
    return log
  }
}

/** Whether the `activity` option lets this kind of touch show. Git shows unless 'none'. */
export function allows(setting: Options['activity'], kind: ActivityKind): boolean {
  if (setting === 'none') return false
  if (kind === 'git' || setting === 'reads and writes') return true
  return setting === 'writes' ? kind === 'write' : kind === 'read'
}

export type ShimmerPhase = 'bold' | 'color' | 'dim' | 'none'

/**
 * The shimmer step for a glow (1 at the touch, 0 after GLOW_MS), in the
 * 16-color form of docs/design.md section 9: bold activity color for the first
 * 700 ms, the activity color to 1400 ms, the dim activity color to 2000 ms.
 */
export function shimmerPhase(glow: number): ShimmerPhase {
  if (!(glow > 0)) return 'none'
  const elapsed = (1 - Math.min(1, glow)) * GLOW_MS
  if (elapsed < 700 - 1e-6) return 'bold'
  if (elapsed < 1400 - 1e-6) return 'color'
  return 'dim'
}
