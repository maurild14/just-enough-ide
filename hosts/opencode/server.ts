import { Plugin } from '@opencode/plugin'
import { classifyTool } from '../../core/activity/classify.ts'
import { ActivityLog, allows } from '../../core/activity/log.ts'
import { allFiles, listDir, loadPreview, openFile } from '../../core/files/service.ts'
import { openUrlArgv } from '../../core/files/open.ts'
import { AgentCommits } from '../../core/git/agent.ts'
import { assertCommitHash } from '../../core/git/commit.ts'
import { logArgs, parseGraphFilter, parseLog } from '../../core/git/log.ts'
import { git } from '../../core/git/run.ts'
import { isRepo } from '../../core/git/status.ts'
import type { RpcHandlers } from '@opencode/plugin/promise/rpc'
import type { CommitMode } from '../../core/git/commands.ts'
import { agentCandidates, branches, captureReflog, checkout, commitDiff, commitFiles, compare, compareDiff, createBranch, fetchAll, graph, revert, switchBranch, webUrl, commitPlan, discard, fileDiff, generateMessage, initRepo, runSteps, snapshot, stage, sync, unstage } from '../../core/git/service.ts'
import { parseOptions } from '../../core/options.ts'
import { insideRel, joinPath } from '../../core/shared/paths.ts'
import { nodeHost } from './host.ts'
import { JeiRpc, toWire } from './rpc.ts'

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid RPC input')
  return input as Record<string, unknown>
}

function closed(input: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  const data = record(input)
  if (Object.keys(data).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(data, key))) throw new Error('Invalid RPC input')
  return data
}

function hash(input: unknown, key = 'hash'): string {
  const value = text(input, key); assertCommitHash(value); return value
}

function text(input: unknown, key: string): string {
  const value = record(input)[key]
  if (typeof value !== 'string') throw new Error('Invalid RPC input')
  return value
}

function flag(input: unknown, key: string): boolean {
  const value = record(input)[key]
  if (typeof value !== 'boolean') throw new Error('Invalid RPC input')
  return value
}

function paths(input: unknown, key = 'paths'): string[] {
  const value = record(input)[key]
  if (!Array.isArray(value) || !value.every((p): p is string => typeof p === 'string')) throw new Error('Invalid RPC input')
  return value
}

function commitInput(input: unknown): { message: string; mode: CommitMode } {
  const message = text(input, 'message')
  const mode = text(input, 'mode')
  if (mode !== 'commit' && mode !== 'commit-push' && mode !== 'amend') throw new Error('Invalid RPC input')
  return { message, mode }
}

function parseModel(model: string): { providerID: string; id: string } {
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) throw new Error('Use provider/model for the commit model.')
  return { providerID: model.slice(0, slash), id: model.slice(slash + 1) }
}

export default Plugin.define({
  id: 'jei',
  async setup(ctx) {
    const host = nodeHost((prompt, model) => ctx.generate.text({ prompt, ...(model ? { model: parseModel(model) } : {}) }).then((r) => r.text))
    const options = parseOptions(ctx.options)
    const activity = new ActivityLog()
    const controller = new AbortController()
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function repoSnapshot() {
      const snap = await snapshot(host, ctx.location.directory)
      if (snap.root === null) throw new Error('Not a git repository.')
      return snap
    }
    const trackers = new Map<string, AgentCommits>()
    const windows = new Map<string, Promise<(() => Promise<void>) | null>>()
    let mutations = 0
    let epoch = 0
    let calls = 0
    const invalidate = () => { epoch++; for (const tracker of trackers.values()) tracker.invalidate() }
    const trackerFor = (sessionID: string, root: string) => {
      const key = `${sessionID}\0${root}`
      let tracker = trackers.get(key)
      if (!tracker) { tracker = new AgentCommits(); trackers.set(key, tracker) }
      return tracker
    }
    async function headAt(root: string): Promise<string | null> {
      try { const value = (await git(host, root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).stdout.trim(); assertCommitHash(value); return value } catch { return null }
    }
    async function mutation<T>(fn: () => Promise<T>): Promise<T> {
      mutations++; invalidate()
      try { return await fn() } finally { mutations--; invalidate() }
    }
    async function agentWindow(sessionID: string) {
      // Pending evidence reads count as overlap before the first await.
      calls++; if (calls > 1 || mutations) invalidate()
      const started = epoch
      let tracker: AgentCommits | undefined; let token: number | undefined
      try {
        const root = await isRepo(host, ctx.location.directory)
        if (!root) { calls--; return null }
        tracker = trackerFor(sessionID, root)
        const from = await headAt(root)
        token = tracker.toolStart(from, Date.now() / 1000)
        const boundary = await captureReflog(host, root, from)
        if (started !== epoch || calls > 1 || mutations) tracker.invalidate()
        const active = tracker; const identity = token
        return async () => {
          try {
            const head = await headAt(root)
            const candidates = head === null ? [] : await agentCandidates(host, root, from, head, boundary)
            if (started !== epoch || calls > 1 || mutations) active.invalidate()
            active.toolEnd(identity, head, candidates)
          } catch { active.invalidate(); active.toolEnd(identity, null, []) }
          finally { calls-- }
        }
      } catch { tracker?.invalidate(); if (token !== undefined) tracker?.toolEnd(token, null, []); calls--; return null }
    }
    const handlers: RpcHandlers<typeof JeiRpc> = {
      async state() {
        return { cwd: ctx.location.directory, options, git: toWire(await snapshot(host, ctx.location.directory)), activity: activity.toJSON() }
      },
      async listDir(input, context) {
        const root = ctx.location.directory
        const rel = insideRel(root, text(input, 'rel'))
        if (rel === null) return context.error('outside_root', 'That path is outside the project.', {})
        return listDir(host, root, rel)
      },
      async preview(input, context) {
        const root = ctx.location.directory
        const rel = insideRel(root, text(input, 'rel'))
        if (rel === null) return context.error('outside_root', 'That path is outside the project.', {})
        return loadPreview(host, root, rel)
      },
      async allFiles() { return { files: await allFiles(host, ctx.location.directory) } },
      async open(input, context) {
        const root = ctx.location.directory
        const rel = insideRel(root, text(input, 'rel'))
        if (rel === null) return context.error('outside_root', 'That path is outside the project.', {})
        const line = record(input).line
        if (line !== undefined && (typeof line !== 'number' || !Number.isInteger(line) || line < 1)) throw new Error('Invalid RPC input')
        const refused = await openFile(host, options, joinPath(root, rel), line)
        return refused === null ? {} : { refused }
      },
      async stage(input, context) {
        const root = ctx.location.directory
        const rels = paths(input).map((p) => insideRel(root, p))
        if (!rels.every((p): p is string => p !== null)) return context.error('outside_root', 'That path is outside the project.', {})
        await stage(host, root, rels)
        return {}
      },
      async unstage(input, context) {
        const root = ctx.location.directory
        const rels = paths(input).map((p) => insideRel(root, p))
        if (!rels.every((p): p is string => p !== null)) return context.error('outside_root', 'That path is outside the project.', {})
        await unstage(host, root, rels)
        return {}
      },
      async discard(input, context) {
        const root = ctx.location.directory
        const rels = paths(input).map((p) => insideRel(root, p))
        if (!rels.every((p): p is string => p !== null)) return context.error('outside_root', 'That path is outside the project.', {})
        const snap = await repoSnapshot()
        const entries = snap.status.entries.filter((e) => {
          const rel = insideRel(root, joinPath(snap.root, e.path))
          return rel !== null && rels.includes(rel)
        })
        await discard(host, snap.root, entries)
        return {}
      },
      async diff(input, context) {
        const root = ctx.location.directory
        const rel = insideRel(root, text(input, 'path'))
        if (rel === null) return context.error('outside_root', 'That path is outside the project.', {})
        const source = record(record(input).source)
        if (source.kind === 'working') {
          closed(source, ['kind', 'staged', 'untracked'])
          return fileDiff(host, root, rel, { staged: flag(source, 'staged'), untracked: flag(source, 'untracked') })
        }
        const snap = await repoSnapshot()
        const path = insideRel(snap.root, joinPath(root, rel))
        if (path === null) return context.error('outside_root', 'That path is outside the project.', {})
        if (source.kind === 'commit') {
          closed(source, ['kind', 'hash']); const commit = hash(source)
          const result = await commitDiff(host, snap.root, commit, path)
          const info = parseLog((await git(host, snap.root, logArgs({ branch: commit }, 0))).stdout)[0]
          return { ...result, label: `${commit.slice(0, 7)} ${info?.subject ?? ''}`.trim() }
        }
        if (source.kind === 'compare') { closed(source, ['kind', 'base', 'head']); return compareDiff(host, snap.root, hash(source, 'base'), hash(source, 'head'), path) }
        throw new Error('Invalid RPC input')
      },
      async generate() {
        const snap = await repoSnapshot()
        const staged = snap.status.entries.filter((e) => e.index !== null && e.index !== 'conflicted').length
        return { message: await generateMessage(host, snap.root, options.commitModel, staged) }
      },
      async commitPlan(input) {
        return commitPlan(await repoSnapshot(), { ...commitInput(input), smartCommit: options.smartCommit })
      },
      async commit(input) {
        const params = commitInput(input)
        const approvedSensitive = paths(input, 'approvedSensitive')
        const snap = await repoSnapshot()
        const plan = commitPlan(snap, { ...params, smartCommit: options.smartCommit })
        if (plan.refusal !== undefined) throw new Error(plan.refusal)
        if (!plan.sensitive.every((path) => approvedSensitive.includes(path))) throw new Error('Sensitive files require confirmation.')
        await runSteps(host, snap.root, plan.steps)
        return {}
      },
      async init() { await initRepo(host, ctx.location.directory); return {} },
      async sync(input) {
        const choice = record(input).choice
        if (choice !== undefined && choice !== 'merge' && choice !== 'rebase') throw new Error('Invalid RPC input')
        const snap = await repoSnapshot()
        return sync(host, snap.root, snap.status.branch, choice)
      },
      async graph(input) {
        const filter = parseGraphFilter(text(input, 'filter')); const sessionID = text(input, 'sessionID')
        const count = record(input).count
        if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) throw new Error('Invalid RPC input')
        const root = (await repoSnapshot()).root
        const result = await graph(host, root, filter, count)
        const tracker = trackerFor(sessionID, root)
        return { ...result, commits: result.commits.map((commit) => ({ ...commit, agent: tracker.has(commit.hash) })) }
      },
      async commitFiles(input) { return { files: await commitFiles(host, (await repoSnapshot()).root, hash(input)) } },
      async branches() { return branches(host, (await repoSnapshot()).root) },
      async switchBranch(input) {
        const name = text(input, 'name'); const remote = flag(input, 'remote'); const confirmed = flag(input, 'confirmed')
        const root = (await repoSnapshot()).root
        const ref = `refs/${remote ? 'remotes' : 'heads'}/${name}`
        if (!(await branches(host, root)).branches.some((branch) => branch.name === name && branch.remote === remote)) throw new Error('Invalid branch.')
        return switchBranch(host, root, ref, confirmed)
      },
      async createBranch(input) {
        const start = record(input).start
        return createBranch(host, (await repoSnapshot()).root, text(input, 'name'), start === undefined ? null : hash(input, 'start'), flag(input, 'confirmed'))
      },
      async compare(input) {
        const root = (await repoSnapshot()).root
        const rows = (await branches(host, root)).branches
        const resolve = (name: string) => {
          const matches = rows.filter(branch => `refs/${branch.remote ? 'remotes' : 'heads'}/${branch.name}` === name)
          if (matches.length !== 1) throw new Error('Invalid branch.')
          return matches[0]!.hash
        }
        const base = resolve(text(input, 'base')); const head = resolve(text(input, 'head'))
        return { files: await compare(host, root, base, head), source: { kind: 'compare' as const, base, head } }
      },
      async checkout(input) { return checkout(host, (await repoSnapshot()).root, hash(input), flag(input, 'confirmed')) },
      async revert(input) { return revert(host, (await repoSnapshot()).root, hash(input), flag(input, 'confirmed')) },
      async fetch() { await fetchAll(host, (await repoSnapshot()).root); return {} },
      async webUrl(input) { return { url: await webUrl(host, (await repoSnapshot()).root, hash(input)) } },
      async openWeb(input) {
        const url = await webUrl(host, (await repoSnapshot()).root, hash(input))
        if (url) {
          const argv = openUrlArgv(url, host.platform)
          if (argv) { const result = await host.run(argv); if (result.exitCode) throw new Error(result.stderr.split(/\r?\n/)[0] || 'Could not open link.') }
        }
        return {}
      },
    }
    const mutating = new Set(['stage', 'unstage', 'discard', 'commit', 'init', 'sync', 'switchBranch', 'createBranch', 'checkout', 'revert', 'fetch'])
    const checked = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async (input: unknown, context: Parameters<typeof handler>[1]) => {
      const schema = JeiRpc.methods[name as keyof typeof JeiRpc.methods].input
      closed(input, Object.keys(schema.properties), schema.required)
      const run = () => (handler as (input: unknown, context: Parameters<typeof handler>[1]) => Promise<unknown>)(input, context)
      return mutating.has(name) ? mutation(run) : run()
    }])) as typeof handlers
    const registration = await ctx.rpc.register(JeiRpc, checked)
    function report(error: unknown) {
      console.error(`jei: background update failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    async function emit(...event: Parameters<typeof registration.events.emit>) {
      if (!stopped) await registration.events.emit(...event).catch(report)
    }
    function changed() {
      if (stopped) return
      clearTimeout(timer)
      timer = setTimeout(() => { void emit('changed', {}) }, 300)
    }
    const hooks: { dispose(): Promise<void> }[] = []
    let watching: Promise<void> | undefined
    async function cleanup() {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      controller.abort()
      await watching
      const results = await Promise.allSettled(hooks.map(hook => hook.dispose()))
      await registration.dispose()
      const failed = results.find(result => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    }
    try {
      hooks.push(await ctx.tool.hook('execute.before', async (event) => {
        if (stopped || typeof event.sessionID !== 'string' || typeof event.id !== 'string') return
        const key = `${event.sessionID}\0${event.id}`
        if (windows.has(key)) { invalidate(); return }
        windows.set(key, agentWindow(event.sessionID))
        await windows.get(key)
      }))
      hooks.push(await ctx.tool.hook('execute.after', async (event) => {
        if (stopped) return
        const key = `${event.sessionID}\0${event.id}`
        const pending = windows.get(key); windows.delete(key)
        try { await (await pending)?.() } catch { invalidate() }
        if (event.status !== 'completed') return
        const touch = classifyTool(event.tool, event.input)
        if (!touch) {
          // An unclassified shell command may still have changed files.
          if (['bash', 'powershell', 'shell'].includes(event.tool.toLowerCase())) changed()
          return
        }
        const rels = [...new Set(touch.paths.map((p) => insideRel(ctx.location.directory, p)).filter((p): p is string => p !== null && p !== ''))]
        if (allows(options.activity, touch.kind)) {
          for (const rel of rels) {
            if (stopped) return
            activity.touch(rel, touch.kind, Date.now())
            await emit('activity', { rel, kind: touch.kind })
          }
        }
        if (touch.kind !== 'read' && (rels.length > 0 || touch.paths.length === 0)) changed()
      }))
      const stream = ctx.event.subscribe({ signal: controller.signal })
      watching = (async () => {
        for await (const event of stream) {
          if (stopped) break
          if (event.location && insideRel(ctx.location.directory, event.location.directory) !== '') continue
          if (event.type === 'filesystem.changed' || event.type === 'vcs.branch.updated') changed()
        }
      })().catch((error: unknown) => { if (!stopped) report(error) })
    } catch (error) {
      await cleanup()
      throw error
    }
    return cleanup
  },
})
