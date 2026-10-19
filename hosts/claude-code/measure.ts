// Test helper for the kit tests (imported only by *.test.tsx). The kit never
// paints, so widths are measured on the returned tree the way the terminal
// lays it out.
import { cellWidth } from '../../core/shared/fit.ts'

export type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] } | string

export function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (node && typeof node === 'object' && 'children' in node) {
    return ((node as { children?: unknown[] }).children ?? []).map(textOf).join('')
  }
  return ''
}

/**
 * Display width of each terminal line the tree draws: a column Box stacks its
 * children, a row Box joins them with its `gap`, a Button is `[ label ]`, a
 * plain Button `k: label` with a hotkey or the label alone without one. Code,
 * Markdown and Image report their declared or longest line.
 */
export function lineWidths(node: Node): number[] {
  if (typeof node === 'string') return [cellWidth(node)]
  const kids = (node.children ?? []) as Node[]
  const props = node.props ?? {}
  if (node.type === 'Text') return [cellWidth(textOf(node))]
  if (node.type === 'Button') {
    const label = textOf(node) || String(props.label ?? '')
    if (props.plain !== true) return [cellWidth(label) + 4]
    const hot = typeof props.hotkey === 'string' ? cellWidth(props.hotkey) + 2 : 0
    return [cellWidth(label) + hot]
  }
  if (node.type === 'Code') return String(props.source ?? '').split('\n').map(() => 0)
  if (node.type === 'Markdown') return [0]
  if (node.type === 'Image') return [Number(props.columns ?? 0)]
  if (node.type === 'Input') return [0]
  if (node.type === 'Box') {
    if (props.flexDirection === 'row') {
      const gap = Number(props.gap ?? 0)
      const parts = kids.map((k) => Math.max(0, ...lineWidths(k)))
      return [parts.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1)]
    }
    return kids.flatMap(lineWidths)
  }
  return []
}
