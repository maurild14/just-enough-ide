import type { Plugin } from '@opencode/plugin/tui'
import { RGBA } from '@opentui/core'
import type { GraphSpan } from '../../core/git/graph.ts'
import { shimmerColor } from '../../core/activity/shimmer.ts'

export const activityColor = (ctx: Plugin.Context, kind: 'read' | 'write' | 'git', strength = 0) => RGBA.fromHex(shimmerColor(kind, ctx.themeMode === 'light' ? 'light' : 'dark', strength))

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
