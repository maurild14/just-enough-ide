import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import type { PanelInput } from '@opencode/plugin/tui/context'
import { type JSX, useTerminalDimensions } from '@opentui/solid'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { ActivityLog, allows } from '../../core/activity/log.ts'
import { ACTIVITY_FRAME_MS } from '../../core/activity/shimmer.ts'
import type { ActivityKind } from '../../core/activity/classify.ts'
import { hintLine, KEYS, TAB_KEYS } from '../../core/keys.ts'
import { latest } from '../../core/latest.ts'
import { parseOptions } from '../../core/options.ts'
import { currentView, initialPane, normalizePane, reducePane, type PaneAction, type PaneState } from '../../core/pane.ts'
import { fitEnd, fitPath } from '../../core/shared/fit.ts'
import { TAB_NAMES, tabBar } from '../../core/shared/tabs.ts'
import { insideRel } from '../../core/shared/paths.ts'
import { Files } from './files.tsx'
import { Git } from './git.tsx'
import { Search } from './search.tsx'
import { JeiRpc } from './rpc.ts'

type Context = Plugin.Context

export function paneMemory(ctx: Context) {
  return ctx.storage.memory<{ panes: Record<string, PaneState>; started: string[] }>('jei.panes', { initial: { panes: {}, started: [] } })
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JEI state.')
  return value as Record<string, unknown>
}

function kind(value: unknown): ActivityKind {
  if (value !== 'read' && value !== 'write' && value !== 'git') throw new Error('Invalid JEI activity.')
  return value
}

function readState(value: unknown) {
  const data = record(value)
  if (typeof data.cwd !== 'string') throw new Error('Invalid JEI state.')
  const rows: ReturnType<ActivityLog['toJSON']> = {}
  for (const [rel, raw] of Object.entries(record(data.activity))) {
    const row = record(raw)
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) throw new Error('Invalid JEI activity.')
    if (row.active !== undefined && (typeof row.active !== 'number' || !Number.isSafeInteger(row.active) || row.active < 1)) throw new Error('Invalid JEI activity.')
    rows[rel] = { kind: kind(row.kind), at: row.at, ...(row.active === undefined ? {} : { active: row.active }) }
  }
  const git = record(data.git)
  if (git.root !== null && typeof git.root !== 'string') throw new Error('Invalid JEI state.')
  return { cwd: data.cwd, options: parseOptions(record(data.options)), git, activity: ActivityLog.from(rows) }
}

export function Pane(props: { input: PanelInput; ctx: Context; api: RpcClient<typeof JeiRpc> }): JSX.Element {
  const options = parseOptions(props.ctx.options)
  const [memory, update] = paneMemory(props.ctx)
  const [state, setState] = createSignal<PaneState>(initialPane(options.defaultTab))
  const [snapshot, setSnapshot] = createSignal<ReturnType<typeof readState>>()
  const [activity, setActivity] = createSignal(new ActivityLog(), { equals: false })
  const [now, setNow] = createSignal(Date.now())
  const [error, setError] = createSignal('')
  const [revision, setRevision] = createSignal(0)
  const quickCacheScopes = new Set<string>()
  let filesAction: (action: string) => void = () => {}
  let gitAction: (action: string) => void = () => {}
  let searchAction: (action: string) => void = () => {}
  const [editingAction, setEditingAction] = createSignal<() => boolean>(() => false)
  const editing = () => editingAction()()
  const dimensions = useTerminalDimensions()
  const [height, setHeight] = createSignal(dimensions().height)
  const width = () => Math.max(0, Math.floor(props.input.width))
  const isFiles = () => currentView(state()) === 'files.preview' || state().tab === 'files'
  const activeAction = (action: string) => { if (isFiles()) filesAction(action); else if (state().tab === 'git') gitAction(action); else searchAction(action) }
  const showBack = () => height() >= 3 && (state().stack.length > 1 || editing()) && !(editing() && ['files', 'search', 'quickopen'].includes(currentView(state())))
  const back = () => { if (error() || !snapshot()) dispatch({ type: 'back' }); else activeAction('back') }
  let stopped = false
  let received = 0
  const live = new Map<string, number>()
  onCleanup(() => { stopped = true })
  createEffect(() => { setState(normalizePane(memory.panes[props.input.sessionID] ?? initialPane(options.defaultTab))) })
  function dispatch(action: PaneAction) {
    const next = reducePane(state(), action)
    setState(next)
    update((draft) => { draft.panes[props.input.sessionID] = next })
  }
  const refresh = latest(async () => readState(await props.api.state({})))
  async function refetch() {
    const before = received
    try {
      const result = await refresh()
      if (stopped || result.stale) return
      // Replay events received during this request without comparing host clocks.
      const rows = result.value.activity.toJSON()
      for (const [rel, row] of Object.entries(activity().toJSON())) {
        if ((live.get(rel) ?? 0) > before) rows[rel] = row
      }
      result.value.activity = ActivityLog.from(rows)
      setSnapshot(result.value)
      setActivity(result.value.activity)
      setNow(Date.now())
      setError('')
    } catch (error) {
      if (!stopped) setError(error instanceof Error ? error.message.split(/\r?\n/)[0]! : 'Unable to load JEI.')
    }
  }
  async function refreshAfterChange() { setRevision((n) => n + 1); await refetch() }
  const changed = props.api.events.on('changed', () => { void refreshAfterChange() })
  onCleanup(changed)
  const touched = props.api.events.on('activity', (event) => {
    try {
      const data = record(event.data)
      if (typeof data.rel !== 'string') throw new Error('Invalid JEI activity.')
      const rel = snapshot() ? insideRel(snapshot()!.cwd, data.rel) : data.rel
      if (rel === null || !rel) throw new Error('Invalid JEI activity.')
      const activityKind = kind(data.kind)
      if (data.active !== undefined && typeof data.active !== 'boolean') throw new Error('Invalid JEI activity.')
      if (!allows(options.activity, activityKind)) return
      live.set(rel, ++received)
      activity()[data.active === true ? 'start' : data.active === false ? 'finish' : 'touch'](rel, activityKind, Date.now())
      setActivity(activity())
      setNow(Date.now())
      if (options.followAgent) dispatch({ type: 'select', view: 'files', id: rel })
    } catch { setError('Invalid JEI activity.') }
  })
  onCleanup(touched)
  const glowing = createMemo(() => activity().isGlowing(now()))
  createEffect(() => {
    if (!glowing()) return
    const timer = setInterval(() => { setNow(Date.now()) }, ACTIVITY_FRAME_MS)
    onCleanup(() => { clearInterval(timer) })
  })
  void refetch()
  props.ctx.keymap.layer(() => ({
    enabled: props.input.focused,
    commands: [
      ...Object.entries(TAB_KEYS).map(([key, tab]) => ({ bind: key, title: TAB_NAMES[tab], enabled: () => !editing(), run: () => { dispatch({ type: 'tab', tab }) } })),
      ...KEYS[currentView(state())].map(({ key, action, label }) => ({ bind: key, title: label, run: () => {
        if (action === 'back') back()
        else activeAction(action)
      }, enabled: () => !editing() || key === 'esc' && action === 'back' || ['move-up', 'move-down', ...(state().tab === 'files' ? ['activate'] : [])].includes(action) })),
    ],
  }))
  const tabs = createMemo(() => tabBar(width(), width(), state().tab))
  const showHints = () => height() >= (currentView(state()) === 'files' || currentView(state()) === 'files.preview' ? 10 : 5)
  const bodyHeight = () => Math.max(0, height() - (height() >= 3 ? 1 : 0) - (height() >= 8 ? 1 : 0) - (showHints() ? 1 : 0) - (showBack() ? 1 : 0))
  const hints = () => {
    const selected = state().selected.git ?? ''
    const history = /^(graph-|group-graph$|commit-file-|checkout-|revert-|web-)/.test(selected)
    const commit = /^graph-[0-9a-f]{40}$/.test(selected)
    return currentView(state()) === 'git' && history
      ? hintLine('git', width(), KEYS.git.filter(key => ['branches', 'filter', 'fetch', 'back', ...(commit ? ['copy-hash', 'ask', 'new-branch'] : [])].includes(key.action)))
      : hintLine(currentView(state()), width(), currentView(state()) === 'git'
        ? KEYS.git.filter(key => !['copy-hash', 'ask', 'new-branch'].includes(key.action))
        : undefined)
  }
  const body = () => error() || (!snapshot() ? 'Loading…' : TAB_NAMES[state().tab])
  return <box width={width()} height="100%" flexDirection="column" onSizeChange={function () { setHeight(this.height) }} onMouseDown={() => props.input.focus()}>
    <Show when={height() >= 3}>
      <box flexDirection="row" height={1} flexShrink={0} gap={tabs().gap}>
        <For each={tabs().labels}>{(tab) => <text fg={state().tab === tab.tab ? props.ctx.theme.text.action.primary.base : props.ctx.theme.text.muted}
          onMouseDown={() => { props.input.focus(); dispatch({ type: 'tab', tab: tab.tab }) }}>
          <Show when={state().tab === tab.tab} fallback={tab.label}><b>{tab.label}</b></Show>
        </text>}</For>
      </box>
    </Show>
    <Show when={height() >= 8}><text height={1} flexShrink={0} fg={props.ctx.theme.text.muted}>{'─'.repeat(width())}</text></Show>
    <Show when={showBack()}><text height={1} flexShrink={0} fg={props.ctx.theme.text.action.primary.base} onMouseDown={back}>{editing() ? ' Back' : ` ${KEYS[currentView(state())].find(key => key.action === 'back')!.key} Back`}</text></Show>
    <Show when={snapshot() && !error()} fallback={<box flexGrow={1} minHeight={0}><text height={1} fg={error() ? props.ctx.theme.text.feedback.error.base : props.ctx.theme.text.base}>{fitEnd(body(), width())}</text></box>}>
    <Show when={`${props.input.sessionID}\0${snapshot()!.cwd}`} keyed>{(_scope: string) => <Show when={!isFiles()} fallback={
      <Files ctx={props.ctx} api={props.api} sessionID={props.input.sessionID} cwd={snapshot()!.cwd} options={snapshot()!.options} git={snapshot()!.git}
        refresh={async () => { await refreshAfterChange(); if (error()) throw new Error(error()) }}
        state={state()} dispatch={dispatch} activity={activity()} now={now()} revision={revision()} width={width()}
        height={bodyHeight()} header={height() >= 6}
        focused={props.input.focused} bind={(run, isEditing) => { filesAction = run; setEditingAction(() => isEditing) }} />
    }>
      <Show when={state().tab !== 'git' || !snapshot() || error()} fallback={
        <Git ctx={props.ctx} api={props.api} sessionID={props.input.sessionID} cwd={snapshot()!.cwd} git={snapshot()!.git}
          state={state()} dispatch={dispatch} revision={revision()} refresh={refreshAfterChange} smartCommit={snapshot()!.options.smartCommit} graphLimit={snapshot()!.options.graphLimit} width={width()}
          height={bodyHeight()} header={height() >= 6}
          focused={props.input.focused} bind={(run, isEditing) => { gitAction = run; setEditingAction(() => isEditing) }} />
      }>
      <Search quickCacheScopes={quickCacheScopes} refresh={refreshAfterChange} ctx={props.ctx} api={props.api} sessionID={props.input.sessionID} cwd={snapshot()!.cwd} state={state()} dispatch={dispatch} activity={activity()} revision={revision()} width={width()} height={bodyHeight()} header={height() >= 6} focused={props.input.focused} bind={(run, isEditing) => { searchAction = run; setEditingAction(() => isEditing) }} />
      </Show>
    </Show>}</Show>
    </Show>
    <Show when={showHints()}><text height={1} flexShrink={0} fg={props.ctx.theme.text.muted}>{hints()}</text></Show>
  </box>
}
