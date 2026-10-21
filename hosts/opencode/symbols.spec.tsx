import { expect, test } from 'bun:test'
import { input, searchFixture } from '../../test/opencode-search.tsx'
import { paneMemory } from './pane.tsx'

const load = { name: 'load', kind: 'function', line: 2, endLine: 3, children: [] }
const save = { name: 'save', kind: 'function', line: 4, endLine: 5, children: [] }
const ref = (name = 'load', line = 2) => ({ rel: 'src/app.ts', line, text: `export function ${name}() {}`, container: null })
function fixture() {
  const f = searchFixture()
  f.handlers.outline = async () => ({ file: true, nodes: [load, save] })
  f.handlers.findSymbol = async () => ({ refs: [ref('save', 4)] })
  f.handlers.references = async i => ({ refs: [ref(i.name, i.name === 'load' ? 3 : 5)] })
  f.handlers.definitions = async () => ({ refs: [ref()] })
  f.handlers.incoming = async () => ({ refs: [ref('save', 4)] })
  f.handlers.outgoing = async () => ({ refs: [ref('save', 4)] })
  return f
}

test('activity and changed outline reloads cannot cancel a pending Symbols operation', async () => {
  const f = fixture(), r = await f.mount(); f.emit('activity', { rel: 'src/app.ts', kind: 'read' }); f.key('2'); await r.flush()
  let finish!: (value: unknown) => void, signal: AbortSignal | undefined
  f.handlers.references = (_input, options) => { signal = options?.signal; return new Promise(resolve => { finish = resolve }) }
  f.key('r'); await r.flush(); expect(signal?.aborted).toBe(false)
  f.emit('activity', { rel: 'src/save.ts', kind: 'write' }); await r.flush(); f.changed(); await r.flush()
  expect(signal?.aborted).toBe(false)
  finish({ refs: [ref('load', 3)] }); await r.flush()
  expect(r.captureCharFrame()).toContain('References: load'); expect(r.captureCharFrame()).toContain('3:')
})

test('background outline loading permits Find and both lifecycles abort on a tab switch', async () => {
  const f = fixture(), r = await f.mount(); let outlineSignal: AbortSignal | undefined, findSignal: AbortSignal | undefined
  f.handlers.outline = (_input, options) => { outlineSignal = options?.signal; return new Promise(() => {}) }
  f.handlers.findSymbol = (_input, options) => { findSignal = options?.signal; return new Promise(() => {}) }
  f.emit('activity', { rel: 'src/app.ts', kind: 'read' }); f.key('2'); await r.flush()
  expect(r.captureCharFrame()).toContain('Loading…')
  f.key('f'); await r.flush(); expect(input(r, 'symbols-find')).toBeDefined()
  input(r, 'symbols-find').insertText('load'); input(r, 'symbols-find').submit(); await r.flush()
  expect(findSignal?.aborted).toBe(false); expect(outlineSignal?.aborted).toBe(false)
  f.key('3'); await r.flush()
  expect(findSignal?.aborted).toBe(true); expect(outlineSignal?.aborted).toBe(true)
})

for (const width of [24, 40, 80, 120]) test(`Symbols displays a native approximate outline at ${width}x5`, async () => {
  const f = searchFixture()
  f.handlers.outline = async () => ({ file: true, nodes: [{ name: 'load', kind: 'function', line: 2, endLine: 2, children: [] }] })
  const r = await f.mount(width, 5); f.emit('activity', { rel: 'src/app.ts', kind: 'read' }); f.key('2'); await r.flush()
  expect(r.captureCharFrame()).toContain('approximate')
  expect(r.captureCharFrame()).toContain('load')
  f.key('enter'); await r.flush(); expect(r.captureCharFrame()).toContain('>')
  f.key('q'); await r.flush(); expect(r.captureCharFrame()).toContain('approximate')
})

test('Symbols references, definitions, workspace and selected call-child Send keep their actual subject', async () => {
  const f = fixture(), r = await f.mount(); f.emit('activity', { rel: 'src/app.ts', kind: 'read' }); f.key('2'); await r.flush()
  f.key('r'); await r.flush(); expect(r.captureCharFrame()).toContain('References: load'); f.key('a'); await r.flush()
  expect(f.prompts.at(-1).value).toBe('load (src/app.ts:2) and its 1 references: src/app.ts:3')
  f.key('q'); await r.flush(); f.key('d'); await r.flush(); expect(r.captureCharFrame()).toContain('>'); f.key('q'); await r.flush()
  f.key('f'); await r.flush(); await r.mockInput.typeText('save'); input(r, 'symbols-find').submit(); await r.flush(); f.key('a'); await r.flush()
  expect(f.prompts.at(-1).value).toBe('save (src/app.ts:4) and its 1 references: src/app.ts:5')
  f.key('q'); await r.flush(); f.key('c'); await r.flush(); expect(r.captureCharFrame()).toContain('Callers'); expect(r.captureCharFrame()).toContain('Calls')
  f.key('enter'); await r.flush(); f.key('down'); f.key('a'); await r.flush()
  expect(f.prompts.at(-1).value).toBe('save (src/app.ts:4) and its 1 references: src/app.ts:5')
  f.key('enter'); await r.flush(); expect(f.calls.filter(c => c.method === 'incoming').at(-1)?.input).toEqual({ name: 'save' })
})

test('pending Symbols work is canceled across tab/preview/editor transitions without stuck busy or stale results', async () => {
  const f = fixture(), r = await f.mount(); f.emit('activity', { rel: 'src/app.ts', kind: 'read' }); f.key('2'); await r.flush()
  let release!: (value: unknown) => void
  f.handlers.findSymbol = () => new Promise(resolve => { release = resolve })
  f.key('f'); await r.flush(); await r.mockInput.typeText('old'); input(r, 'symbols-find').submit(); await r.flush()
  f.key('3'); await r.flush(); f.key('2'); await r.flush(); release({ refs: [ref('OLD', 99)] }); await r.flush()
  expect(r.captureCharFrame()).not.toContain('OLD')
  f.handlers.findSymbol = async () => ({ refs: [ref('save', 4)] }); f.key('f'); await r.flush(); input(r, 'symbols-find').value = ''; await r.mockInput.typeText('save'); input(r, 'symbols-find').submit(); await r.flush()
  expect(r.captureCharFrame()).toContain('Symbols: save')
  f.key('q'); await r.flush(); f.handlers.findSymbol = () => new Promise(resolve => { release = resolve }); f.key('f'); await r.flush(); input(r, 'symbols-find').submit(); await r.flush()
  f.key('up'); f.key('enter'); await r.flush(); release({ refs: [ref('LATE', 99)] }); await r.flush(); expect(r.captureCharFrame()).toContain('>'); expect(r.captureCharFrame()).not.toContain('LATE')
  f.key('q'); await r.flush(); f.key('r'); await r.flush(); expect(r.captureCharFrame()).toContain('References: load')
})

test('directory selection falls back to the latest touched file, unsupported files stay selected and read failures show errors', async () => {
  const f = fixture(); f.handlers.outline = async i => i.rel === 'src' ? { file: false, nodes: null } : i.rel === 'notes.txt' ? { file: true, nodes: null } : { file: true, nodes: [save] }
  const r = await f.mount(); f.emit('activity', { rel: 'src/app.ts', kind: 'read' }); const [, update] = paneMemory(f.ctx); update(d => { d.panes['session-a']!.selected.files = 'src' }); f.key('2'); await r.flush()
  expect(r.captureCharFrame()).toContain('save')
  update(d => { d.panes['session-a']!.selected.files = 'notes.txt' }); await r.flush(); expect(r.captureCharFrame()).toContain('No outline for this file type.')
  f.handlers.outline = async () => { throw new Error("Can't read this file.") }; f.changed(); await r.flush(); expect(r.captureCharFrame()).toContain("Can't read this file.")
})

test('Symbols preserves client error objects first-line messages and unknown-error fallback', async () => {
  const f = fixture(); f.handlers.outline = async () => { throw { type: 'internal', message: "Can't read this file.\nInternal details." } }
  const r = await f.mount(); f.emit('activity', { rel: 'src/app.ts', kind: 'read' }); f.key('2'); await r.flush()
  expect(r.captureCharFrame()).toContain("Can't read this file."); expect(r.captureCharFrame()).not.toContain('Internal details.')
  f.handlers.outline = async () => ({ file: true, nodes: [load] }); f.changed(); await r.flush()
  f.handlers.references = async () => { throw { type: 'refused', message: 'Reference lookup failed.\nInternal details.', data: {} } }; f.key('r'); await r.flush()
  expect(f.notices.at(-1)).toEqual({ message: 'Reference lookup failed.', variant: 'error' })
  f.handlers.references = async () => { throw { type: 'internal' } }; f.key('r'); await r.flush()
  expect(f.notices.at(-1)).toEqual({ message: 'Unable to complete Symbols.', variant: 'error' })
})
