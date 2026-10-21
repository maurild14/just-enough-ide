// Native fields retain local edits until their value prop changes. Keep that seed
// stable during editing so asynchronous state redraws cannot overwrite newer keys.
const seeds = new Map<string, string>()
let focused: string | undefined

export function focusInput(key: string | undefined): void {
  if (key && /^(?:files|search)-(?:cancel|clear)$/.test(key)) return
  focused = key
}

export function inputValue(key: string, value: string): string {
  if (focused !== key || !seeds.has(key)) seeds.set(key, value)
  return seeds.get(key)!
}

export function resetInput(key: string): void { seeds.delete(key) }

export function resetInputs(): void { focused = undefined; seeds.clear() }
