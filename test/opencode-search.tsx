import { InputRenderable } from '@opentui/core'
import { historyFixture } from './opencode-history.tsx'

export function searchFixture() {
  const f = historyFixture()
  f.handlers.quickOpenFiles = async () => ({ files: ['src/app.ts', 'src/save.ts'] })
  f.handlers.preview = async () => ({ kind: 'code', text: 'before\nexport function load() {}\nafter\n', language: 'typescript' })
  f.handlers.listDir = async () => ({ entries: [], ignored: [] })
  return f
}
export const input = (r: Awaited<ReturnType<ReturnType<typeof historyFixture>['mount']>>, id = 'search-query') => r.renderer.root.findDescendantById(id) as InputRenderable
export async function settle(r: { flush(): Promise<void> }) { await new Promise(resolve => setTimeout(resolve, 180)); await r.flush() }
