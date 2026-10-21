import { mock, type Engine, type Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

export const ROOT = '/work/acme-app'
export const A = 'a'.repeat(40)
export const B = 'b'.repeat(40)
export const C = 'c'.repeat(40)
export const D = 'd'.repeat(40)
export const props = (bodyColumns: number, bodyRows = 30) => ({ title: 'JEI', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} })
export type HistoryUi = Mounted<'terminal' | 'desktop', 'Pane'>

/** Scripted wire outputs keep host interaction tests independent of the real-Git service specs. */
export async function historyWorld($: Engine, on: On, initial: { hooks?: boolean; dirty?: boolean } = {}) {
  const clock = mock.clock(on, { now: 2_000_000_000_000 })
  const r = { root: ROOT, head: A, dirty: false, hooks: false, merge: false, topology: false, empty: false, upstream: '', ahead: 0, behind: 0, fetchError: '', copy: true, logError: false, branchesError: false, openerCode: 0, openerError: false,
    runs: [] as string[][], copies: [] as string[], fills: [] as string[], toasts: [] as string[], tools: [] as string[], writes: [] as string[],
    reflog: [] as string[], shell: async (_command: string) => {}, session: 'history-session', base: true, originHead: '', remoteRef: 'origin/main', remoteHash: A, evidenceError: false, clock,
    histories: {} as Record<string, Record<string, { agents: string[] }>>, records: null as string[] | null, logHashes: null as string[] | null, comparedFiles: null as string[] | null, beforeRun: async (_argv: string[]) => {}, time: 2_000_000_000, ...initial }
  const out = (stdout = '', exitCode = 0, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  const log = (hash: string) => {
    const parents = r.topology ? (hash === A ? `${B} ${C}` : hash === D ? '' : D) : hash === A ? (r.merge ? `${B} ${C}` : B) : ''
    return [hash, parents, hash === B ? 'Leo Park' : 'Ana Rivera', String(r.time), hash === A ? 'HEAD -> refs/heads/main, tag: refs/tags/v1.0' : '', hash === A ? 'feat: add user' : hash === B ? 'fix: validate input' : 'feat: agent commit'].join('\0') + '\0'
  }
  r.reflog = [`${A}\0HEAD@{2000000000 +0000}\0commit: feat: add user\0`]
  on('session.id', () => ({ value: r.session }))
  on('state.get', async (_$, e, next) => {
    const result = await next(e)
    return e.plugin === 'jei' && e.key === 'history' && result.value ? { value: { ...result.value, value: r.histories[r.session] ?? {} } } : result
  })
  on('state.set', (_$, e, next) => {
    r.writes.push(e.key)
    if (e.plugin === 'jei' && e.key === 'history') r.histories[r.session] = e.value as Record<string, { agents: string[] }>
    return next(e)
  })
  on('process.run', async (_$, e) => {
    const a = [...e.argv]; r.runs.push(a)
    await r.beforeRun(a)
    if (a.some(v => v.startsWith('https://'))) return r.openerError ? { deny: 'Opener unavailable.' } : out('', r.openerCode)
    if (a.includes('--show-toplevel')) return out(r.root + '\n')
    if (a.includes('--absolute-git-dir')) return out(r.root + '/.git\n')
    if (a.includes('status')) return out(`# branch.oid ${r.head}\0# branch.head main\0${r.upstream ? `# branch.upstream ${r.upstream}\0# branch.ab +${r.ahead} -${r.behind}\0` : ''}${r.records ? r.records.map(record => record + '\0').join('') : r.dirty ? `1 .M N... 100644 100644 100644 ${A} ${A} src/user.ts\0` : ''}`)
    if (a.includes('config')) return a.includes('core.hooksPath') && r.hooks ? out('local\t.githooks\n') : out('', 1)
    if (a.includes('--git-common-dir')) return out('.git\n')
    if (a.includes('reflog')) return r.evidenceError ? out('', 1, 'unavailable evidence') : out(r.reflog.join(''))
    if (a.includes('rev-parse')) return out((a.some((v) => v.includes('feature')) ? B : r.head) + '\n')
    if (a.includes('symbolic-ref')) return r.originHead && a.at(-1) === 'refs/remotes/origin/HEAD' ? out(r.originHead + '\n') : out('', 1)
    if (a.includes('check-ref-format')) return a.at(-1) === 'a..b' ? out('', 128, 'invalid') : out(a.at(-1) + '\n')
    if (a.includes('for-each-ref')) return r.branchesError ? out('', 1, 'Invalid branch.') : out(`${r.base ? `refs/heads/main\0${A}\0origin/main\0ahead 1, behind 2\0*\n` : ''}refs/heads/feature\0${B}\0origin/feature\0gone\0\nrefs/remotes/${r.remoteRef}\0${r.remoteHash}\0\0\0\n`)
    if (a.includes('remote')) return out('https://github.com/acme/acme-app.git\n')
    if (a.includes('log')) {
      if (r.logError) return out('', 1, 'Invalid branch.')
      if (r.empty) return out()
      const requested = a[a.indexOf('--end-of-options') + 1]
      if (a.includes('--end-of-options') && [A, B, C].includes(requested!)) return out(log(requested!))
      const rows = r.logHashes ?? (a.some((v) => v.startsWith('--author=')) ? [B] : r.topology ? [A, B, C, D] : [r.head, ...(r.head === C ? [A, B] : [B])])
      return out(rows.slice(0, Number(a[a.indexOf('-n') + 1])).map(log).join(''))
    }
    if (a.includes('rev-list')) return out(a.some((v) => v.includes('%ct')) ? `${r.head} 2000000000\n` : `${r.head} ${B}\n`)
    if (a.includes('diff-tree') || (a.includes('diff') && a.some((v) => v.includes('...')))) {
      if (a.includes('--name-status')) return out(r.comparedFiles ? r.comparedFiles.map(path => `M\0${path}\0`).join('') : 'M\0src/user.ts\0A\0src/other.ts\0')
      if (a.includes('--numstat')) return out(r.comparedFiles ? r.comparedFiles.map(path => `1\t1\t${path}\0`).join('') : '1\t1\tsrc/user.ts\0' + '1\t0\tsrc/other.ts\0')
    }
    if (a.includes('--numstat')) return out('')
    if (a.includes('diff') || a.includes('show')) {
      const path = a.at(-1) ?? 'src/user.ts'
      return out(`diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+after\n`)
    }
    if (a.includes('fetch')) return r.fetchError ? out('', 1, r.fetchError) : out()
    if (a.includes('commit')) { r.head = C; r.reflog.unshift(`${C}\0HEAD@{2000000001 +0000}\0commit: feat: agent commit\0`); r.dirty = false }
    return out()
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => ({ deny: 'ENOENT' }))
  on('fs.read', () => ({ deny: 'ENOENT' }))
  on('fs.write', () => ({ value: undefined }))
  on('tool.list', () => ({ value: [{ name: 'Bash', description: 'Run command', mcp: false }] }))
  on('tool.check', () => ({ decision: 'allow' as const }))
  on('tool.call', async (_$, e) => { const c = String((e as { command?: string }).command ?? ''); r.tools.push(c); await r.shell(c); return { result: {} as never, text: 'ok' } })
  on('ui.copy', (_$, e) => { r.copies.push(e.text); return { value: r.copy ? { isCopied: true as const } : { isCopied: false as const, reason: 'refused' as const } } })
  on('prompt.fill', (_$, e) => { r.fills.push(e.text); return { isFilled: true, text: e.text, cursor: e.text.length } })
  on('ui.toast', (_$, e) => { r.toasts.push(e.text); return { value: undefined } })
  on('ui.focus', () => ({}))
  on('classic.CwdChanged', () => ({}))
  await $.classic.CwdChanged({ old_cwd: '/work', new_cwd: r.root })
  return r
}

export async function historyPane($: Engine, width: number, rows = 30, surface: 'terminal' | 'desktop' = 'terminal') {
  const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', requestId: 'jei', props: props(width, rows) })
  await ui.press({ key: 'tab-3' })
  return ui
}

export async function select($: Engine, ui: HistoryUi, id: string) {
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: id, origin: { kind: 'person' } } as never)
  await ui.redraw()
}
