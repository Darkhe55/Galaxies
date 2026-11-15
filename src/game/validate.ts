/**
 * 星系 —— 实时校验
 *
 * 校验逻辑：
 *  1. 由「未画边界的相邻关系」把棋盘并成若干连通块（区域）；
 *  2. 每个区域必须恰好包含一个圆点；
 *  3. 区域必须关于自己的圆点 180° 旋转对称（每格旋转后的格子仍在同一区域）；
 *  4. 所有格子天然被覆盖、区域天然互不重叠（由状态结构保证）。
 *
 * 高亮策略（画到一半时不用整盘爆红）：
 *  - 一条边界都没画：不标错误，状态栏提示「开始画区域边界」；
 *  - 含 1 个圆点但不对称的区域 → 红色错误（该区域当前形状是错的）；
 *  - 圆点被边界切成两半 → 圆点附近红色；
 *  - 含 0 个或多于 1 个圆点的区域 → 淡黄提示（还需要继续画/合并）。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { edgeCells, edgeCount } from '../core/board'
import {
  asGalaxyPuzzle,
  asGalaxyState,
  dotAnchors,
  mirrorCell,
  OPEN,
  WALL,
  type GalaxyResult,
} from './types'

export interface RegionMap {
  regionOf: Int32Array
  regionCount: number
  cellsByRegion: number[][]
}

/** 由边状态求连通块（区域）划分 */
export function regionsFromEdges(
  w: number,
  h: number,
  edges: ArrayLike<number>,
): RegionMap {
  const size = w * h
  const parent = new Int32Array(size)
  for (let i = 0; i < size; i++) parent[i] = i
  const find = (a: number): number => {
    let r = a
    while (parent[r] !== r) r = parent[r]!
    while (parent[a] !== r) {
      const next = parent[a]!
      parent[a] = r
      a = next
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }

  const total = edgeCount(w, h)
  const count = Math.min(total, edges.length)
  for (let e = 0; e < count; e++) {
    if ((edges[e] ?? OPEN) === WALL) continue
    const pair = edgeCells(e, w, h)
    if (!pair) continue
    union(pair.a, pair.b)
  }

  const regionOf = new Int32Array(size).fill(-1)
  const idOfRoot = new Map<number, number>()
  const cellsByRegion: number[][] = []
  for (let i = 0; i < size; i++) {
    const root = find(i)
    let id = idOfRoot.get(root)
    if (id === undefined) {
      id = cellsByRegion.length
      idOfRoot.set(root, id)
      cellsByRegion.push([])
    }
    regionOf[i] = id
    cellsByRegion[id]!.push(i)
  }
  return { regionOf, regionCount: cellsByRegion.length, cellsByRegion }
}

interface DotPlacement {
  /** 圆点所在区域号；-1 = 圆点被切开或非法 */
  region: number
  /** 圆点的锚定格 */
  anchors: number[]
  /** 锚定格被切到多个区域（圆点落在边界上） */
  split: boolean
}

export function analyze(puzzle: Puzzle, edges: ArrayLike<number>): GalaxyResult {
  const p = asGalaxyPuzzle(puzzle)
  const w = p.width
  const h = p.height
  const dots = p.dots ?? []
  const total = edgeCount(w, h)

  const { regionOf, regionCount, cellsByRegion } = regionsFromEdges(w, h, edges)

  let edgeOn = 0
  const edgeTotal = total
  for (let e = 0; e < Math.min(total, edges.length); e++) {
    if ((edges[e] ?? OPEN) === WALL) edgeOn++
  }

  // —— 每个圆点归属哪个区域 ——
  const placements: DotPlacement[] = []
  const dotCountByRegion = new Int32Array(regionCount)
  const splitDots: number[] = []
  for (let d = 0; d < dots.length; d++) {
    const anchors = dotAnchors(w, h, dots[d]!)
    if (anchors.length === 0) {
      placements.push({ region: -1, anchors: [], split: true })
      splitDots.push(d)
      continue
    }
    const r0 = regionOf[anchors[0]!]!
    let split = false
    for (const a of anchors) {
      if (regionOf[a] !== r0) {
        split = true
        break
      }
    }
    if (split || r0 < 0) {
      placements.push({ region: -1, anchors, split: true })
      splitDots.push(d)
    } else {
      placements.push({ region: r0, anchors, split: false })
      dotCountByRegion[r0] = (dotCountByRegion[r0] ?? 0) + 1
    }
  }

  const bad = new Set<number>()
  const warn = new Set<number>()
  const badDots = new Set<number>()
  const warnDots = new Set<number>()
  let goodRegions = 0
  let warnRegions = 0
  let badRegions = 0

  for (let r = 0; r < regionCount; r++) {
    const cells = cellsByRegion[r] ?? []
    const dotsHere = dotCountByRegion[r] ?? 0
    if (dotsHere === 1) {
      const dotIndex = placements.findIndex((pl) => pl.region === r)
      const dot = dots[dotIndex]!
      let symmetric = true
      for (const c of cells) {
        const m = mirrorCell(w, h, dot, c)
        if (m < 0 || regionOf[m] !== r) {
          symmetric = false
          bad.add(c)
          if (m >= 0) bad.add(m)
        }
      }
      if (symmetric) {
        goodRegions++
      } else {
        badRegions++
        for (const c of cells) bad.add(c)
        badDots.add(dotIndex)
      }
    } else if (dotsHere > 1) {
      // 一个区域里有多个圆点：一定还没分完，用橙色圆点提示（不整片涂色，避免太吵）
      warnRegions++
      for (let d = 0; d < dots.length; d++) {
        if (placements[d]!.region === r) warnDots.add(d)
      }
    } else {
      // 没有圆点的连通块：继续画/合并即可，不强行高亮
      warnRegions++
    }
  }

  // 圆点被切开：锚定格附近标红
  for (const d of splitDots) {
    for (const a of placements[d]?.anchors ?? []) {
      bad.add(a)
      badDots.add(d)
    }
  }

  const empty = edgeOn === 0
  if (empty) {
    // 还没开始画：不标错误，避免整盘爆红
    bad.clear()
    warn.clear()
    badDots.clear()
    warnDots.clear()
  }

  const warnCells: number[] = []
  for (const c of warn) if (!bad.has(c)) warnCells.push(c)

  // 把淡黄提示里的圆点也去掉（圆点本身不参与高亮）
  const solved =
    dots.length > 0 &&
    regionCount > 0 &&
    splitDots.length === 0 &&
    badRegions === 0 &&
    warnRegions === 0 &&
    dots.every((_, d) => placements[d]!.region >= 0)

  return {
    solved,
    empty,
    edgeOn,
    edgeTotal,
    regionCount,
    dotCount: dots.length,
    goodRegions,
    warnRegions,
    badRegions,
    badCells: Array.from(bad),
    warnCells,
    badDots: Array.from(badDots),
    warnDots: Array.from(warnDots),
    splitDots,
  }
}

export function validate(state: GameState, puzzle: Puzzle): GalaxyResult {
  return analyze(puzzle, asGalaxyState(state).edges)
}

export function statusBits(result: ValidationResult): string[] {
  const r = result as GalaxyResult
  if (r.solved) return ['完成：每个区域恰好一个圆点，且 180° 对称']
  if (r.empty) return ['开始画区域边界']
  const bits: string[] = []
  if (r.badRegions > 0) bits.push(`${r.badRegions} 个区域不对称或圆点被切开`)
  if (r.splitDots.length > 0) bits.push(`${r.splitDots.length} 个圆点落在边界上`)
  if (r.warnRegions > 0) bits.push(`${r.warnRegions} 个区域还需要调整圆点数量`)
  const emptyRegions = r.regionCount - r.goodRegions - r.badRegions
  if (bits.length === 0 || (emptyRegions > 0 && bits.length < 2)) {
    bits.push(`${r.goodRegions}/${r.dotCount} 个区域已正确`)
  }
  if (r.edgeOn === 0) bits.push('开始画区域边界')
  return bits.slice(0, 4)
}

/** 供逻辑解题/求解器复用：判断当前边状态是否已解出 */
export function solvedEdges(puzzle: Puzzle, edges: ArrayLike<number>): boolean {
  return analyze(puzzle, edges).solved
}
