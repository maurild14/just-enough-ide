import { mock, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const ROOT = '/work/acme-app'
export const SOURCE = 'export function load() {\n  return save()\n}\nexport function save() { return 1 }\n'
export const props = (bodyColumns = 80, bodyRows = 24) => ({ title: 'JEI', isFocused: true, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} })
export const command = (args: string) => ({ command: 'jei', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } })
export async function world($: Engine, on: On, projectRoot = ROOT) {
  const clock = mock.clock(on)
  const files: Record<string, string> = { 'src/account.ts': SOURCE, 'src/other.ts': 'export function other() { return load() }\n' }
  const runs: string[][] = [], fills: string[] = [], toasts: string[] = [], checks: unknown[] = [], calls: unknown[] = []
  const states: Record<string, unknown> = {}, writes: string[] = []
  const settings = { missing: false, repo: true, slow: false, slowQuery: 'load', closed: 0, failWrite: '', realRoot: projectRoot, largeList: false, shown: false }
  on('state.set', (_$, e, next) => { states[e.key] = e.value; writes.push(e.key); return next(e) })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 'search-test' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: settings.shown ? [{ id: 'jei', title: 'JEI', isShown: true, isFocused: false, isPlaced: true }] : [] }))
  on('ui.close', () => { settings.shown = false; return { value: undefined } })
  on('ui.focus', () => ({}))
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } })
  on('prompt.fill', (_$, e) => { fills.push(e.text); return { isFilled: true, text: e.text, cursor: e.text.length } })
  const path = (p: string) => p.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '').replace(/^\/\//, '/').replace(/\/$/, '')
  const fixtureRoot = path(projectRoot)
  on('fs.stat', (_$, e) => {
    const p = path(e.path), rel = p.slice(fixtureRoot.length + 1)
    if (p !== fixtureRoot && files[rel] === undefined) return { deny: 'missing' }
    return { value: { kind: p === fixtureRoot ? 'dir' as const : 'file' as const, size: files[rel]?.length ?? 0, mtimeMs: 0, isLink: false, realPath: p === fixtureRoot ? settings.realRoot : p } }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_$, e) => { const text = files[path(e.path).slice(fixtureRoot.length + 1)]; return text === undefined ? { deny: 'missing' } : { value: e.as === 'bytes' ? { base64: btoa(text) } : text } })
  on('fs.write', (_$, e) => { const rel = path(e.path).slice(fixtureRoot.length + 1); if (settings.failWrite === rel) return { deny: 'Read-only file.' }; files[rel] = e.text; return { value: undefined } })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]; runs.push(argv)
    const stdout = argv.includes('--show-toplevel') ? projectRoot : argv.includes('ls-files') && !argv.includes('-d') ? Object.keys(files).join('\0') + '\0' : ''
    return { value: { exitCode: argv.includes('--show-toplevel') && !settings.repo ? 128 : 0, stdout, stderr: '', isStdoutTruncated: settings.largeList && argv.includes('ls-files'), isStderrTruncated: false } }
  })
  on('process.spawn', async function* (_$, e) {
    const argv = [...e.argv]; runs.push(argv)
    if (settings.missing && argv[0] === 'rg') return { value: { code: 127, signal: null } }
    const query = argv[argv.indexOf('-e') + 1] ?? ''
    try {
    for (const [rel, text] of Object.entries(files)) for (const [i, line] of text.split('\n').entries()) {
      let start = -1
      try { start = argv.includes('-F') ? line.toLowerCase().indexOf(query.toLowerCase()) : line.search(new RegExp(query)) } catch {}
      if (start < 0) continue
      const submatches: { start: number; end: number }[] = []
      if (argv.includes('-F')) {
        for (let at = start; at >= 0; at = line.toLowerCase().indexOf(query.toLowerCase(), at + Math.max(1, query.length))) submatches.push({ start: at, end: at + query.length })
      } else submatches.push({ start, end: start + (line.match(new RegExp(query))?.[0].length ?? 0) })
      yield { stream: 'stdout' as const, text: JSON.stringify({ type: 'match', data: { path: { text: rel }, lines: { text: line + '\n' }, line_number: i + 1, submatches } }) + '\n' }
      if (settings.slow && query.includes(settings.slowQuery)) await clock.sleep(1000)
    }
    return { value: { code: 0, signal: null } }
    } finally { settings.closed++ }
  })
  on('tool.check', (_$, e) => { checks.push(e.input); return { decision: 'deny' } })
  on('tool.call', (_$, e) => { calls.push(e); return { result: {} as never, text: '' } })
  on('classic.CwdChanged', () => ({}))
  await $.classic.CwdChanged({ old_cwd: '/work', new_cwd: projectRoot })
  return { clock, files, runs, fills, toasts, checks, calls, states, writes, settings }
}
