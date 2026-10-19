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
  // A Select shows its label and the current option; sized here for its widest option plus a marker.
  if (node.type === 'Select') {
    const opts = (props.options as { value: string; label?: string }[] | undefined) ?? []
    const label = typeof props.label === 'string' ? cellWidth(props.label) + 1 : 0
    return [label + Math.max(0, ...opts.map((o) => cellWidth(o.label ?? o.value))) + 2]
  }
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

/**
 * The one line a row tree draws, as the terminal paints it: a Button is
 * `[ label ]`, a plain Button `k: label` with a hotkey (`k: ` with an empty
 * label) or the label alone without one; a row Box joins its children with
 * its `gap`.
 */
export function drawnLine(node: Node): string {
  if (typeof node === 'string') return node
  const kids = (node.children ?? []) as Node[]
  const props = node.props ?? {}
  if (node.type === 'Text') return textOf(node)
  if (node.type === 'Button') {
    const label = textOf(node) || String(props.label ?? '')
    if (props.plain !== true) return `[ ${label} ]`
    return typeof props.hotkey === 'string' ? `${props.hotkey}: ${label}` : label
  }
  // A Select shows its label, the current option and its marker.
  if (node.type === 'Select') {
    const opts = (props.options as { value: string; label?: string }[] | undefined) ?? []
    const cur = opts.find((o) => o.value === props.value) ?? opts[0]
    return `${typeof props.label === 'string' ? `${props.label} ` : ''}${cur?.label ?? cur?.value ?? ''} ▾`
  }
  if (node.type === 'Box') return kids.map(drawnLine).join(' '.repeat(Number(props.gap ?? 0)))
  return ''
}

/** The first element of a drawn tree whose `key` is `key`. */
export function findKey(node: Node, key: string): Node | undefined {
  if (typeof node === 'string') return undefined
  if (node.props?.key === key) return node
  for (const k of (node.children ?? []) as Node[]) {
    const hit = findKey(k, key)
    if (hit) return hit
  }
  return undefined
}
