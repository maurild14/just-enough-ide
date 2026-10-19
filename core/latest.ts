/**
 * Refresh guard: only the most recently started call counts. An earlier call
 * resolves `{ stale: true }` whether it succeeded or failed; the latest call
 * rejects when `fn` rejects.
 */
export function latest<A extends unknown[], R>(
  fn: (...a: A) => Promise<R>,
): (...a: A) => Promise<{ value: R; stale: false } | { stale: true }> {
  let generation = 0
  return async (...a: A) => {
    const mine = ++generation
    try {
      const value = await fn(...a)
      return mine === generation ? { value, stale: false } : { stale: true }
    } catch (error) {
      if (mine !== generation) return { stale: true }
      throw error
    }
  }
}
