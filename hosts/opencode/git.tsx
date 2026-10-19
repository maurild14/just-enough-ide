import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import type { CommitMode } from '../../core/git/commands.ts'
import type { FileStatus, StatusEntry } from '../../core/git/status.ts'
import { currentView, type PaneAction, type PaneState } from '../../core/pane.ts'
import { cellWidth, fitEnd, fitPath, padEnd } from '../../core/shared/fit.ts'
import { insideRel, joinPath, toPosix } from '../../core/shared/paths.ts'
import { handToAgent } from './hand-off.ts'
import { Diff } from './diff.tsx'
import type { JeiRpc } from './rpc.ts'

const STATUS: Record<FileStatus, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflicted: 'C', ignored: '' }
type Group = 'staged' | 'changes'
type Row = { id: string; path?: string; status?: FileStatus; group?: Group; added?: number | null; removed?: number | null }
const MODES: readonly { value: CommitMode; title: string }[] = [
  { value: 'commit', title: 'Commit' }, { value: 'commit-push', title: 'Commit & Push' }, { value: 'amend', title: 'Commit (amend)' },
]
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Git reply.')
  return value as Record<string, unknown>
}
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const nullableText = (v: unknown): v is string | null => v === null || typeof v === 'string'
function readGit(raw: unknown, cwd: string) {
  const data = record(raw)
  if (data.root === null) return null
  if (typeof data.root !== 'string' || insideRel(data.root, cwd) === null || typeof data.hooks !== 'boolean') throw new Error('Invalid Git reply.')
  const status = record(data.status); const branch = record(status.branch)
  if (!nullableText(branch.head) || !nullableText(branch.oid) || !nullableText(branch.upstream) || !natural(branch.ahead) || !natural(branch.behind) || !Array.isArray(status.entries)) throw new Error('Invalid Git reply.')
  const validStatus = (s: unknown): s is FileStatus | null => s === null || typeof s === 'string' && Object.hasOwn(STATUS, s)
  const entries = status.entries.map((raw): StatusEntry => {
    const e = record(raw)
    if (typeof e.path !== 'string' || !e.path || insideRel(data.root as string, e.path) !== e.path || !validStatus(e.index) || !validStatus(e.worktree)) throw new Error('Invalid Git reply.')
    return { path: e.path, index: e.index, worktree: e.worktree }
  })
  const counts = (raw: unknown) => new Map(Object.entries(record(raw)).map(([path, raw]) => {
    const c = record(raw)
    if (!(c.added === null || natural(c.added)) || !(c.removed === null || natural(c.removed))) throw new Error('Invalid Git reply.')
    return [path, { added: c.added, removed: c.removed }] as const
  }))
  return { root: data.root, branch: { head: branch.head, oid: branch.oid, upstream: branch.upstream, ahead: branch.ahead, behind: branch.behind }, entries, numstat: counts(data.numstat), staged: counts(data.staged), hooks: data.hooks }
}

export function Git(props: {
  ctx: Plugin.Context; api: RpcClient<typeof JeiRpc>; sessionID: string; cwd: string; git: Record<string, unknown>
  state: PaneState; dispatch: (action: PaneAction) => void; revision: number; refresh: () => Promise<void>; smartCommit: boolean
  width: number; height: number; header: boolean; focused: boolean; bind: (run: (action: string) => void, editing: () => boolean) => void
}) {
  const draft = createMemo(() => props.ctx.storage.memory<{ message: string; mode: CommitMode; busy: string }>(`jei.git.${props.sessionID}`, { initial: { message: '', mode: 'commit', busy: '' } }))
  const message = () => draft()[0].message
  const subject = createMemo(() => message().split(/[\r\n]/, 1)[0]!)
  const body = createMemo(() => message().slice(subject().length))
  const mode = () => draft()[0].mode
  const busy = () => draft()[0].busy
  const setMessage = (message: string) => draft()[1]((d) => { d.message = message })
  // shortcut: the native input edits only the subject; add a multiline editor when body editing is needed.
  const setSubject = (subject: string) => setMessage(subject + body())
  const setMode = (mode: CommitMode) => draft()[1]((d) => { d.mode = mode })
  const [editing, setEditing] = createSignal(false)
  let diffAction: (action: string) => void = () => {}
  const isDiff = () => currentView(props.state) === 'git.diff' && props.state.diff !== undefined
  const [collapsed, setCollapsed] = createSignal<ReadonlySet<Group>>(new Set())
  const selected = () => props.state.selected.git
  const theme = () => props.ctx.theme
  const inner = () => Math.max(0, props.width - 2)
  const repo = createMemo(() => { try { return { value: readGit(props.git, props.cwd), error: '' } } catch { return { value: null, error: 'Invalid Git reply.' } } })
  const groups = createMemo(() => {
    const result: Record<Group, Row[]> = { staged: [], changes: [] }; const g = repo().value
    if (!g) return result
    for (const e of g.entries) {
      const path = insideRel(props.cwd, joinPath(g.root, e.path))
      if (path === null || !path) continue
      for (const group of ['staged', 'changes'] as const) {
        const status = group === 'staged' ? e.index : e.worktree
        if (!status || status === 'ignored' || group === 'staged' && status === 'conflicted') continue
        const c = (group === 'staged' ? g.staged : g.numstat).get(e.path)
        result[group].push({ id: `${group}-${path}`, path, status, group, added: c?.added, removed: c?.removed })
      }
    }
    for (const rows of Object.values(result)) rows.sort((a, b) => a.path! < b.path! ? -1 : a.path! > b.path! ? 1 : 0)
    return result
  })
  const items = createMemo(() => {
    const all: Row[] = [{ id: 'message' }, { id: 'commit-now' }, { id: 'commit' }, { id: 'generate-message' }, { id: 'sync' }]
    if (props.smartCommit && mode() !== 'amend' && !groups().staged.length && groups().changes.length) all.push({ id: 'smart-commit-note' })
    for (const group of ['staged', 'changes'] as const) if (groups()[group].length) {
      all.push({ id: `group-${group}`, group })
      if (!collapsed().has(group)) all.push(...groups()[group])
    }
    if (!groups().staged.length && !groups().changes.length) all.push({ id: 'clean' })
    return all
  })
  createEffect(() => { if (!items().some((r) => r.id === selected())) props.dispatch({ type: 'select', view: 'git', id: items().find((r) => r.group)?.id ?? 'clean' }) })
  const room = () => Math.max(1, props.height - (props.header ? 1 : 0) - 1)
  let listTop = 0
  const window = createMemo(() => {
    const all = items(); const at = all.findIndex((r) => r.id === selected()); const context = room() >= 5 ? 1 : 0
    if (at >= 0) listTop = Math.min(Math.max(listTop, at - room() + 1 + context), at - context)
    listTop = Math.max(0, Math.min(listTop, all.length - room()))
    return all.slice(listTop, listTop + room())
  })
  async function perform(label: string, fn: () => Promise<void>) {
    const [current, update] = draft()
    if (stopped || current.busy) return
    update((d) => { d.busy = label })
    try { await fn() } catch (error) {
      const reason = error instanceof Error ? error.message.split(/\r?\n/)[0] || 'Unknown error' : 'Unknown error'
      if (!stopped) props.ctx.ui.toast.show({ message: fitEnd(`${label} failed: ${reason}`, Math.max(1, Math.min(props.width, 256))), variant: 'error' })
    } finally { update((d) => { d.busy = '' }) }
  }
  async function mutate(method: 'stage' | 'unstage' | 'discard', rows: Row[]) {
    const paths = rows.flatMap((r) => r.path === undefined ? [] : [r.path])
    if (!paths.length) return
    if (method === 'discard') {
      const deleted = rows.filter((r) => r.status === 'untracked').length
      const message = rows.length === 1 ? `Discard changes to ${paths[0]}?` : `Discard all changes (${paths.length} files${deleted ? `, ${deleted} untracked will be deleted` : ''})?`
      if (!await props.ctx.ui.dialog.confirm({ title: 'Discard changes', message, label: { confirm: 'Discard', cancel: 'Cancel' } })) return
    }
    if (!stopped) try { await props.api[method]({ paths }) } finally { await props.refresh() }
  }
  async function commit() {
    const text = message().trim(); if (!subject().trim()) return
    const selectedMode = mode()
    const [, update] = draft()
    await perform('Commit', async () => {
      async function approval(): Promise<boolean | undefined> {
        let approved: readonly string[] = []
        while (!stopped) {
          const plan = record(await props.api.commitPlan({ message: text, mode: selectedMode }))
          if (!Array.isArray(plan.sensitive) || !plan.sensitive.every((p): p is string => typeof p === 'string')) throw new Error('Invalid Git reply.')
          if (stopped) return undefined
          if (plan.sensitive.every((p) => approved.includes(p))) return plan.sensitive.length > 0
          if (!await props.ctx.ui.dialog.confirm({ title: 'Sensitive files', message: `These files look sensitive:\n${plan.sensitive.join('\n')}`, label: { confirm: 'Commit anyway', cancel: 'Cancel' } })) return undefined
          approved = plan.sensitive
        }
      }
      let allowSensitive = await approval()
      if (stopped || allowSensitive === undefined) return
      try {
        try { await props.api.commit({ message: text, mode: selectedMode, allowSensitive }) }
        catch (error) {
          if (allowSensitive || !(error instanceof Error) || error.message !== 'Sensitive files require confirmation.') throw error
          allowSensitive = await approval()
          if (stopped || allowSensitive === undefined) return
          await props.api.commit({ message: text, mode: selectedMode, allowSensitive })
        }
        update((d) => { if (d.message.trim() === text) d.message = '' })
        if (!stopped) setEditing(false)
      } finally { await props.refresh() }
    })
  }
  async function sync() {
    await perform('Sync', async () => {
      let result = record(await props.api.sync({}))
      if (result.ok === false && result.divergence === true) {
        const choice = await props.ctx.ui.dialog.select<'merge' | 'rebase' | 'ask'>({ title: 'Your branch and its upstream have diverged.', options: [
          { title: 'Merge', value: 'merge' }, { title: 'Rebase', value: 'rebase' }, { title: 'Ask OpenCode', value: 'ask' },
        ] })
        if (stopped || choice === undefined) return
        if (choice === 'ask') {
          const branch = repo().value?.branch
          await handToAgent(props.ctx, props.sessionID, `My branch ${branch?.head ?? 'HEAD'} and ${branch?.upstream ?? 'its upstream'} have diverged. Explain the choices (merge or rebase) and reconcile them the way I pick, without losing work.`)
          return
        }
        result = record(await props.api.sync({ choice }))
      }
      await props.refresh()
      if (result.ok !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Invalid Git reply.')
    })
  }
  async function run(action: string) {
    if (isDiff()) { diffAction(action); return }
    if (action === 'back') { if (editing()) setEditing(false); else props.dispatch({ type: 'back' }); return }
    if (repo().error) return
    if (action === 'activate' && !repo().value) { await perform('Initialize', async () => { await props.api.init({}); await props.refresh() }); return }
    if (!repo().value) return
    if (action === 'move-up' || action === 'move-down') {
      setEditing(false)
      const rows = items(); const at = rows.findIndex((r) => r.id === selected())
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (action === 'move-up' ? -1 : 1)))]
      if (next) props.dispatch({ type: 'select', view: 'git', id: next.id })
      return
    }
    if (action === 'commit') {
      await perform('Choose commit mode', async () => {
        const choice = await props.ctx.ui.dialog.select<CommitMode>({ title: 'Commit mode', current: mode(), options: MODES })
        if (!stopped && MODES.some((m) => m.value === choice)) { setMode(choice!); setEditing(true) }
      }); return
    }
    if (action === 'commit-now') { await commit(); return }
    if (action === 'generate-message') {
      await perform('Generate', async () => { const data = record(await props.api.generate({})); if (typeof data.message !== 'string') throw new Error('Invalid Git reply.'); if (!stopped) setMessage(data.message) }); return
    }
    if (action === 'sync') { await sync(); return }
    const target = items().find((r) => r.id === selected())
    if (action === 'activate' && target?.path) { openDiff(target); return }
    if (action === 'activate' && target && !target.group) {
      if (target.id === 'message') setEditing(true)
      else if (target.id !== 'clean') await run(target.id)
      return
    }
    if (action === 'activate' && target?.group && !target.path) {
      const next = new Set(collapsed()); if (next.has(target.group)) next.delete(target.group); else next.add(target.group); setCollapsed(next); return
    }
    if (action === 'stage' || action === 'unstage' || action === 'discard') {
      const group = action === 'unstage' ? 'staged' : 'changes'
      if (target?.group !== group) return
      await perform(action === 'stage' ? 'Stage' : action === 'unstage' ? 'Unstage' : 'Discard', () => mutate(action, target.path ? [target] : groups()[group]))
    }
  }
  const invoke = (action: string) => { void run(action) }
  props.bind(invoke, () => !isDiff() && editing())
  let stopped = false
  onCleanup(() => { stopped = true; props.bind(() => {}, () => false) })
  const header = () => {
    const g = repo().value; if (!g) return 'Git'
    const branch = g.branch.head ?? `Detached at ${g.branch.oid?.slice(0, 7) ?? 'HEAD'}`
    const tail = `${g.entries.length ? '*' : ''} ↓${g.branch.behind} ↑${g.branch.ahead}${!g.branch.upstream ? ' No upstream branch.' : ''}${g.hooks ? ' hooks' : ''}${busy() ? ` ${busy()}…` : ''}`
    const name = props.width >= 100 ? `${toPosix(g.root).split('/').pop()}  ` : ''
    return `${name}${fitEnd(branch, Math.max(8, inner() - cellWidth(name + tail) - (props.width >= 60 ? 5 : 0)))}${tail}`
  }
  const counts = (r: Row) => props.width >= 32 && natural(r.added) && natural(r.removed) ? `+${r.added} −${r.removed}` : ''
  const actions = (r: Row) => !r.path && r.group && inner() >= 65 ? r.group === 'staged' ? 'Unstage all  ' : 'Stage all  Discard all  ' : ''
  const tail = (r: Row) => r.path ? counts(r) : r.group ? `${actions(r)}${groups()[r.group].length}` : ''
  const rowText = (r: Row) => {
    if (r.id === 'smart-commit-note') return 'Nothing staged. Commit stages all changes.'
    if (!r.group) return r.id === 'clean' ? 'No changes.' : r.id === 'message' ? body() ? 'Edit subject (body kept)' : 'Edit message' : r.id === 'commit-now' ? MODES.find((m) => m.value === mode())!.title : r.id === 'commit' ? 'Commit mode' : r.id === 'sync' ? 'Sync' : '✦ Generate'
    if (!r.path) return `${collapsed().has(r.group) ? '▸' : '▾'} ${r.group === 'staged' ? 'Staged' : 'Changes'}`
    return `${STATUS[r.status!]} ${r.path}`
  }
  function openDiff(row: Row) {
    props.dispatch({ type: 'select', view: 'git', id: row.id })
    props.dispatch({ type: 'open-diff', path: row.path!, staged: row.group === 'staged', untracked: row.status === 'untracked' })
  }
  function nextFile(by: 1 | -1) {
    const d = props.state.diff!; const rows = groups()[d.staged ? 'staged' : 'changes']; const at = rows.findIndex((r) => r.path === d.path)
    if (rows[at + by]) openDiff(rows[at + by]!)
  }
  const placeholder = () => {
    const full = `Message (enter to commit on "${repo().value?.branch.head ?? 'HEAD'}")`
    return props.width >= 60 && cellWidth(full) <= props.width ? full : 'Message'
  }
  return <Show when={!isDiff()} fallback={<Diff ctx={props.ctx} api={props.api} sessionID={props.sessionID} cwd={props.cwd} target={props.state.diff!}
    revision={props.revision} width={props.width} height={props.height} header={props.header} back={() => props.dispatch({ type: 'back' })} next={nextFile} bind={(run) => { diffAction = run }} />}>
  <box flexGrow={1} minHeight={1} flexDirection="column">
    <Show when={props.header}><box height={1} flexShrink={0} flexDirection="row">
      <text height={1} width={props.width - (repo().value && props.width >= 60 ? 5 : 0)} fg={repo().value && (!repo().value!.branch.head || !repo().value!.branch.upstream) ? theme().text.feedback.warning.base : theme().text.muted}>{' ' + fitEnd(header(), inner() - (repo().value && props.width >= 60 ? 5 : 0))}</text>
      <Show when={repo().value && props.width >= 60}><text height={1} onMouseDown={() => invoke('sync')}>Sync</text></Show>
    </box></Show>
    <Show when={repo().value} fallback={<>
      <text height={1} fg={repo().error ? theme().text.feedback.error.base : theme().text.muted}>{fitEnd(repo().error || 'This folder is not a git repository.', props.width)}</text>
      <Show when={!repo().error}><text height={1} onMouseDown={() => invoke('activate')}>{fitEnd('Initialize repository', props.width)}</text></Show>
    </>}>
      <box height={1} flexShrink={0} onMouseDown={() => setEditing(true)}>
        <input id="git-message" width={props.width} maxLength={Number.MAX_SAFE_INTEGER} value={subject()} placeholder={placeholder()} focused={props.focused && editing()}
          on:focused={() => setEditing(true)} on:blurred={() => setEditing(false)} onInput={setSubject} onSubmit={() => { void commit() }} />
      </box>
      <box flexGrow={1} minHeight={1} overflow="hidden" flexDirection="column">
          <For each={window()}>{(row) => <box height={1} flexShrink={0} width={props.width} flexDirection="row" backgroundColor={selected() === row.id ? theme().background?.action.primary.base : undefined}>
            <text height={1} width={props.width - cellWidth(tail(row))}
            fg={row.id === 'commit-now' ? !subject().trim() || busy() ? theme().text.muted : theme().text.action.primary.base : theme().text.base}
            onMouseDown={() => { setEditing(false); props.dispatch({ type: 'select', view: 'git', id: row.id }); invoke('activate') }}>
            {' '}<span style={{ fg: row.status === 'added' || row.status === 'untracked' ? theme().text.feedback.success.base : row.status === 'deleted' ? theme().text.feedback.error.base : row.status === 'conflicted' ? theme().text.feedback.info.base : row.status ? theme().text.feedback.warning.base : theme().text.muted }}>{row.path ? STATUS[row.status!] + ' ' : ''}</span>
            {padEnd(row.path ? fitPath(row.path, inner() - cellWidth(tail(row)) - 3) : fitEnd(rowText(row), inner() - cellWidth(tail(row)) - 1), inner() - cellWidth(tail(row)) - (row.path ? 3 : 1))}
            </text>
            <Show when={actions(row)}>
              <text height={1} onMouseDown={() => { void perform(row.group === 'staged' ? 'Unstage' : 'Stage', () => mutate(row.group === 'staged' ? 'unstage' : 'stage', groups()[row.group!])) }}>{row.group === 'staged' ? 'Unstage all  ' : 'Stage all  '}</text>
              <Show when={row.group === 'changes'}><text height={1} onMouseDown={() => { void perform('Discard', () => mutate('discard', groups().changes)) }}>Discard all  </text></Show>
            </Show>
            <text height={1}>
              <Show when={row.path} fallback={row.group ? String(groups()[row.group].length) : ''}>
                <span style={{ fg: theme().diff?.text.added ?? theme().text.feedback.success.base }}>{counts(row).split(' ')[0] ?? ''}</span>
                <span style={{ fg: theme().diff?.text.removed ?? theme().text.feedback.error.base }}>{counts(row) ? ' ' + counts(row).split(' ')[1] : ''}</span>
              </Show>
            </text>
          </box>}</For>
      </box>
    </Show>
  </box></Show>
}
