// Display-width helpers shared by both hosts so no row ever overflows its pane.
// Widths are in terminal cells: East Asian wide/fullwidth and emoji take 2,
// combining marks and joiners take 0, everything else takes 1. The tables are
// deliberately compact, not a full wcwidth.

type Range = readonly [number, number]

const ZERO: readonly Range[] = [
  [0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x05bf, 0x05bf], [0x05c1, 0x05c2],
  [0x05c4, 0x05c5], [0x05c7, 0x05c7], [0x0610, 0x061a], [0x064b, 0x065f], [0x0670, 0x0670],
  [0x06d6, 0x06dc], [0x06df, 0x06e4], [0x06e7, 0x06e8], [0x06ea, 0x06ed], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2060, 0x2064], [0x20d0, 0x20ff], [0x3099, 0x309a], [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f], [0xfeff, 0xfeff], [0xe0100, 0xe01ef],
]

const WIDE: readonly Range[] = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f],
  [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a],
  [0x1f200, 0x1f2ff], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f9ff], [0x1fa70, 0x1faff], [0x20000, 0x3fffd],
]

function inRanges(cp: number, table: readonly Range[]): boolean {
  let lo = 0
  let hi = table.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const [a, b] = table[mid]!
    if (cp < a) hi = mid - 1
    else if (cp > b) lo = mid + 1
    else return true
  }
  return false
}

function cpWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (cp < 0x300) return 1
  if (inRanges(cp, ZERO)) return 0
  return inRanges(cp, WIDE) ? 2 : 1
}

/** Display width in terminal cells. */
export function cellWidth(s: string): number {
  let w = 0
  for (const ch of s) w += cpWidth(ch.codePointAt(0)!)
  return w
}

/** Longest leading part that fits in `width` cells (trailing zero-width marks stay with their base). */
function takeStart(s: string, width: number): string {
  let used = 0
  let out = ''
  for (const ch of s) {
    const w = cpWidth(ch.codePointAt(0)!)
    if (used + w > width) break
    used += w
    out += ch
  }
  return out
}

/** Pad with spaces to `width` cells. Never truncates: a wider string comes back unchanged. */
export function padEnd(s: string, width: number): string {
  const gap = width - cellWidth(s)
  return gap > 0 ? s + ' '.repeat(gap) : s
}

/** End ellipsis. The result is at most `width` cells; the ellipsis follows the active glyph set. */
export function fitEnd(s: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return ''
  if (cellWidth(s) <= width) return s
  const ew = cellWidth(ellipsis)
  if (width < ew) return takeStart(ellipsis, width)
  return takeStart(s, width - ew) + ellipsis
}

/**
 * Path with a middle ellipsis that keeps the whole file name (`src/…/user.ts`).
 * When the name alone does not fit, the name gets an end ellipsis that keeps
 * the extension where possible (`very-long-na….ts`). At most `width` cells.
 */
export function fitPath(rel: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return ''
  if (cellWidth(rel) <= width) return rel
  const cut = rel.lastIndexOf('/')
  const name = rel.slice(cut + 1)
  if (cut >= 0) {
    const nameW = cellWidth(name)
    const ew = cellWidth(ellipsis)
    const dirs = rel.slice(0, cut).split('/')
    for (let k = dirs.length - 1; k >= 0; k--) {
      const head = dirs.slice(0, k).join('/')
      const headW = k === 0 ? 0 : cellWidth(head) + 1
      if (headW + ew + 1 + nameW <= width) return `${k === 0 ? '' : `${head}/`}${ellipsis}/${name}`
    }
  }
  if (cellWidth(name) <= width) return name
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    const ext = name.slice(dot)
    const room = width - cellWidth(ext)
    if (room >= cellWidth(ellipsis) + 1) return fitEnd(name.slice(0, dot), room, ellipsis) + ext
  }
  return fitEnd(name, width, ellipsis)
}
