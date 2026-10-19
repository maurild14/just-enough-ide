import type { Tab } from './keys.ts'

export type Options = {
  startOpen: boolean
  defaultTab: Tab
  activity: 'reads and writes' | 'writes' | 'reads' | 'none'
  followAgent: boolean
  glyphs: 'auto' | 'nerd' | 'plain'
  editorCommand: string
  commitModel: string
  smartCommit: boolean
  graphLimit: number
}

const TABS: readonly Tab[] = ['files', 'search', 'symbols', 'git']
const ACTIVITIES: readonly Options['activity'][] = ['reads and writes', 'writes', 'reads', 'none']
const GLYPHS: readonly Options['glyphs'][] = ['auto', 'nerd', 'plain']

const DEFAULTS: Options = {
  startOpen: true,
  defaultTab: 'files',
  activity: 'reads and writes',
  followAgent: true,
  glyphs: 'auto',
  editorCommand: '',
  commitModel: '',
  smartCommit: true,
  graphLimit: 200,
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'on' || v === 'true') return true
    if (v === 'off' || v === 'false') return false
  }
  return fallback
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback
}

/** Parse Claude Code userConfig strings and OpenCode plugin options into one shape. */
export function parseOptions(raw: Record<string, unknown>): Options {
  return {
    startOpen: bool(raw.startOpen, DEFAULTS.startOpen),
    defaultTab: oneOf(raw.defaultTab, TABS, DEFAULTS.defaultTab),
    activity: oneOf(raw.activity, ACTIVITIES, DEFAULTS.activity),
    followAgent: bool(raw.followAgent, DEFAULTS.followAgent),
    glyphs: oneOf(raw.glyphs, GLYPHS, DEFAULTS.glyphs),
    editorCommand: text(raw.editorCommand),
    commitModel: text(raw.commitModel),
    smartCommit: bool(raw.smartCommit, DEFAULTS.smartCommit),
    graphLimit: positiveInt(raw.graphLimit, DEFAULTS.graphLimit),
  }
}
