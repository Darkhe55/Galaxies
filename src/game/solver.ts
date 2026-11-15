/**
 * 星系 —— 回溯求解器（含约束传播）
 *
 * 建模：
 *   - 每个格子最终属于某个圆点（区域）；
 *   - 若格子 c 属于圆点 d，则 c 关于 d 的 180° 旋转点 mirror(d,c) 也属于 d；
 *   - 每个圆点的锚定格（格心圆点=1 格，格点圆点=2×2 四格）必须属于自己；
 *   - 每个圆点的格子必须连通（含锚定格）；
 *   - 每个圆点恰好一个区域 → 由「锚定格被自己占用」自动保证。
 *
 * 传播：
 *   - 对称传播：c 属于 d ⇔ mirror(d,c) 属于 d；
 *   - 单值域赋值；
 *   - 连通性剪枝：若圆点 d 的某块已确定格子无法通过「可能属于 d」的格子连到锚定格，
 *     则矛盾；不可达的格子不再可能是 d。
 *
 * 搜索：MRV（剩余可能圆点最少的格子）+ 传播，可用于：
 *   - 显示解 / 提示（找 1 个解）；
 *   - 唯一解校验（找 2 个解后停止）。
 */

import type { Puzzle, SolveResult } from '../core/types'
import {
  asGalaxyPuzzle,
  dotAnchors,
  edgesFromRegions,
  mirrorCell,
  type GalaxyPuzzle,
  type GalaxyState,
} from './types'

export interface SolverContext {
  puzzle: GalaxyPuzzle
  w: number
  h: number
  size: number
  dotCount: number
  anchors: number[][]
  /** mirror[d * size + c] = c 关于圆点 d 的镜像格；-1 = 越界 */
  mirror: Int16Array
  words: number
}

export function createSolverContext(puzzle: Puzzle): SolverContext | null {
  const p = asGalaxyPuzzle(puzzle)
  const w = p.width
  const h = p.height
  const size = w * h
  const dots = p.dots ?? []
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2) return null
  if (dots.length === 0) return null
  const words = Math.ceil(dots.length / 32)
  const mirror = new Int16Array(dots.length * size)
  const anchors: number[][] = []
  const taken = new Int8Array(size).fill(-1)
  for (let d = 0; d < dots.length; d++) {
    const dot = dots[d]!
    const a = dotAnchors(w, h, dot)
    if (a.length === 0) return null
    for (const cell of a) {
      if (taken[cell] !== -1) return null
      taken[cell] = d
    }
    anchors.push(a)
    for (let c = 0; c < size; c++) mirror[d * size + c] = mirrorCell(w, h, dot, c)
  }
  return { puzzle: p, w, h, size, dotCount: dots.length, anchors, mirror, words }
}

/** 与位掩码无关的通用传播器：每个格子的候选圆点用 words 个 32 位字表示 */
export class Propagator {
  owner: Int8Array
  killed: Uint8Array
  domains: Uint32Array
  private ctx: SolverContext

  constructor(ctx: SolverContext) {
    this.ctx = ctx
    const { size, dotCount } = ctx
    this.owner = new Int8Array(size).fill(-1)
    this.killed = new Uint8Array(size * dotCount)
    this.domains = new Uint32Array(size * ctx.words)
  }

  clone(): Propagator {
    const p = new Propagator(this.ctx)
    p.owner.set(this.owner)
    p.killed.set(this.killed)
    p.domains.set(this.domains)
    return p
  }

  has(c: number, d: number): boolean {
    const word = d >> 5
    return ((this.domains[c * this.ctx.words + word]! >>> (d & 31)) & 1) === 1
  }

  /** 候选圆点总数（逻辑解题遍历用） */
  get ownerWordCount(): number {
    return this.ctx.dotCount
  }

  /** 求解上下文（逻辑解题需要按格子/圆点读取几何信息） */
  ownerContext(): SolverContext {
    return this.ctx
  }

  /** 永久排除「格子 c 属于圆点 d」这种可能 */
  kill(c: number, d: number): void {
    this.killed[c * this.ctx.dotCount + d] = 1
  }

  private setBit(c: number, d: number): void {
    const i = c * this.ctx.words + (d >> 5)
    this.domains[i] = (this.domains[i]! | (1 << (d & 31))) >>> 0
  }

  private clearBit(c: number, d: number): void {
    const i = c * this.ctx.words + (d >> 5)
    this.domains[i] = (this.domains[i]! & ~(1 << (d & 31))) >>> 0
  }

  popcount(c: number): number {
    let n = 0
    for (let k = 0; k < this.ctx.words; k++) {
      let v = this.domains[c * this.ctx.words + k]!
      v = v - ((v >>> 1) & 0x55555555)
      v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
      n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
    }
    return n
  }

  /** 初始化锚定格（可能在交给搜索前调用） */
  seedAnchors(): boolean {
    const { ctx } = this
    for (let d = 0; d < ctx.dotCount; d++) {
      for (const a of ctx.anchors[d]!) {
        if (this.owner[a] !== -1 && this.owner[a] !== d) return false
        this.owner[a] = d
      }
    }
    return true
  }

  /** 直接写入 c（及其镜像）属于 d */
  assign(c: number, d: number): boolean {
    const { ctx } = this
    if (this.owner[c] !== -1) return this.owner[c] === d
    const m = ctx.mirror[d * ctx.size + c]!
    if (m < 0) return false
    this.owner[c] = d
    if (m !== c) {
      if (this.owner[m] === -1) this.owner[m] = d
      else if (this.owner[m] !== d) return false
    }
    return true
  }

  /** 连通性允许的格子：已属于 d，或未定且仍可能是 d */
  private allowedFor(c: number, d: number): boolean {
    if (this.owner[c] === d) return true
    if (this.owner[c] !== -1) return false
    if (this.killed[c * this.ctx.dotCount + d]) return false
    const m = this.ctx.mirror[d * this.ctx.size + c]!
    if (m < 0) return false
    const om = this.owner[m]
    return om === -1 || om === d
  }

  /** 重新计算未定格子的候选集 */
  private refreshDomains(): boolean {
    const { ctx } = this
    const { size, dotCount, words, mirror } = ctx
    for (let c = 0; c < size; c++) {
      if (this.owner[c] !== -1) continue
      const base = c * words
      for (let k = 0; k < words; k++) this.domains[base + k] = 0
      for (let d = 0; d < dotCount; d++) {
        const m = mirror[d * size + c]!
        if (m < 0) continue
        // 对称传播：镜像格被剪掉（不可能是 d）时，c 也不可能是 d
        if (this.killed[m * dotCount + d]) continue
        const om = this.owner[m]
        if (om === -1 || om === d) this.setBit(c, d)
      }
      // 扣掉被连通性剪掉的候选
      for (let d = 0; d < dotCount; d++) {
        if (this.killed[c * dotCount + d]) this.clearBit(c, d)
      }
      if (this.popcount(c) === 0) return false
    }
    return true
  }

  /** 连通性剪枝：返回 false = 矛盾；true = 可能还有改动（changed 通过返回值反映） */
  private pruneConnectivity(): { ok: boolean; changed: boolean } {
    const { ctx } = this
    const { size, dotCount, w, h } = ctx
    let changed = false
    const mark = new Uint8Array(size)
    const stack: number[] = []
    for (let d = 0; d < dotCount; d++) {
      mark.fill(0)
      stack.length = 0
      for (const a of ctx.anchors[d]!) {
        mark[a] = 1
        stack.push(a)
      }
      let head = 0
      while (head < stack.length) {
        const c = stack[head++]!
        const x = c % w
        const y = (c / w) | 0
        const neigh = [
          x > 0 ? c - 1 : -1,
          x + 1 < w ? c + 1 : -1,
          y > 0 ? c - w : -1,
          y + 1 < h ? c + w : -1,
        ]
        for (const n of neigh) {
          if (n < 0 || mark[n]) continue
          if (!this.allowedFor(n, d)) continue
          mark[n] = 1
          stack.push(n)
        }
      }
      // 所有已属于 d 的格子必须可达
      for (let c = 0; c < size; c++) {
        if (this.owner[c] === d && !mark[c]) return { ok: false, changed }
      }
      // 不可达的候选格不再可能是 d
      for (let c = 0; c < size; c++) {
        if (this.owner[c] !== -1 || mark[c]) continue
        if (!this.has(c, d)) continue
        this.killed[c * dotCount + d] = 1
        changed = true
      }
    }
    return { ok: true, changed }
  }

  /** 传播到不动点；返回 false = 矛盾 */
  propagate(): boolean {
    const { size } = this.ctx
    if (!this.seedAnchors()) return false
    for (let guard = 0; guard < size * 8 + 32; guard++) {
      if (!this.refreshDomains()) return false
      let assignedAny = false
      let restart = false
      for (let c = 0; c < size; c++) {
        if (this.owner[c] !== -1) continue
        const n = this.popcount(c)
        if (n === 0) return false
        if (n !== 1) continue
        let d = -1
        outer: for (let k = 0; k < this.ctx.words; k++) {
          const v = this.domains[c * this.ctx.words + k]!
          for (let b = 0; b < 32; b++) {
            if ((v >>> b) & 1) {
              d = k * 32 + b
              break outer
            }
          }
        }
        if (d < 0) return false
        if (!this.assign(c, d)) {
          // 候选域是上一轮算的，可能已被同轮其它赋值影响 → 重新算一遍
          restart = true
          break
        }
        assignedAny = true
      }
      if (restart) continue
      if (assignedAny) continue
      const pr = this.pruneConnectivity()
      if (!pr.ok) return false
      if (!pr.changed) return true
    }
    return false
  }

  /** 当前所有未定格子的候选（调试/逻辑解题用） */
  candidates(c: number): number[] {
    const out: number[] = []
    for (let d = 0; d < this.ctx.dotCount; d++) if (this.has(c, d)) out.push(d)
    return out
  }

  /** 强制某格属于 d：用于反证试探 */
  force(c: number, d: number): boolean {
    if (!this.assign(c, d)) return false
    return this.propagate()
  }
}

export interface SearchOutcome {
  solutions: number[][]
  nodes: number
  timedOut: boolean
}

function search(
  ctx: SolverContext,
  limit: number,
  maxNodes: number,
  initial?: Propagator,
): SearchOutcome {
  const solutions: number[][] = []
  let nodes = 0
  let timedOut = false
  const { size } = ctx

  const dfs = (prop: Propagator): void => {
    if (solutions.length >= limit || timedOut) return
    nodes++
    if (nodes > maxNodes) {
      timedOut = true
      return
    }
    if (!prop.propagate()) return

    let best = -1
    let bestCount = 0
    for (let c = 0; c < size; c++) {
      if (prop.owner[c] !== -1) continue
      const n = prop.popcount(c)
      if (best < 0 || n < bestCount) {
        best = c
        bestCount = n
      }
      if (n <= 1) break
    }
    if (best < 0) {
      solutions.push(Array.from(prop.owner))
      return
    }
    const order: number[] = []
    for (let d = 0; d < ctx.dotCount; d++) if (prop.has(best, d)) order.push(d)
    for (const d of order) {
      if (solutions.length >= limit || timedOut) return
      const next = prop.clone()
      if (!next.assign(best, d)) continue
      dfs(next)
    }
  }

  if (initial) dfs(initial)
  else {
    const prop = new Propagator(ctx)
    if (prop.seedAnchors()) dfs(prop)
  }
  return { solutions, nodes, timedOut }
}

/** 统计解的个数（最多 limit 个）；唯一解校验用 */
export function countSolutions(
  puzzle: Puzzle,
  limit = 2,
  maxNodes = 400_000,
): SearchOutcome {
  const ctx = createSolverContext(puzzle)
  if (!ctx) return { solutions: [], nodes: 0, timedOut: false }
  return search(ctx, limit, maxNodes)
}

function stateFromRegions(puzzle: GalaxyPuzzle, regions: number[]): GalaxyState {
  return {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    edges: edgesFromRegions(puzzle.width, puzzle.height, regions),
  }
}

export function solvePuzzle(puzzle: Puzzle, maxNodes = 1_500_000): SolveResult {
  const ctx = createSolverContext(puzzle)
  if (!ctx) return { solved: false, solution: null, nodes: 0, timedOut: false }
  const out = search(ctx, 2, maxNodes)
  if (out.solutions.length === 0) {
    return { solved: false, solution: null, nodes: out.nodes, timedOut: out.timedOut }
  }
  const first = out.solutions[0]!
  return {
    solved: true,
    solution: stateFromRegions(ctx.puzzle, first),
    nodes: out.nodes,
    timedOut: false,
    unique: !out.timedOut && out.solutions.length === 1,
    solutionCount: out.solutions.length,
  }
}
