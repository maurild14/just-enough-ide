import type { Platform } from '../host.ts'
import { splitCommand } from '../shared/argv.ts'

const OS_OPENER: Readonly<Record<Platform, string>> = { win32: 'explorer.exe', darwin: 'open', linux: 'xdg-open' }

export function openUrlArgv(url: string, platform: Platform): string[] | null {
  return /^https:\/\/[^\s/@?#\\]+(?:\/[^\s\\]*)?$/.test(url) ? [OS_OPENER[platform], url] : null
}

const sub = (word: string, token: string, value: string): string => word.split(token).join(value)

export const OPEN_REFUSED = 'Set editorCommand to open this file type.'

// ponytail: a denylist of the types the OS openers run instead of showing (Windows, macOS, Linux
// desktops). Its ceiling: a runnable type missing here still reaches the OS opener. An allowlist is
// the next step if that ever matters; a set `editorCommand` bypasses the list entirely.
const RUNNABLE = new Set([
  'exe', 'bat', 'cmd', 'com', 'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'vb', 'js', 'jse', 'wsf', 'wsh', 'ws', 'msi', 'msp', 'msc', 'scr', 'pif',
  'lnk', 'url', 'scf', 'inf', 'reg', 'hta', 'cpl', 'jar', 'application', 'appref-ms', 'settingcontent-ms',
  'sh', 'command', 'tool', 'terminal', 'workflow', 'app', 'desktop', 'appimage',
])

/**
 * Why the file must not go to the OS opener, or null. Only an empty `editorCommand` (the OS opener)
 * refuses: the extension is read case-insensitively, after the trailing dots and spaces Windows drops.
 */
export function openRefusal(input: { editorCommand: string; path: string }): string | null {
  if (splitCommand(input.editorCommand).length > 0) return null
  const name = (input.path.split(/[\\/]/).pop() ?? '').replace(/[. ]+$/, '')
  const dot = name.lastIndexOf('.')
  return dot > 0 && RUNNABLE.has(name.slice(dot + 1).toLowerCase()) ? OPEN_REFUSED : null
}

/**
 * argv to open a file. An empty command uses the OS opener. Otherwise the command
 * is split into words; `{path}` and `{line}` are replaced inside a word (the rest
 * of the word is kept), and the path is appended when no word has `{path}`.
 * Without a line, `:{line}` is stripped from a word that has `{path}`, and a word
 * without `{path}` that carries `{line}` is dropped.
 */
export function openArgv(input: { editorCommand: string; path: string; line?: number; platform: Platform }): string[] {
  const { path, line, platform } = input
  const words = splitCommand(input.editorCommand)
  if (words.length === 0) return [OS_OPENER[platform], path]

  const hasPath = words.some((w) => w.includes('{path}'))
  const out: string[] = []
  for (const original of words) {
    let w = original
    if (w.includes('{line}')) {
      if (line !== undefined) w = sub(w, '{line}', String(line))
      else if (!w.includes('{path}')) continue
      else w = sub(sub(w, ':{line}', ''), '{line}', '')
    }
    out.push(sub(w, '{path}', path))
  }
  if (!hasPath) out.push(path)
  return out
}
