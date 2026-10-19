import { Plugin } from '@opencode/plugin'
import { classifyTool } from '../../core/activity/classify.ts'
import { ActivityLog, allows } from '../../core/activity/log.ts'
import { allFiles, listDir, loadPreview, openFile } from '../../core/files/service.ts'
import type { CommitMode } from '../../core/git/commands.ts'
import { commitPlan, discard, fileDiff, generateMessage, initRepo, runSteps, snapshot, stage, sync, unstage } from '../../core/git/service.ts'
import { parseOptions } from '../../core/options.ts'
import { insideRel, joinPath } from '../../core/shared/paths.ts'
import { nodeHost } from './host.ts'
import { JeiRpc, toWire } from './rpc.ts'

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid RPC input')
  return input as Record<string, unknown>
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

function paths(input: unknown): string[] {
  const value = record(input).paths
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
    const registration = await ctx.rpc.register(JeiRpc, {
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
        await openFile(host, options, joinPath(root, rel), line)
        return {}
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
        return fileDiff(host, root, rel, { staged: flag(input, 'staged'), untracked: flag(input, 'untracked') })
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
        const allowSensitive = flag(input, 'allowSensitive')
        const snap = await repoSnapshot()
        const plan = commitPlan(snap, { ...params, smartCommit: options.smartCommit })
        if (plan.sensitive.length > 0 && !allowSensitive) throw new Error('Sensitive files require confirmation.')
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
    })
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
    let hook: { dispose(): Promise<void> } | undefined
    let watching: Promise<void> | undefined
    async function cleanup() {
      if (stopped) return
      stopped = true
      clearTimeout(timer)
      controller.abort()
      await watching
      try { await hook?.dispose() } finally { await registration.dispose() }
    }
    try {
      hook = await ctx.tool.hook('execute.after', async (event) => {
        if (stopped || event.status !== 'completed') return
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
      })
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
