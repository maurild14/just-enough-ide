import { expect, test, type Engine, type Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'
import { drawnLine, findKey, lineWidths, type Node } from './measure.ts'

const SURFACES = ['terminal', 'desktop'] as const
const WIDTHS = [24, 40, 80, 120] as const
const ROOT = '/work/acme-app'
const OID = 'a41f9c2' + '0'.repeat(33)
const H = '1'.repeat(40)

/** The kit hands $.fs native absolute paths (a drive letter on Windows); the fixtures are posix. */
const posix = (p: string) => p.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')

type Repo = {
  isRepo: boolean
  head: string | null
  upstream: string | null
  ahead: number
  behind: number
  hooks: boolean
  /** Porcelain v2 change records. */
  records: string[]
  /** `pull --ff-only` fails as diverged. */
  diverged: boolean
  /** `push` fails with this first line. */
  pushFails: string | null
  /** Lines in the working diff of src/api/user.ts. */
  diffLines: number
  /** The session's shell tool. */
  shell: 'Bash' | 'PowerShell'
  /** The shell tool's answer to a call: done, or moved to the background. */
  background: boolean
}

const STAGED_INDEX = `1 M. N... 100644 100644 100644 ${H} ${H} src/index.ts`
const CHANGED_USER = `1 .M N... 100644 100644 100644 ${H} ${H} src/api/user.ts`
const UNTRACKED_ENV = '? .env'

function repo(over: Partial<Repo> = {}): Repo {
  return {
    isRepo: true,
    head: 'main',
    upstream: 'origin/main',
    ahead: 1,
    behind: 2,
    hooks: false,
    records: [STAGED_INDEX, CHANGED_USER],
    diverged: false,
    pushFails: null,
    diffLines: 0,
    shell: 'Bash',
    background: false,
    ...over,
  }
}

function statusOut(r: Repo): string {
  const head = [`# branch.oid ${OID}`, `# branch.head ${r.head ?? '(detached)'}`]
  if (r.upstream) head.push(`# branch.upstream ${r.upstream}`, `# branch.ab +${r.ahead} -${r.behind}`)
  return [...head, ...r.records].map((x) => `${x}\0`).join('')
}

function userDiff(r: Repo): string {
  const body = ['diff --git a/src/api/user.ts b/src/api/user.ts', '--- a/src/api/user.ts', '+++ b/src/api/user.ts']
  if (r.diffLines > 0) {
    body.push(`@@ -1,${r.diffLines} +1,${r.diffLines} @@`)
    for (let i = 0; i < r.diffLines; i++) body.push(` line ${i + 1}`)
    return body.join('\n') + '\n'
  }
  body.push('@@ -1,3 +1,3 @@', ' export async function getUser(id: string) {', '-  return { id }', '+  return { id, name: "Ana Rivera" }', ' }')
  body.push('@@ -20,2 +20,3 @@ export function list()', ' const a = 1', '+const b = 2', ' const c = 3')
  return body.join('\n') + '\n'
}

type Calls = { writes: { path: string; text: string }[]; runs: string[][]; toasts: string[]; fills: { text: string; mode?: string }[]; checks: unknown[]; tools: Record<string, unknown>[]; prompts: string[] }

/** Answers git, the files and the session beneath the plugin; `r` may be changed mid-test. */
async function world($: { classic: { CwdChanged: (e: { old_cwd: string; new_cwd: string }) => Promise<unknown> } }, on: On, r: Repo) {
  const calls: Calls = { writes: [], runs: [], toasts: [], fills: [], checks: [], tools: [], prompts: [] }
  const res = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    calls.runs.push(argv)
    const has = (...words: string[]) => words.every((w) => argv.includes(w))
    if (has('--show-toplevel')) return r.isRepo ? res(0, `${ROOT}\n`) : res(128, '', 'fatal: not a git repository (or any of the parent directories): .git')
    if (has('--absolute-git-dir')) return res(0, `${ROOT}/.git\n`)
    if (has('--git-path')) return res(0, '.git/hooks\n')
    if (has('config', 'core.hooksPath')) return r.hooks ? res(0, '.githooks\n') : res(1, '')
    if (has('config', '--get')) return res(1, '')
    if (has('status')) return res(0, statusOut(r))
    if (has('diff', '--numstat', '--cached')) return res(0, '4\t1\tsrc/index.ts\0')
    if (has('diff', '--numstat')) return res(0, '12\t3\tsrc/api/user.ts\0')
    if (has('diff', '--', 'src/api/user.ts')) return res(0, userDiff(r))
    if (has('pull', '--ff-only') && r.diverged) return res(128, '', 'hint: Diverging branches can\'t be fast-forwarded\nfatal: Not possible to fast-forward, aborting.')
    if (argv.includes('push') && r.pushFails) return res(128, '', `${r.pushFails}\nfatal: Could not read from remote repository.`)
    if (has('ls-files')) return res(0, '')
    if (has('check-ignore')) return res(1, '')
    return res(0, '')
  })
  on('fs.list', (_$, e) => (posix(e.path) === ROOT ? { value: [] } : { deny: `ENOENT: ${posix(e.path)}` }))
  on('fs.stat', (_$, e) => ({ deny: `ENOENT: ${posix(e.path)}` }))
  on('fs.read', (_$, e) => ({ deny: `ENOENT: ${posix(e.path)}` }))
  on('model.complete', (_$, e) => {
    calls.prompts.push(String((e as { prompt?: unknown }).prompt ?? ''))
    return { value: { isAnswered: true, text: 'feat(api): return the user name', usage: {} } as never }
  })
  on('fs.write', (_$, e) => {
    calls.writes.push({ path: posix(e.path), text: e.text })
    return { value: undefined }
  })
  on('tool.list', () => ({ value: [{ name: 'Read', description: 'Read a file', mcp: false }, { name: r.shell, description: 'Run a command', mcp: false }] }))
  on('tool.check', (_$, e) => {
    calls.checks.push(e)
    return { decision: 'allow' as const }
  })
  on('tool.call', (_$, e) => {
    calls.tools.push({ ...e })
    if (r.background) {
      return { result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1', timedOutAfterMs: 600000 } as never, text: 'moved to the background' }
    }
    return { result: { stdout: '[main 1234567] feat\n', stderr: '', interrupted: false } as never, text: 'ok' }
  })
  on('prompt.fill', (_$, e) => {
    calls.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true, text: e.text, cursor: e.text.length }
  })
  on('ui.toast', (_$, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.focus', () => ({}))
  on('classic.CwdChanged', () => ({}))
  await $.classic.CwdChanged({ old_cwd: '/work', new_cwd: ROOT })
  return calls
}

function paneProps(bodyColumns: number, bodyRows = 30) {
  return { title: 'JEI', isFocused: false, bodyColumns, placement: 'dock' as const, scroll: { offset: 0, bodyRows }, view: {} }
}

type Ui = Mounted<'terminal' | 'desktop', 'Pane'>

async function gitPane($: Engine, surface: (typeof SURFACES)[number], width = 120, rows = 30): Promise<Ui> {
  const ui = await $.ui.mount({ plugin: 'jei', surface, component: 'Pane', props: paneProps(width, rows), requestId: 'jei' })
  await ui.press({ key: 'tab-4' })
  return ui
}

const gitRuns = (calls: Calls, ...words: string[]) => calls.runs.filter((a) => a[0] === 'git' && words.every((w) => a.includes(w)))

test('not a repository: the notice and Initialize repository', async ($, on) => {
  const r = repo({ isRepo: false })
  const calls = await world($, on, r)
  for (const surface of SURFACES) {
    const ui = await gitPane($, surface)
    expect(await ui.find({ type: 'Text', text: /This folder is not a git repository\./ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'init' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await gitPane($, 'terminal')
  r.isRepo = true
  await ui.press({ key: 'init' })
  expect(gitRuns(calls, 'init')).toHaveLength(1)
  expect(gitRuns(calls, 'init')[0]).toEqual(['git', '--no-optional-locks', '-C', ROOT, 'init'])
  expect(await ui.find({ key: 'repo' })).toBeDefined()
  await ui.unmount()
})

test('repository row: name, dirty branch, behind and ahead; detached', async ($, on) => {
  const r = repo()
  await world($, on, r)
  for (const surface of SURFACES) {
    const ui = await gitPane($, surface)
    const row = (await ui.find({ key: 'header' }))?.text ?? ''
    expect(row).toContain('acme-app')
    expect(row).toContain('⎇ main*')
    expect(row).toContain('↓2 ↑1')
    expect(await ui.find({ type: 'Button', key: 'sync' })).toBeDefined()
    expect(row).not.toContain('hooks')
    await ui.unmount()
  }
  r.head = null
  r.upstream = null
  await $.classic.CwdChanged({ old_cwd: ROOT, new_cwd: ROOT })
  const ui = await gitPane($, 'terminal')
  expect((await ui.find({ key: 'header' }))?.text).toContain('⎇ (detached a41f9c2)')
  await ui.unmount()
})

test('Staged and Changes groups: letters and counts; s stages a change', async ($, on) => {
  const calls = await world($, on, repo())
  for (const surface of SURFACES) {
    const ui = await gitPane($, surface)
    expect((await ui.find({ key: 'group-staged' }))?.text).toMatch(/Staged/)
    expect((await ui.find({ key: 'group-changes' }))?.text).toMatch(/Changes/)
    const staged = (await ui.find({ key: 'staged-src/index.ts' }))?.text ?? ''
    expect(staged).toMatch(/^M index\.ts/)
    expect(staged).toContain('+4 −1')
    const change = (await ui.find({ key: 'change-src/api/user.ts' }))?.text ?? ''
    expect(change).toMatch(/^M user\.ts/)
    expect(change).toContain('src/api')
    expect(change).toContain('+12 −3')
    expect(await ui.find({ type: 'Button', key: 'stage-all' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'unstage-all' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'discard-all' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await gitPane($, 'terminal')
  await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'change-src/api/user.ts', origin: { kind: 'person' } } as never)
  await ui.press({ key: 'key-s' })
  expect(gitRuns(calls, 'add')).toEqual([['git', '--no-optional-locks', '-C', ROOT, 'add', '--', 'src/api/user.ts']])
  await ui.press({ key: 'stage-all' })
  expect(gitRuns(calls, 'add')).toHaveLength(2)
  await ui.press({ key: 'unstage-all' })
  expect(gitRuns(calls, 'restore', '--staged')).toEqual([['git', '--no-optional-locks', '-C', ROOT, 'restore', '--staged', '--', 'src/index.ts']])
  await ui.unmount()
})

test('d and Discard all ask first and run nothing until Discard', async ($, on) => {
  const calls = await world($, on, repo())
  for (const surface of SURFACES) {
    const ui = await gitPane($, surface)
    await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'change-src/api/user.ts', origin: { kind: 'person' } } as never)
    await ui.press({ key: 'key-d' })
    expect(await ui.find({ type: 'Button', key: 'confirm-discard' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'confirm-cancel' })).toBeDefined()
    expect(gitRuns(calls, 'restore', '--worktree')).toHaveLength(0)
    await ui.press({ key: 'confirm-cancel' })
    expect(await ui.find({ key: 'confirm-discard' })).toBeUndefined()
    expect(gitRuns(calls, 'restore', '--worktree')).toHaveLength(0)
    await ui.unmount()
  }
  const ui = await gitPane($, 'terminal')
  await ui.press({ key: 'key-d' })
  await ui.press({ key: 'confirm-discard' })
  expect(gitRuns(calls, 'restore', '--worktree')).toEqual([['git', '--no-optional-locks', '-C', ROOT, 'restore', '--worktree', '--', 'src/api/user.ts']])
  await ui.press({ key: 'discard-all' })
  expect(await ui.find({ type: 'Text', text: /Discard all changes \(1 file\)\?/ })).toBeDefined()
  expect(gitRuns(calls, 'restore', '--worktree')).toHaveLength(1)
  await ui.press({ key: 'confirm-discard' })
  expect(gitRuns(calls, 'restore', '--worktree')).toHaveLength(2)
  await ui.unmount()
})

test('e syncs; a diverged branch offers Merge, Rebase and Ask Claude', async ($, on) => {
  const r = repo({ diverged: true })
  const calls = await world($, on, r)
  const ui = await gitPane($, 'terminal')
  await ui.press({ key: 'key-e' })
  expect(gitRuns(calls, 'pull', '--ff-only')).toHaveLength(1)
  for (const key of ['diverge-merge', 'diverge-rebase', 'diverge-ask']) expect(await ui.find({ type: 'Button', key })).toBeDefined()
  expect((await ui.find({ type: 'Button', key: 'diverge-ask' }))?.text).toContain('Ask Claude')
  await ui.press({ key: 'diverge-merge' })
  expect(gitRuns(calls, 'pull', '--no-rebase', '--ff')).toHaveLength(1)
  expect(await ui.find({ key: 'diverge-merge' })).toBeUndefined()
  await ui.unmount()
  for (const surface of SURFACES) {
    const pane = await gitPane($, surface)
    await pane.press({ key: 'key-e' })
    await pane.press({ key: 'diverge-ask' })
    expect(calls.fills.at(-1)?.text).toContain('diverged')
    await pane.unmount()
  }
})

test('a failed push toasts git\'s first line', async ($, on) => {
  const calls = await world($, on, repo({ behind: 0, pushFails: 'fatal: Authentication failed for the remote.' }))
  const ui = await gitPane($, 'terminal')
  await ui.press({ key: 'key-e' })
  expect(calls.toasts.at(-1)).toBe('Sync failed: fatal: Authentication failed for the remote.')
  await ui.unmount()
})

test('g fills the message from the model; an empty message disables Commit', async ($, on) => {
  const calls = await world($, on, repo())
  for (const surface of SURFACES) {
    const ui = await gitPane($, surface)
    expect(await ui.find({ type: 'Button', key: 'commit' })).toBeUndefined()
    expect(await ui.find({ key: 'commit-off' })).toBeDefined()
    await ui.press({ key: 'key-c' })
    expect(calls.toasts.at(-1)).toBe('Write a commit message first.')
    expect(gitRuns(calls, 'commit')).toHaveLength(0)
    await ui.press({ key: 'key-g' })
    expect(calls.prompts.at(-1)).toContain('Conventional Commits')
    expect((await ui.find({ type: 'Input', key: 'message' }))?.props.value ?? (await ui.find({ key: 'message' }))?.text).toContain('feat(api): return the user name')
    expect(await ui.find({ type: 'Button', key: 'commit' })).toBeDefined()
    if (surface === 'terminal') await ui.input({ key: 'message', text: '', kind: 'change' })
    await ui.unmount()
  }
})

test('commit: modes in the menu; plain commit runs git directly', async ($, on) => {
  const calls = await world($, on, repo())
  const ui = await gitPane($, 'terminal')
  const menu = await ui.find({ type: 'Select', key: 'commit-mode' })
  expect((menu?.props.options as { label: string }[]).map((o) => o.label)).toEqual(['Only', '& Push', 'Amend'])
  await ui.input({ key: 'message', text: "fix: don't drop the name", kind: 'change' })
  await ui.press({ key: 'commit' })
  expect(gitRuns(calls, 'commit')).toEqual([['git', '--no-optional-locks', '-C', ROOT, 'commit', '-m', "fix: don't drop the name"]])
  expect(calls.tools).toHaveLength(0)
  expect((await ui.find({ type: 'Input', key: 'message' }))?.props.value ?? '').toBe('')

  await ui.select({ key: 'commit-mode', value: 'commit-push' })
  await ui.input({ key: 'message', text: 'feat: push it', kind: 'submit' })
  expect(gitRuns(calls, 'commit', 'feat: push it')).toHaveLength(1)
  expect(gitRuns(calls, 'push')).toHaveLength(1)
  await ui.select({ key: 'commit-mode', value: 'commit' })
  await ui.unmount()
})

test('the commit row is one Commit control and a mode chooser at every width', async ($, on) => {
  await world($, on, repo())
  for (const width of WIDTHS) {
    const ui = await gitPane($, 'terminal', width)
    for (const message of ['', 'feat: one control']) {
      await ui.input({ key: 'message', text: message, kind: 'change' })
      for (const mode of ['commit', 'commit-push', 'amend']) {
        await ui.select({ key: 'commit-mode', value: mode })
        const tree = (await ui.drawn()) as Node
        const text = [0, 1, 2]
          .map((i) => findKey(tree, `commit-row-${i}`))
          .filter((n): n is Node => n !== undefined)
          .map(drawnLine)
          .join(' ')
        expect(text).toContain('[ Commit ]')
        expect(text.match(/Commit/g)).toHaveLength(1)
        for (const w of lineWidths(tree)) expect(w).toBeLessThanOrEqual(width)
      }
    }
    await ui.select({ key: 'commit-mode', value: 'commit' })
    await ui.input({ key: 'message', text: '', kind: 'change' })
    await ui.unmount()
  }
})

test('commit-push with no upstream publishes the branch', async ($, on) => {
  const calls = await world($, on, repo({ upstream: null }))
  const ui = await gitPane($, 'terminal')
  await ui.select({ key: 'commit-mode', value: 'commit-push' })
  await ui.input({ key: 'message', text: 'feat: first push', kind: 'submit' })
  expect(gitRuns(calls, 'push')).toEqual([['git', '--no-optional-locks', '-C', ROOT, 'push', '-u', 'origin', 'main']])
  await ui.select({ key: 'commit-mode', value: 'commit' })
  await ui.unmount()
})

test('a sensitive file stops the commit until Commit anyway', async ($, on) => {
  const calls = await world($, on, repo({ records: [CHANGED_USER, UNTRACKED_ENV] }))
  for (const surface of SURFACES) {
    const ui = await gitPane($, surface)
    if (surface === 'terminal') {
      await ui.input({ key: 'message', text: 'feat: add config', kind: 'submit' })
      expect(await ui.find({ type: 'Text', text: /These files look sensitive: \.env/ })).toBeDefined()
      expect(await ui.find({ type: 'Button', key: 'sensitive-commit' })).toBeDefined()
      expect(gitRuns(calls, 'commit')).toHaveLength(0)
    } else {
      expect(await ui.find({ type: 'Button', key: 'sensitive-commit' })).toBeDefined()
      await ui.press({ key: 'sensitive-commit' })
      expect(gitRuns(calls, 'add', '-A')).toHaveLength(1)
      expect(gitRuns(calls, 'commit', 'feat: add config')).toHaveLength(1)
      expect(await ui.find({ key: 'sensitive-commit' })).toBeUndefined()
    }
    await ui.unmount()
  }
})

test('with hooks the commit goes through the agent shell after a check, and the row marks it', async ($, on) => {
  const calls = await world($, on, repo({ hooks: true }))
  const ui = await gitPane($, 'terminal')
  expect((await ui.find({ key: 'header' }))?.text).toContain('hooks')
  await ui.input({ key: 'message', text: "fix: it's the name", kind: 'submit' })
  expect(calls.checks).toHaveLength(1)
  expect(calls.tools).toHaveLength(1)
  const call = calls.tools[0]!
  expect(call.tool).toBe('Bash')
  expect(call.command).toBe(`git --no-optional-locks -c core.quotepath=off -C ${ROOT} commit -F ${ROOT}/.git/JEI_COMMIT_MSG`)
  expect(call.timeout).toBe(600000)
  expect((calls.checks[0] as { input: { command: string } }).input.command).toBe(call.command)
  // The message goes to a file in the git dir, never into the shell line; the file is emptied after.
  expect(calls.writes[0]).toEqual({ path: `${ROOT}/.git/JEI_COMMIT_MSG`, text: "fix: it's the name\n" })
  expect(calls.writes.at(-1)).toEqual({ path: `${ROOT}/.git/JEI_COMMIT_MSG`, text: '' })
  expect(gitRuns(calls, 'commit')).toHaveLength(0)
  await ui.unmount()
})

test('hostile messages never reach the shell line, on Bash or PowerShell', async ($, on) => {
  const r = repo({ hooks: true })
  const calls = await world($, on, r)
  const hostile = [
    'a b" --amend --no-verify -a -m "c',
    "it's `whoami` $(rm -rf ~) $HOME",
    'line one\nline two; git push --force',
    '\u2018quoted\u2019 & | > <',
  ]
  for (const shell of ['Bash', 'PowerShell'] as const) {
    r.shell = shell
    for (const message of hostile) {
      const ui = await gitPane($, 'terminal')
      await ui.input({ key: 'message', text: message, kind: 'submit' })
      const call = calls.tools.at(-1)!
      expect(call.tool).toBe(shell)
      expect(String(call.command)).toBe(`git --no-optional-locks -c core.quotepath=off -C ${ROOT} commit -F ${ROOT}/.git/JEI_COMMIT_MSG`)
      expect(calls.writes.filter((w) => w.text !== '').at(-1)?.text).toBe(`${message.trim()}\n`)
      await ui.unmount()
    }
  }
})

test('a commit the shell moved to the background keeps the message and says so', async ($, on) => {
  const calls = await world($, on, repo({ hooks: true, background: true }))
  const ui = await gitPane($, 'terminal')
  await ui.input({ key: 'message', text: 'feat: slow hooks', kind: 'submit' })
  expect(calls.toasts.at(-1)).toBe('Commit is still running in the background; check the terminal.')
  expect((await ui.find({ type: 'Input', key: 'message' }))?.props.value).toBe('feat: slow hooks')
  // The file is left for the running commit.
  expect(calls.writes.at(-1)?.text).toBe('feat: slow hooks\n')
  await ui.input({ key: 'message', text: '', kind: 'change' })
  await ui.unmount()
})

test('the sensitive check reads a fresh snapshot, and Commit anyway covers only what was shown', async ($, on) => {
  const r = repo({ records: [CHANGED_USER] })
  const calls = await world($, on, r)
  const ui = await gitPane($, 'terminal')
  await ui.input({ key: 'message', text: 'feat: config', kind: 'change' })
  r.records = [CHANGED_USER, UNTRACKED_ENV] // changed on disk, not yet refreshed
  await ui.press({ key: 'commit' })
  expect(await ui.find({ type: 'Text', text: /These files look sensitive:/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\.env/ })).toBeDefined()
  expect(gitRuns(calls, 'commit')).toHaveLength(0)
  r.records = [CHANGED_USER, UNTRACKED_ENV, '? id_rsa'] // another one appears before the answer
  await ui.press({ key: 'sensitive-commit' })
  expect(gitRuns(calls, 'commit')).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /id_rsa/ })).toBeDefined()
  await ui.press({ key: 'sensitive-commit' })
  expect(gitRuns(calls, 'commit', 'feat: config')).toHaveLength(1)
  await ui.unmount()
})

test('the sensitive question lists every file, wrapped to the width', async ($, on) => {
  const names = ['.env', '.env.local', 'secrets/server.pem', 'keys/deploy.key', 'id_rsa', 'config/credentials.json']
  await world($, on, repo({ records: names.map((n) => `? ${n}`) }))
  const ui = await gitPane($, 'terminal', 40)
  await ui.input({ key: 'message', text: 'feat: keys', kind: 'submit' })
  const shown = (await ui.findAll({ type: 'Text' })).map((t) => t.text).join('\n')
  for (const n of names) expect(shown).toContain(n)
  for (const w of lineWidths((await ui.drawn()) as Node)) expect(w).toBeLessThanOrEqual(40)
  await ui.press({ key: 'sensitive-cancel' })
  await ui.input({ key: 'message', text: '', kind: 'change' })
  await ui.unmount()
})

test('Discard all says how many untracked files it deletes', async ($, on) => {
  await world($, on, repo({ records: [CHANGED_USER, UNTRACKED_ENV] }))
  const ui = await gitPane($, 'terminal')
  await ui.press({ key: 'discard-all' })
  expect(await ui.find({ type: 'Text', text: /Discard all changes \(2 files, 1 untracked will be deleted\)\?/ })).toBeDefined()
  await ui.press({ key: 'confirm-cancel' })
  await ui.unmount()
})

test('enter on a change opens its diff; back returns with the row selected', async ($, on) => {
  const calls = await world($, on, repo())
  for (const surface of SURFACES) {
    const ui = await gitPane($, surface)
    await ui.press({ key: 'change-src/api/user.ts' })
    const code = await ui.find({ type: 'Code' })
    expect(code?.props.format).toBe('diff')
    expect(code?.text).toContain('name: "Ana Rivera"')
    const head = (await ui.find({ key: 'header' }))?.text ?? ''
    expect(head).toContain('src/api/user.ts')
    expect(head).toContain('+2 −1')
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.press({ key: 'key-s' })
    await ui.unmount()
  }
  // The row was still the selection after back: s staged it, once per surface.
  expect(gitRuns(calls, 'add', 'src/api/user.ts')).toHaveLength(2)
})

test('diff keys: n and p jump between hunks, a hands a review to the prompt', async ($, on) => {
  const calls = await world($, on, repo())
  const tall = await gitPane($, 'terminal', 80)
  await tall.press({ key: 'change-src/api/user.ts' })
  await tall.unmount()
  // A short pane: the window holds one hunk at a time.
  const ui = await $.ui.mount({ plugin: 'jei', surface: 'terminal', component: 'Pane', props: paneProps(80, 8), requestId: 'jei' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('getUser')
  await ui.press({ key: 'key-n' })
  const second = (await ui.find({ type: 'Code' }))?.text ?? ''
  expect(second.startsWith('@@ -20,')).toBe(true)
  await ui.press({ key: 'key-p' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('getUser')
  await ui.press({ key: 'key-a' })
  expect(calls.fills.at(-1)?.text.startsWith('Review this diff of src/api/user.ts:')).toBe(true)
  expect(calls.fills.at(-1)!.text.length).toBeLessThanOrEqual(8000)
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('a long diff is cut at 5,000 lines and says so', async ($, on) => {
  await world($, on, repo({ diffLines: 5200 }))
  const ui = await gitPane($, 'terminal')
  await ui.press({ key: 'change-src/api/user.ts' })
  expect(await ui.find({ type: 'Text', text: /Diff truncated at 5,000 lines\./ })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.unmount()
})

test('no line is wider than the pane at 24, 40, 80 and 120 columns', async ($, on) => {
  await world($, on, repo({ hooks: true, records: [STAGED_INDEX, CHANGED_USER, UNTRACKED_ENV] }))
  for (const surface of SURFACES) {
    for (const width of WIDTHS) {
      const ui = await gitPane($, surface, width)
      const check = async () => {
        for (const w of lineWidths((await ui.drawn()) as Node)) expect(w).toBeLessThanOrEqual(width)
      }
      await check()
      expect(await ui.find({ key: 'change-src/api/user.ts' })).toBeDefined()
      // Every letter key stays pressable: on this host a key is a hint Button.
      for (const k of ['s', 'u', 'd', 'c', 'g', 'e']) expect(await ui.find({ key: `key-${k}` })).toBeDefined()
      await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'change-src/api/user.ts', origin: { kind: 'person' } } as never)
      await ui.press({ key: 'key-d' })
      await check()
      await ui.press({ key: 'confirm-cancel' })
      await ui.press({ key: 'change-src/api/user.ts' })
      await check()
      for (const k of ['n', 'p', 'j', 'k', 'a', 'o']) expect(await ui.find({ key: `key-${k}` })).toBeDefined()
      await ui.press({ key: 'back' })
      await ui.unmount()
    }
  }
})

/** The hint row as the terminal paints it. */
async function hintOf(ui: Ui): Promise<string> {
  const box = findKey((await ui.drawn()) as Node, 'hint')
  return box ? drawnLine(box) : ''
}

/** A plain hotkey Button with nothing after its colon (`g: ` then the end, another key or a separator). */
const dangling = (line: string) => /(^|\s)[a-z0-9]: (?=$|[a-z0-9]: |· |\[ )/.test(line)

test('the Git hint: labels while they fit, then keycaps, never a dangling key', async ($, on) => {
  await world($, on, repo())
  const expected: Record<number, string> = {
    120: ' ↑↓ move · enter open · s: stage · u: unstage · d: discard · c: commit · g: generate · e: sync',
    // The owner's docked pane: every letter label fits once the navigation words go bare.
    90: ' ↑↓ enter · s: stage · u: unstage · d: discard · c: commit · g: generate · e: sync',
    80: ' s: stage · u: unstage · d: discard · c: commit · g: generate · e: sync',
    // A labelled prefix, then the rest as keycaps after a separator.
    60: ' s: stage · u: unstage · d: discard · [ c ] [ g ] [ e ]',
    40: ' [ s ] [ u ] [ d ] [ c ] [ g ] [ e ]',
  }
  for (const [width, line] of Object.entries(expected)) {
    const ui = await gitPane($, 'terminal', Number(width))
    const hint = await hintOf(ui)
    expect(hint).toBe(line)
    expect(dangling(hint)).toBe(false)
    expect(hint.length).toBeLessThanOrEqual(Number(width) - 1)
    await ui.unmount()
  }
  // Too narrow for six keycaps: the keys stay pressable as a bare strip.
  const narrow = await gitPane($, 'terminal', 24)
  expect(await hintOf(narrow)).toBe(' s: u: d: c: g: e: ')
  await narrow.unmount()
  // Short panes are bare: keycaps, no labels.
  for (const width of [40, 80]) {
    const short = await gitPane($, 'terminal', width, 5)
    expect(await hintOf(short)).toBe(' [ s ] [ u ] [ d ] [ c ] [ g ] [ e ]')
    await short.unmount()
  }
  // The diff view follows the same forms.
  for (const [width, line] of [
    [40, ' [ n ] [ p ] [ j ] [ k ] [ a ] [ o ]'],
    [120, ' ↑↓ scroll · n: next hunk · p: prev hunk · j: next file · k: prev file · a: ask · o: open in editor'],
  ] as const) {
    const ui = await gitPane($, 'terminal', width)
    await ui.press({ key: 'change-src/api/user.ts' })
    expect(await hintOf(ui)).toBe(line)
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('the hint keeps every key and never drops one as the pane widens', async ($, on) => {
  await world($, on, repo())
  let last = 0
  for (let width = 24; width <= 130; width++) {
    const ui = await gitPane($, 'terminal', width)
    const hint = await hintOf(ui)
    expect(hint.length).toBeLessThanOrEqual(width - 1)
    if (width >= 32) expect(dangling(hint)).toBe(false)
    for (const k of ['s', 'u', 'd', 'c', 'g', 'e']) expect(await ui.find({ key: `key-${k}` })).toBeDefined()
    const count = (hint.match(/(^|\s|\[ )([a-z0-9]|↑↓|enter)(?=:| |$)/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(last)
    last = count
    await ui.unmount()
  }
})

test('short panes keep the selected change in view and the bare hint', async ($, on) => {
  await world($, on, repo())
  for (const rows of [9, 5]) {
    const ui = await gitPane($, 'terminal', 40, rows)
    await $.ui.focus({ component: 'Pane', requestId: 'jei', plugin: 'jei', element: 'change-src/api/user.ts', origin: { kind: 'person' } } as never)
    expect(await ui.find({ key: 'change-src/api/user.ts' })).toBeDefined()
    expect(await ui.find({ key: 'key-s' })).toBeDefined()
    await ui.unmount()
  }
})
