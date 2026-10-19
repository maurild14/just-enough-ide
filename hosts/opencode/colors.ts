import type { Plugin } from '@opencode/plugin/tui'

// Closest resolved theme accents: info (read), warning (write), success (git).
export const ACTIVITY_COLORS = { read: 'info', write: 'warning', git: 'success' } as const

export const activityColor = (ctx: Plugin.Context, kind: keyof typeof ACTIVITY_COLORS) => ctx.theme.text.feedback[ACTIVITY_COLORS[kind]].base
