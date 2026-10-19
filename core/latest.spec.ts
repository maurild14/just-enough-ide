import { expect, test } from 'bun:test'
import { latest } from './latest.ts'

const defer = <T>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => ((resolve = a), (reject = b)))
  return { promise, resolve, reject }
}

test('the earlier call goes stale when the later one is issued', async () => {
  const d = [defer<string>(), defer<string>()]
  let i = 0
  const f = latest(() => d[i++]!.promise)
  const first = f()
  const second = f()
  d[1]!.resolve('b')
  d[0]!.resolve('a')
  expect(await first).toEqual({ stale: true })
  expect(await second).toEqual({ value: 'b', stale: false })
})

test('a rejected stale call resolves stale; a rejected latest call rejects', async () => {
  const d = [defer<string>(), defer<string>()]
  let i = 0
  const f = latest(() => d[i++]!.promise)
  const first = f()
  const second = f()
  d[0]!.reject(new Error('old'))
  expect(await first).toEqual({ stale: true })
  d[1]!.reject(new Error('new'))
  await expect(second).rejects.toThrow('new')
})
