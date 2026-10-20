export type RefBadge = { kind: 'head' | 'local' | 'remote' | 'tag'; name: string }
export type LogCommit = { hash: string; parents: string[]; author: string; time: number; refs: RefBadge[]; subject: string }
export type GraphFilter = { message?: string; author?: string; path?: string; branch?: string | 'all' }

export function parseGraphFilter(text: string): GraphFilter {
  const filter: GraphFilter = {}
  const message: string[] = []
  for (const raw of text.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []) {
    const token = raw.replace(/(["'])(.*?)\1/g, '$2')
    const field = /^(author|path|branch):(.+)$/.exec(token)
    if (field) {
      const key = field[1] as 'author' | 'path' | 'branch'
      filter[key] = key === 'branch' && field[2] === '*' ? 'all' : field[2]!
    } else message.push(token)
  }
  if (message.length > 0) filter.message = message.join(' ')
  return filter
}

export function logArgs(filter: GraphFilter, count: number): string[] {
  const args = ['log', '--topo-order', '--no-color', '-z', '--format=%H%x00%P%x00%an%x00%at%x00%D%x00%s', '--decorate=full', '-n', String(count + 1)]
  if (filter.message !== undefined || filter.author !== undefined) args.push('--fixed-strings', '-i')
  if (filter.message !== undefined) args.push(`--grep=${filter.message}`)
  if (filter.author !== undefined) args.push(`--author=${filter.author}`)
  if (filter.branch === 'all') args.push('--all')
  else if (filter.branch !== undefined) args.push('--end-of-options', filter.branch)
  if (filter.path !== undefined) args.push('--', filter.path)
  return args
}

function badges(text: string): RefBadge[] {
  const refs: RefBadge[] = []
  for (let name of text.split(', ')) {
    if (name.startsWith('HEAD -> ')) {
      refs.push({ kind: 'head', name: 'HEAD' })
      name = name.slice(8)
    } else if (name === 'HEAD') {
      refs.push({ kind: 'head', name }); continue
    }
    if (!name || name === 'origin/HEAD' || /^refs\/remotes\/[^/]+\/HEAD$/.test(name)) continue
    if (name.startsWith('tag: ')) refs.push({ kind: 'tag', name: name.slice(5).replace(/^refs\/tags\//, '') })
    else if (name.startsWith('refs/remotes/')) refs.push({ kind: 'remote', name: name.slice(13) })
    else if (name.startsWith('refs/heads/')) refs.push({ kind: 'local', name: name.slice(11) })
    else refs.push({ kind: name.startsWith('origin/') ? 'remote' : 'local', name })
  }
  return refs
}

export function parseLog(stdout: string): LogCommit[] {
  const fields = stdout.split('\0')
  const commits: LogCommit[] = []
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const [hash, parents, author, time, refs, subject] = fields.slice(i, i + 6) as [string, string, string, string, string, string]
    if (!/^[0-9a-f]{40}$/.test(hash) || !/^\d+$/.test(time)) continue
    commits.push({ hash, parents: parents ? parents.split(' ') : [], author, time: Number(time), refs: badges(refs), subject })
  }
  return commits
}

export function isMerge(commit: LogCommit): boolean {
  return commit.parents.length >= 2
}
