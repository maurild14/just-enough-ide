import type { Options } from '../options.ts'

const NERD_DIR = ''
const NERD_DIR_OPEN = ''
const NERD_DEFAULT = ''
const NERD_BY_EXT: Readonly<Record<string, string>> = {
  ts: '',
  tsx: '',
  js: '',
  jsx: '',
  mjs: '',
  cjs: '',
  json: '',
  md: '',
  py: '',
  go: '',
  rs: '',
}

/**
 * One-cell icon for a tree row. `plain` and `auto` use Unicode (`auto` means
 * plain in 0.1: there is no reliable Nerd Font detection yet). Hosts only ask
 * for `nerd` at widths of 60 and up (docs/design.md section 5).
 */
export function iconFor(name: string, isDir: boolean, isExpanded: boolean, glyphs: Options['glyphs']): string {
  if (glyphs !== 'nerd') return isDir ? (isExpanded ? '▾' : '▸') : '·'
  if (isDir) return isExpanded ? NERD_DIR_OPEN : NERD_DIR
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  return NERD_BY_EXT[ext] ?? NERD_DEFAULT
}
