/**
 * 星系 —— 自定义题板支持（cell 模式：标记格心圆点）
 *
 * 编辑器里每格两种状态：
 *   null = 空
 *   1    = 这一格中心有一个圆点
 *
 * 编辑器约定：点击循环空 ↔ 圆点；数字键 1 放圆点、0/退格/Delete 清空；
 * 方向键移动光标。提交后按「每个格心圆点一个区域」生成题目。
 *
 * 说明：自定义题板只放「格心圆点」；内置题还支持「格点圆点」（2×2 四格锚定），
 * 这类内置题不在编辑器里编辑。
 */

import type { CustomSupport, Puzzle } from '../core/types'
import {
  asGalaxyPuzzle,
  formatDots,
  isCenterDot,
  parseDots,
  type GalaxyDot,
  type GalaxyPuzzle,
} from './types'

export const CUSTOM_ID_PREFIX = 'galaxies-custom-'

/** 编辑器网格 → 圆点（值 1 表示格心圆点） */
export function gridToDots(
  w: number,
  h: number,
  grid: ReadonlyArray<number | null>,
): GalaxyDot[] | null {
  if (grid.length !== w * h) return null
  const dots: GalaxyDot[] = []
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] == null) continue
    const x = i % w
    const y = (i / w) | 0
    dots.push({ x: 2 * x + 1, y: 2 * y + 1 })
  }
  if (dots.length === 0) return null
  return dots
}

/** 题面 → 编辑器网格；含格点圆点时无法用格心编辑器表达，返回 null */
export function dotsToGrid(
  puzzle: Puzzle,
): { width: number; height: number; grid: Array<number | null> } | null {
  const p = asGalaxyPuzzle(puzzle)
  if (!Array.isArray(p.dots) || p.dots.length === 0) return null
  const size = p.width * p.height
  const grid = new Array<number | null>(size).fill(null)
  for (const dot of p.dots) {
    if (!isCenterDot(dot)) return null
    const x = (dot.x - 1) / 2
    const y = (dot.y - 1) / 2
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return null
    if (grid[y * p.width + x] != null) return null
    grid[y * p.width + x] = 1
  }
  return { width: p.width, height: p.height, grid }
}

export function makePuzzleFromDots(
  w: number,
  h: number,
  dots: GalaxyDot[],
  existingId?: string,
): GalaxyPuzzle | null {
  for (const dot of dots) {
    if (!isCenterDot(dot)) return null
    if (dot.x < 0 || dot.y < 0 || dot.x > 2 * w || dot.y > 2 * h) return null
  }
  return {
    id: existingId ?? `${CUSTOM_ID_PREFIX}${w}x${h}`,
    name: `自定义 · ${w}×${h}`,
    width: w,
    height: h,
    difficulty: 'custom',
    dots: dots.map((d) => ({ ...d })),
  }
}

export const custom: CustomSupport = {
  mode: 'cell',

  valueCycle: [null, 1],

  keyForDigit: (digit) => {
    if (digit === 1) return 1
    if (digit === 0) return null
    return undefined
  },

  cellLabel: (v) => (v == null ? '空' : '●'),

  hint: '点击格子放/去圆点（数字键 1 放圆点，0/退格清空，方向键移动）。载入后按「每个圆点一个 180° 对称区域」求解。',

  toGrid: (p) => dotsToGrid(p),

  makePuzzle: (w, h, grid, existingId) => {
    const dots = gridToDots(w, h, grid) ?? []
    const p = makePuzzleFromDots(w, h, dots, existingId)
    if (p) return p
    // 没有圆点也允许载入（棋盘为空，提示用户继续放圆点）
    return {
      id: existingId ?? `${CUSTOM_ID_PREFIX}${w}x${h}`,
      name: `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      dots: [],
    } satisfies GalaxyPuzzle
  },

  encodePuzzle: (p) => ({
    dots: formatDots(asGalaxyPuzzle(p).dots ?? []),
  }),

  decodePuzzle: (record) => {
    if (typeof record.id !== 'string') return null
    if (typeof record.width !== 'number' || typeof record.height !== 'number') return null
    const w = record.width
    const h = record.height
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return null
    const dotsText = typeof record.dots === 'string' ? record.dots : ''
    const parsed = parseDots(dotsText) ?? []
    const dots = parsed.filter(
      (d) => isCenterDot(d) && d.x >= 0 && d.y >= 0 && d.x <= 2 * w && d.y <= 2 * h,
    )
    return {
      id: record.id,
      name: typeof record.name === 'string' ? record.name : `自定义 · ${w}×${h}`,
      width: w,
      height: h,
      difficulty: 'custom',
      dots: dots.map((d) => ({ ...d })),
    } satisfies GalaxyPuzzle
  },
}
