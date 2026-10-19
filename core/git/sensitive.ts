const EXACT = new Set(['.env', 'credentials.json', '.npmrc', '.netrc'])
const TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SUFFIXES = ['.pem', '.key', '.p12', '.pfx']
const PREFIXES = ['.env.', 'id_rsa', 'id_ed25519']

function isSensitive(path: string): boolean {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  if (TEMPLATES.has(name)) return false
  return EXACT.has(name) || SUFFIXES.some((s) => name.endsWith(s)) || PREFIXES.some((p) => name.startsWith(p))
}

/** Paths that look like secrets (matched on the basename, case-insensitive). Committed env templates are excluded. */
export function sensitivePaths(paths: readonly string[]): string[] {
  return paths.filter(isSensitive)
}
