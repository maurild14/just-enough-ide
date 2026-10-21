import type { Plugin } from '@opencode/plugin/tui'
import { RGBA } from '@opentui/core'
import type { GraphSpan } from '../../core/git/graph.ts'

// Semantic activity hues keep their meaning even when a theme's info token is blue.
const ACTIVITY_COLORS = {
  dark: { read: '#c084fc', write: '#fb923c', git: '#4ade80' },
  light: { read: '#7e22ce', write: '#c2410c', git: '#15803d' },
} as const

export const activityColor = (ctx: Plugin.Context, kind: 'read' | 'write' | 'git') => RGBA.fromHex(ACTIVITY_COLORS[ctx.themeMode === 'light' ? 'light' : 'dark'][kind])

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
