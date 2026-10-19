import type { Tab } from './keys.ts'
import { toPosix } from './shared/paths.ts'

const TABS: readonly Tab[] = ['files', 'search', 'symbols', 'git']

/** Parse the argument of `/jei`: empty toggles, a tab name opens it, anything else reveals a path in Files. */
export function parseJeiArgument(arg: string): { tab?: Tab; reveal?: string; toggle: boolean } {
  const text = arg.trim()
  if (text === '') return { toggle: true }
  const name = text.toLowerCase()
  const tab = TABS.find((t) => t === name)
  if (tab) return { tab, toggle: false }
  const reveal = toPosix(text).replace(/^(\.\/)+/, '')
  return { tab: 'files', reveal, toggle: false }
}
