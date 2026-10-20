import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { diffWindow, reviewText, toUnifiedText, type DiffFile, type DiffLine } from '../../core/git/diff.ts'
import { DIFF_MAX_LINES } from '../../core/git/service.ts'
import type { PaneState } from '../../core/pane.ts'
import { latest } from '../../core/latest.ts'
import { cellWidth, fitEnd, fitPath } from '../../core/shared/fit.ts'
import { insideRel } from '../../core/shared/paths.ts'
import { handToAgent } from './hand-off.ts'
import type { JeiRpc } from './rpc.ts'

type Target = NonNullable<PaneState['diff']>
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid diff reply.')
  return value as Record<string, unknown>
}
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
function readDiff(raw: unknown): { file: DiffFile | null; truncated: boolean } {
  const data = record(raw)
  if (typeof data.truncated !== 'boolean') throw new Error('Invalid diff reply.')
  if (data.file === null) return { file: null, truncated: data.truncated }
  const f = record(data.file)
  if (typeof f.path !== 'string' || f.origPath !== undefined && typeof f.origPath !== 'string' || f.change !== undefined && f.change !== 'new' && f.change !== 'deleted' || typeof f.binary !== 'boolean' || !natural(f.added) || !natural(f.removed) || !Array.isArray(f.hunks)) throw new Error('Invalid diff reply.')
  const hunks = f.hunks.map((raw) => {
    const h = record(raw)
    if (typeof h.header !== 'string' || !Array.isArray(h.lines)) throw new Error('Invalid diff reply.')
    return { header: h.header, lines: h.lines.map((raw): DiffLine => {
      const l = record(raw)
      if (typeof l.kind !== 'string' || !['add', 'del', 'ctx', 'meta'].includes(l.kind) || typeof l.text !== 'string' ||
        l.oldNo !== undefined && (!natural(l.oldNo) || l.oldNo < 1) || l.newNo !== undefined && (!natural(l.newNo) || l.newNo < 1)) throw new Error('Invalid diff reply.')
      return { kind: l.kind as DiffLine['kind'], text: l.text, oldNo: l.oldNo as number | undefined, newNo: l.newNo as number | undefined }
    }) }
  })
  const change = f.change as DiffFile['change']
  return { file: { path: f.path, origPath: f.origPath as string | undefined, binary: f.binary, added: f.added, removed: f.removed, hunks, ...(change ? { change } : {}) }, truncated: data.truncated }
}

export function Diff(props: {
  ctx: Plugin.Context; api: RpcClient<typeof JeiRpc>; sessionID: string; cwd: string; target: Target; revision: number
  width: number; height: number; header: boolean; back: () => void; next: (by: 1 | -1) => void; bind: (run: (action: string) => void) => void
}) {
  const [loaded, setLoaded] = createSignal<ReturnType<typeof readDiff>>()
  const [error, setError] = createSignal('')
  const [position, setPosition] = createSignal({ logical: 0, offset: 0 })
  let stopped = false
  let reviewBusy = false
  const theme = () => props.ctx.theme
  const colors = () => theme().diff?.text
  const cwd = createMemo(() => props.cwd)
  const target = createMemo(() => ({ path: props.target.path, source: props.target.source }), undefined,
    { equals: (a, b) => a.path === b.path && JSON.stringify(a.source) === JSON.stringify(b.source) })
  const load = latest(async (target: Target) => {
    const safe = insideRel(cwd(), target.path)
    if (!safe || safe !== target.path) throw new Error('Invalid diff path.')
    if (target.source.kind !== 'working') return { file: null, truncated: false }
    return readDiff(await props.api.diff({ path: target.path, staged: target.source.staged, untracked: target.source.untracked }))
  })
  createEffect(() => {
    const selected = target(); props.revision; cwd()
    setLoaded(undefined); setError('')
    void untrack(() => load(selected)).then((r) => { if (!stopped && !r.stale) setLoaded(r.value) }).catch((e: unknown) => {
      if (!stopped) setError(e instanceof Error ? e.message.split(/\r?\n/)[0]! : 'Unable to load diff.')
    })
  })
  createEffect(() => { target(); setPosition({ logical: 0, offset: 0 }) })
  const room = () => Math.max(1, props.height - (props.header ? 1 : 0) - (loaded()?.truncated && props.height > 1 ? 1 : 0))
  const layout = createMemo(() => {
    const file = loaded()?.file
    const rows: { text: string; gutter: string; kind: DiffLine['kind'] | 'hunk'; logical: number; offset: number }[] = []
    const starts: number[] = []
    if (!file) return { rows, starts }
    const metadata = diffWindow(file, 0, 1)
    const hunkStarts = new Set(metadata.hunkStarts)
    const logical = file.hunks.flatMap((h) => [{ text: h.header, kind: 'hunk' as const }, ...h.lines])
    const digits = String(Math.max(1, ...file.hunks.flatMap((h) => h.lines.flatMap((l) => [l.oldNo ?? 0, l.newNo ?? 0])))).length
    const gutterWidth = props.width >= 100 ? digits * 2 + 2 : props.width >= 60 ? digits + 1 : 0
    logical.forEach((line, index) => {
      if (hunkStarts.has(index)) starts.push(rows.length)
      const number = (n: number | undefined) => String(n ?? '').padStart(digits)
      const gutter = line.kind === 'hunk' ? ' '.repeat(gutterWidth) : props.width >= 100 ? `${number(line.oldNo)} ${number(line.newNo)} ` : props.width >= 60 ? `${number(line.newNo)} ` : ''
      const prefix = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : line.kind === 'ctx' ? ' ' : ''
      let text = prefix + line.text.replaceAll('\t', '    ')
      const width = Math.max(1, props.width - gutterWidth - 2)
      let first = true
      let offset = 0
      do {
        const part = fitEnd(text, width, '')
        rows.push({ text: part, gutter: first ? gutter : gutterWidth ? '│'.padStart(gutterWidth) : '', kind: line.kind, logical: index, offset })
        text = text.slice(part.length); offset += part.length; first = false
        if (!part && text) { text = text.slice(Array.from(text)[0]!.length) }
      } while (text)
    })
    return { rows, starts }
  })
  const top = createMemo(() => {
    const anchor = position()
    const at = layout().rows.findLastIndex((r) => r.logical < anchor.logical || r.logical === anchor.logical && r.offset <= anchor.offset)
    return Math.max(0, at)
  })
  function setTop(value: number | ((n: number) => number)) {
    const at = typeof value === 'function' ? value(top()) : value
    const row = layout().rows[Math.max(0, Math.min(layout().rows.length - 1, at))]
    if (row) setPosition({ logical: row.logical, offset: row.offset })
  }
  const notice = () => error() ? `Can't show this diff: ${error()}` : !loaded() ? 'Loading…' : loaded()?.file?.binary ? 'Binary file. Press o to open it.' : !layout().rows.length ? 'No changes.' : ''
  const visible = () => layout().rows.slice(Math.min(top(), Math.max(0, layout().rows.length - 1)), top() + room())
  async function run(action: string) {
    if (action === 'back') props.back()
    else if (action === 'next-file' || action === 'prev-file') props.next(action === 'next-file' ? 1 : -1)
    else if (action === 'scroll-up' || action === 'scroll-down') setTop((n) => Math.max(0, Math.min(layout().rows.length - 1, n + (action === 'scroll-up' ? -1 : 1))))
    else if (action === 'next-hunk' || action === 'prev-hunk') {
      const next = action === 'next-hunk' ? layout().starts.find((n) => n > top()) : [...layout().starts].reverse().find((n) => n < top())
      if (next !== undefined) setTop(next)
    } else if (action === 'open-editor') {
      const reply = await props.api.open({ rel: props.target.path }) as { refused?: unknown }
      if (typeof reply?.refused === 'string' && !stopped) props.ctx.ui.toast.show({ message: reply.refused, variant: 'warning' })
    }
    else if (action === 'ask-review' && loaded()?.file?.hunks.length && !reviewBusy) {
      reviewBusy = true
      try { await handToAgent(props.ctx, props.sessionID, reviewText(props.target.path, toUnifiedText(loaded()!.file!), 8000)) } finally { reviewBusy = false }
    }
  }
  props.bind((action) => { void run(action).catch(() => props.ctx.ui.toast.show({ message: 'Unable to complete diff action.', variant: 'error' })) })
  onCleanup(() => { stopped = true; props.bind(() => {}) })
  const header = () => {
    const f = loaded()?.file; const d = props.target.source; const source = d.kind === 'working' ? d.staged ? 'staged' : d.untracked ? 'untracked' : 'working tree' : d.kind
    const suffix = ` · ${source}${f ? ` +${f.added} −${f.removed}` : ''}`
    return props.width >= 40 ? fitPath(props.target.path, Math.max(8, props.width - cellWidth(suffix) - 2)) + suffix : fitPath(props.target.path, props.width - 2)
  }
  return <box flexGrow={1} minHeight={1} flexDirection="column" overflow="hidden">
    <Show when={props.header}><text height={1} flexShrink={0} onMouseDown={props.back}>{' ' + fitEnd(header(), props.width - 2)}</text></Show>
    <Show when={loaded()?.truncated && props.height > 1}><text height={1} flexShrink={0} fg={theme().text.feedback.warning.base}>{fitEnd(`Diff truncated at ${DIFF_MAX_LINES.toLocaleString('en-US')} lines.`, props.width)}</text></Show>
    <Show when={!notice()} fallback={<text height={1} fg={error() ? theme().text.feedback.error.base : theme().text.muted}>{fitEnd(notice(), props.width)}</text>}>
      <For each={visible()}>{(row) => <text height={1} flexShrink={0}>
        {' '}<span style={{ fg: theme().diff?.lineNumber.text ?? theme().text.muted }}>{row.gutter}</span><span style={{ fg: row.kind === 'add' ? colors()?.added ?? theme().text.feedback.success.base : row.kind === 'del' ? colors()?.removed ?? theme().text.feedback.error.base : row.kind === 'hunk' ? colors()?.hunkHeader ?? theme().text.muted : colors()?.context ?? theme().text.base }}>{row.text}</span>
      </text>}</For>
    </Show>
  </box>
}
