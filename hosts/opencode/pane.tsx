import type { RpcClient } from '@opencode/client'
import type { Plugin } from '@opencode/plugin/tui'
import type { PanelInput } from '@opencode/plugin/tui/context'
import { type JSX, useTerminalDimensions } from '@opentui/solid'
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { ActivityLog, allows } from '../../core/activity/log.ts'
import type { ActivityKind } from '../../core/activity/classify.ts'
import { hintLine, KEYS, TAB_KEYS } from '../../core/keys.ts'
import { latest } from '../../core/latest.ts'
import { parseOptions } from '../../core/options.ts'
import { currentView, initialPane, reducePane, type PaneAction, type PaneState } from '../../core/pane.ts'
import { fitEnd, fitPath } from '../../core/shared/fit.ts'
import { TAB_NAMES, tabBar } from '../../core/shared/tabs.ts'
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
  const activity = new ActivityLog()
  for (const [rel, raw] of Object.entries(record(data.activity))) {
    const row = record(raw)
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) throw new Error('Invalid JEI activity.')
    activity.touch(rel, kind(row.kind), row.at)
  }
  const git = record(data.git)
  if (git.root !== null && typeof git.root !== 'string') throw new Error('Invalid JEI state.')
  return { cwd: data.cwd, options: parseOptions(record(data.options)), git, activity }
}

export function Pane(props: { input: PanelInput; ctx: Context; api: RpcClient<typeof JeiRpc> }): JSX.Element {
  const options = parseOptions(props.ctx.options)
  const [memory, update] = paneMemory(props.ctx)
  const [state, setState] = createSignal<PaneState>(initialPane(options.defaultTab))
  const [snapshot, setSnapshot] = createSignal<ReturnType<typeof readState>>()
  const [activity, setActivity] = createSignal(new ActivityLog(), { equals: false })
  const [now, setNow] = createSignal(Date.now())
  const [error, setError] = createSignal('')
  const dimensions = useTerminalDimensions()
  const [height, setHeight] = createSignal(dimensions().height)
  const width = () => Math.max(0, Math.floor(props.input.width))
  let stopped = false
  onCleanup(() => { stopped = true })
  createEffect(() => { setState(memory.panes[props.input.sessionID] ?? initialPane(options.defaultTab)) })
  function dispatch(action: PaneAction) {
    const next = reducePane(state(), action)
    setState(next)
    update((draft) => { draft.panes[props.input.sessionID] = next })
  }
  const refresh = latest(async () => readState(await props.api.state({})))
  async function refetch() {
    try {
      const result = await refresh()
      if (stopped || result.stale) return
      const incoming = result.value.activity.toJSON()
      // A live event can arrive after the server serialized this state reply.
      for (const [rel, row] of Object.entries(activity().toJSON())) {
        if (row.at > (incoming[rel]?.at ?? -Infinity)) result.value.activity.touch(rel, row.kind, row.at)
      }
      setSnapshot(result.value)
      setActivity(result.value.activity)
      setNow(Date.now())
      setError('')
    } catch (error) {
      if (!stopped) setError(error instanceof Error ? error.message.split(/\r?\n/)[0]! : 'Unable to load JEI.')
    }
  }
  const changed = props.api.events.on('changed', () => { void refetch() })
  onCleanup(changed)
  const touched = props.api.events.on('activity', (event) => {
    try {
      const data = record(event.data)
      if (typeof data.rel !== 'string') throw new Error('Invalid JEI activity.')
      const activityKind = kind(data.kind)
      if (!allows(options.activity, activityKind)) return
      activity().touch(data.rel, activityKind, Date.now())
      setActivity(activity())
      setNow(Date.now())
    } catch { setError('Invalid JEI activity.') }
  })
  onCleanup(touched)
  const glowing = createMemo(() => activity().isGlowing(now()))
  createEffect(() => {
    if (!glowing()) return
    const timer = setInterval(() => { setNow(Date.now()) }, 250)
    onCleanup(() => { clearInterval(timer) })
  })
  void refetch()
  props.ctx.keymap.layer(() => ({
    enabled: props.input.focused,
    commands: [
      ...Object.entries(TAB_KEYS).map(([key, tab]) => ({ bind: key, title: TAB_NAMES[tab], run: () => { dispatch({ type: 'tab', tab }) } })),
      ...KEYS[currentView(state())].map(({ key, action, label }) => ({ bind: key, title: label, run: () => {
        if (action === 'back') dispatch({ type: 'back' })
      } })),
    ],
  }))
  const tabs = createMemo(() => tabBar(width(), width(), state().tab))
  const body = () => error() || (state().tab === 'search' || state().tab === 'symbols' ? 'Coming in a later version.' :
    !snapshot() ? 'Loading…' : state().tab === 'files' && state().selected.files ? fitPath(state().selected.files!, width()) : TAB_NAMES[state().tab])
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
    <Show when={height() >= 6}><text height={1} flexShrink={0} fg={props.ctx.theme.text.muted}>{fitEnd(snapshot()?.cwd ?? 'JEI', width())}</text></Show>
    <box flexGrow={1} minHeight={1}><text height={1} fg={error() ? props.ctx.theme.text.feedback.error.base : props.ctx.theme.text.base}>{fitEnd(body(), width())}</text></box>
    <Show when={height() >= 10}><text height={1} flexShrink={0} fg={props.ctx.theme.text.muted}>{hintLine(currentView(state()), width())}</text></Show>
  </box>
}
