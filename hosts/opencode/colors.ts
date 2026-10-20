import type { Plugin } from '@opencode/plugin/tui'
import type { GraphSpan } from '../../core/git/graph.ts'

// Closest resolved theme accents: info (read), warning (write), success (git).
export const ACTIVITY_COLORS = { read: 'info', write: 'warning', git: 'success' } as const

export const activityColor = (ctx: Plugin.Context, kind: keyof typeof ACTIVITY_COLORS) => ctx.theme.text.feedback[ACTIVITY_COLORS[kind]].base

export function graphColor(ctx: Plugin.Context, span: GraphSpan) {
  const theme = ctx.theme.text
  const lanes = [theme.feedback.info.base, theme.feedback.success.base, theme.feedback.warning.base]
  if (span.role === 'lane') return lanes[(span.lane ?? 0) % lanes.length]
  if (span.role === 'head' || span.role === 'agent') return theme.feedback.info.base
  if (span.role === 'local') return theme.feedback.success.base
  if (span.role === 'remote') return theme.feedback.warning.base
  if (span.role === 'tag') return theme.action.primary.base
  return span.role === 'muted' ? theme.muted : theme.base
}
