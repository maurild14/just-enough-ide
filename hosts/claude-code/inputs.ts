// Native fields retain local edits until their value prop changes. Keep that seed
// stable during editing so asynchronous state redraws cannot overwrite newer keys.
const seeds = new Map<string, string>()
const generations = new Map<string, number>()
let focused: string | undefined

export function inputId(key: string | undefined): string | undefined {
  return key?.replace(/^(filter|message|files-operation-input|search-(?:query|globs|replacement)|new-branch|graph-filter|branch-filter)::\d+$/, '$1')
}

export function inputKey(key: string): string {
  const generation = generations.get(key)
  return generation === undefined ? key : `${key}::${generation}`
}

export function focusInput(key: string | undefined): void {
  key = inputId(key)
  if (key && /^(?:files|search)-(?:cancel|clear)$/.test(key)) return
  focused = key
}

export function inputValue(key: string, value: string): string {
  if (focused !== key || !seeds.has(key)) seeds.set(key, value)
  return seeds.get(key)!
}

export function resetInput(key: string): void {
  seeds.delete(key)
  generations.set(key, (generations.get(key) ?? 0) + 1)
}

export function resetInputs(): void { focused = undefined; seeds.clear() }
