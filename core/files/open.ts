import type { Platform } from '../host.ts'
import { splitCommand } from '../shared/argv.ts'

const OS_OPENER: Readonly<Record<Platform, string>> = { win32: 'explorer.exe', darwin: 'open', linux: 'xdg-open' }

const sub = (word: string, token: string, value: string): string => word.split(token).join(value)

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
