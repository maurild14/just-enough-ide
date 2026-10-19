export type PreviewKind = 'code' | 'markdown' | 'csv' | 'tsv' | 'image' | 'binary' | 'too-large' | 'empty' | 'error'

export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

const SNIFF_BYTES = 8192
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tif', 'tiff'])
const MARKDOWN = new Set(['md', 'markdown', 'mdx'])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function previewKind(name: string, size: number, head: Uint8Array): PreviewKind {
  if (size === 0) return 'empty'
  const ext = extOf(name)
  if (IMAGES.has(ext)) return 'image'
  if (size > PREVIEW_MAX_BYTES) return 'too-large'
  if (head.subarray(0, SNIFF_BYTES).includes(0)) return 'binary'
  if (MARKDOWN.has(ext)) return 'markdown'
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv') return 'tsv'
  return 'code'
}

const BY_EXT: Readonly<Record<string, string>> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'json', md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', lua: 'lua',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', xml: 'xml', svg: 'xml',
  sql: 'sql', diff: 'diff', patch: 'diff', csv: 'csv', tsv: 'tsv', txt: 'text',
}

const BY_NAME: Readonly<Record<string, string>> = { dockerfile: 'dockerfile', makefile: 'makefile' }

/** Highlight language id for a file name, or undefined when unknown. */
export function languageOf(name: string): string | undefined {
  const lower = name.toLowerCase()
  return BY_NAME[lower] ?? (BY_EXT[extOf(name)] || undefined)
}
