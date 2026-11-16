/**
 * 星系（Galaxies）—— 游戏专用类型与几何基础
 *
 * 棋盘按「半格坐标」（half-grid）描述圆点位置：
 *   - 格子中心：x、y 都是奇数（第 (x-1)/2 列、第 (y-1)/2 行格子的中心）
 *   - 格点（网格线交点）：x、y 都是偶数（第 x/2 条竖线、第 y/2 条横线的交点）
 *
 * 状态用「边」描述区域划分：每条相邻格子之间的边取
 *   0 = 不画（两格属于同一区域）
 *   1 = 画边界（两格被分到不同区域）
 *
 * 区域 = 由未画边界的相邻格子组成的连通块；因此状态天然保证「所有格子被覆盖、
 * 区域互不重叠」。校验只需要检查：每个区域恰好一个圆点 + 关于该圆点 180° 对称。
 */

import type { GameState, Puzzle, ValidationResult } from '../core/types'
import { edgeCells, edgeCount } from '../core/board'

/** 边值：0 = 无边界（同区域） */
export const OPEN = 0
/** 边值：1 = 区域边界 */
export const WALL = 1

/** 圆点的半格坐标 */
export interface GalaxyDot {
  x: number
  y: number
}

/** 内置/自定义题面扩展 */
export interface GalaxyPuzzle extends Puzzle {
  /** 圆点列表；每个圆点对应唯一一个区域 */
  dots: GalaxyDot[]
  /** 参考解的每格区域号（= dots 下标）；内置题才有 */
  regions?: number[]
}

export interface GalaxyState extends GameState {
  /** 每条边的值（0/1），索引顺序见 core/board.ts */
  edges: number[]
}

export interface GalaxyResult extends ValidationResult {
  /** 一条边界都没画 */
  empty: boolean
  /** 已画的边界数 */
  edgeOn: number
  edgeTotal: number
  /** 当前连通块数量 */
  regionCount: number
  dotCount: number
  /** 恰好含一个圆点且对称的区域数 */
  goodRegions: number
  /** 没有圆点的连通块数（画到一半时的常态） */
  warnRegions: number
  /** 圆点不唯一 / 不对称 / 圆点被切开的坏区域数 */
  badRegions: number
  /** 需要红色高亮的格子 */
  badCells: number[]
  /** 需要淡色提示的格子（圆点被切开的地带） */
  warnCells: number[]
  /** 出问题的圆点下标（不唯一 / 不对称 / 被切开） */
  badDots: number[]
  /** 淡色提示的圆点（落在含多个圆点、还需要继续分割的区域里） */
  warnDots: number[]
  /** 圆点落在多个区域上（自身被边界切开） */
  splitDots: number[]
}

export function asGalaxyPuzzle(p: Puzzle): GalaxyPuzzle {
  return p as GalaxyPuzzle
}

export function asGalaxyState(s: GameState): GalaxyState {
  return s as GalaxyState
}

/* ─────────────────────────── 圆点几何 ─────────────────────────── */

/** 圆点是否落在格子中心（两坐标皆奇数） */
export function isCenterDot(dot: GalaxyDot): boolean {
  return (dot.x & 1) === 1 && (dot.y & 1) === 1
}

/** 圆点是否落在格点（网格线交点，两坐标皆偶数） */
export function isVertexDot(dot: GalaxyDot): boolean {
  return (dot.x & 1) === 0 && (dot.y & 1) === 0
}

/**
 * 圆点是否落在边中点（一条坐标为奇数、另一条为偶数）。
 * 2 格多米诺等区域可以绕边中点 180° 对称，职业题面（如 puzzle-galaxies.com
 * 的每月大题）会出现这种圆点，所以这里也支持。
 */
export function isEdgeDot(dot: GalaxyDot): boolean {
  return ((dot.x & 1) === 1) !== ((dot.y & 1) === 1)
}

export function isValidDot(dot: GalaxyDot): boolean {
  return isCenterDot(dot) || isVertexDot(dot) || isEdgeDot(dot)
}

/**
 * 圆点「锚定」的格子：
 *   - 格心圆点：它所在的那 1 格；
 *   - 格点圆点：绕该格点的 2×2 四格（180° 对称 + 连通强制四格同区）；
 *   - 边中点圆点：共用这条边的 2 格（180° 交换）。
 */
export function dotAnchors(w: number, h: number, dot: GalaxyDot): number[] {
  if (isCenterDot(dot)) {
    const cx = (dot.x - 1) / 2
    const cy = (dot.y - 1) / 2
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return []
    return [cy * w + cx]
  }
  if (isVertexDot(dot)) {
    const vx = dot.x / 2
    const vy = dot.y / 2
    if (vx <= 0 || vy <= 0 || vx >= w || vy >= h) return []
    return [(vy - 1) * w + (vx - 1), (vy - 1) * w + vx, vy * w + (vx - 1), vy * w + vx]
  }
  if (isEdgeDot(dot)) {
    if (dot.x & 1) {
      // 水平边：上下两格
      const cx = (dot.x - 1) / 2
      const vy = dot.y / 2
      if (cx < 0 || cx >= w || vy <= 0 || vy >= h) return []
      return [(vy - 1) * w + cx, vy * w + cx]
    }
    // 垂直边：左右两格
    const vx = dot.x / 2
    const cy = (dot.y - 1) / 2
    if (cy < 0 || cy >= h || vx <= 0 || vx >= w) return []
    return [cy * w + (vx - 1), cy * w + vx]
  }
  return []
}

/** 格子 c 关于 dot 旋转 180° 后的格子下标；越界返回 -1 */
export function mirrorCell(w: number, h: number, dot: GalaxyDot, c: number): number {
  const x = c % w
  const y = (c / w) | 0
  // 格心半格坐标 (2x+1, 2y+1) 绕 dot 旋转：x' = dot.x - x - 1
  const nx = dot.x - x - 1
  const ny = dot.y - y - 1
  if (nx < 0 || ny < 0 || nx >= w || ny >= h) return -1
  return ny * w + nx
}

/** 圆点中点的 SVG 归一化坐标偏移（半格数 → 格数） */
export function dotOffset(dot: GalaxyDot): { dx: number; dy: number } {
  return { dx: dot.x / 2, dy: dot.y / 2 }
}

/* ─────────────────────────── 编解码 ─────────────────────────── */

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 圆点串："x,y;x,y;…" */
export function formatDots(dots: readonly GalaxyDot[]): string {
  return dots.map((d) => `${d.x},${d.y}`).join(';')
}

export function parseDots(text: string): GalaxyDot[] | null {
  if (typeof text !== 'string' || text.trim() === '') return null
  const out: GalaxyDot[] = []
  for (const part of text.split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const bits = seg.split(',')
    if (bits.length !== 2) return null
    const x = Number(bits[0])
    const y = Number(bits[1])
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return null
    out.push({ x, y })
  }
  return out.length ? out : null
}

/** 每格区域号 → base36 串（'-' = 无归属，便于将来扩展） */
export function encodeRegions(regions: readonly number[]): string {
  let out = ''
  for (const r of regions) {
    const n = r | 0
    if (n < 0) out += '-'
    else out += B36[Math.min(B36.length - 1, n)]!
  }
  return out
}

export function decodeRegions(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '-') out[i] = -1
    else {
      const v = B36.indexOf(ch.toLowerCase())
      if (v < 0) return null
      out[i] = v
    }
  }
  return out
}

/** 边的 0/1 序列 → 紧凑串 */
export function encodeEdges(edges: readonly number[]): string {
  let out = ''
  for (const e of edges) out += e ? '1' : '0'
  return out
}

export function decodeEdges(text: string, expected: number): number[] | null {
  if (typeof text !== 'string' || text.length !== expected) return null
  const out = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const ch = text[i]!
    if (ch === '0') out[i] = OPEN
    else if (ch === '1') out[i] = WALL
    else return null
  }
  return out
}

/* ─────────────────────────── 由区域求边 ─────────────────────────── */

/** 由每格区域号推出边界状态（内置题参考解 → 可玩状态用） */
export function edgesFromRegions(
  w: number,
  h: number,
  regions: readonly number[],
): number[] {
  const total = edgeCount(w, h)
  const edges = new Array<number>(total).fill(OPEN)
  for (let e = 0; e < total; e++) {
    const pair = edgeCells(e, w, h)
    if (!pair) continue
    if (regions[pair.a] !== regions[pair.b]) edges[e] = WALL
  }
  return edges
}

/** 统计某条边连接的两格 */
export function edgePair(
  e: number,
  w: number,
  h: number,
): { a: number; b: number; horizontal: boolean } | null {
  return edgeCells(e, w, h)
}

/* ─────────────────────────── 题面结构检查 ─────────────────────────── */

/** 返回题面结构问题列表（空数组 = 结构合法） */
export function puzzleIssues(puzzle: GalaxyPuzzle): string[] {
  const issues: string[] = []
  const size = puzzle.width * puzzle.height
  const dots = puzzle.dots
  if (puzzle.width < 2 || puzzle.height < 2) issues.push('棋盘至少 2×2')
  if (!Array.isArray(dots) || dots.length === 0) {
    issues.push('至少需要 1 个圆点')
    return issues
  }
  const seen = new Set<string>()
  const owner = new Int8Array(size).fill(-1)
  for (let d = 0; d < dots.length; d++) {
    const dot = dots[d]!
    if (!isValidDot(dot)) {
      issues.push(`圆点 ${d} 不在格心或格点上`)
      continue
    }
    if (dot.x > puzzle.width * 2 || dot.y > puzzle.height * 2) {
      issues.push(`圆点 ${d} 越界`)
      continue
    }
    const key = `${dot.x},${dot.y}`
    if (seen.has(key)) {
      issues.push(`圆点 ${d} 重复`)
      continue
    }
    seen.add(key)
    const anchors = dotAnchors(puzzle.width, puzzle.height, dot)
    if (anchors.length === 0) {
      issues.push(`圆点 ${d} 的锚定格越界（格点圆点不能贴边）`)
      continue
    }
    for (const a of anchors) {
      if (owner[a] !== -1) issues.push(`圆点 ${d} 的锚定格与圆点 ${owner[a]} 冲突`)
      else owner[a] = d
    }
  }
  // 参考解用 base36 编码区域号，所以「有参考解」的题最多 36 个圆点；
  // 识图导入的大题没有参考解（只是不能「显示解」），圆点数量本身不受编码限制。
  if (puzzle.regions && dots.length > B36.length) issues.push('圆点数量超过 36 个（参考解编码上限）')
  if (puzzle.regions) {
    if (puzzle.regions.length !== size) issues.push('参考解长度不匹配')
    else {
      for (const r of puzzle.regions) {
        if (r < 0 || r >= dots.length) {
          issues.push('参考解区域号越界')
          break
        }
      }
      // 每个区域的锚定格必须都落在自己的区域里
      for (let d = 0; d < dots.length; d++) {
        const anchors = dotAnchors(puzzle.width, puzzle.height, dots[d]!)
        for (const a of anchors) {
          if (puzzle.regions[a] !== d) {
            issues.push(`参考解里圆点 ${d} 的锚定格不属于自己`)
            break
          }
        }
      }
    }
  }
  return issues
}
