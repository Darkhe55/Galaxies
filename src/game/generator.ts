/**
 * 星系 —— 题目生成器（离线，npm run gen 调用）
 *
 * 生成思路：
 *  1. 随机生成一份「矩形拼铺」：行高、列宽都取与棋盘同奇偶的尺寸；
 *     奇数×奇数的矩形，中心落在格子中心（格心圆点）；
 *     偶数×偶数的矩形，中心落在格线交点（格点圆点）。
 *     每个矩形的中心放一个圆点 —— 矩形天然 180° 对称、连通、恰好一个圆点，
 *     所以它一定是一份合法解。
 *  2. 用求解器检查是否唯一解；
 *  3. 用逻辑解题器检查「纯规则 + 反证」能否推完；
 *  4. 通过才收录进题库。
 *
 * 生成的题面：圆点串 + 每格区域号（base36）。
 */

import {
  asGalaxyPuzzle,
  edgesFromRegions,
  encodeRegions,
  formatDots,
  puzzleIssues,
  type GalaxyDot,
  type GalaxyPuzzle,
} from './types'
import { countSolutions, createSolverContext, Propagator } from './solver'
import { planLogicSolve } from './logic'
import { validate } from './validate'
import { createEmptyState } from './state'

/* ─────────────────────────── 随机数 ─────────────────────────── */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** 把 total 拆成若干同奇偶的整数（每项至少 min） */
function randomComposition(
  rng: () => number,
  total: number,
  parity: 0 | 1,
  minParts: number,
  maxParts: number,
): number[] | null {
  const base = parity === 1 ? 1 : 2
  const step = 2
  if (total < base) return null
  const maxK = Math.min(maxParts, Math.floor(total / base))
  const minK = Math.max(1, minParts)
  if (maxK < minK) return null
  // k 必须满足 total - k*base 是 step 的非负倍数
  const candidates: number[] = []
  for (let k = minK; k <= maxK; k++) {
    const rest = total - k * base
    if (rest >= 0 && rest % step === 0) candidates.push(k)
  }
  if (!candidates.length) return null
  const k = candidates[randInt(rng, 0, candidates.length - 1)]!
  const parts = new Array<number>(k).fill(base)
  let rest = total - k * base
  const pairs = rest / step
  for (let i = 0; i < pairs; i++) parts[randInt(rng, 0, k - 1)]! += step
  return parts
}

/* ─────────────────────────── 矩形拼铺 ─────────────────────────── */

interface Tiling {
  dots: GalaxyDot[]
  regions: number[]
}

function buildTiling(w: number, h: number, rows: number[], cols: number[]): Tiling | null {
  if (rows.reduce((a, b) => a + b, 0) !== h) return null
  if (cols.reduce((a, b) => a + b, 0) !== w) return null
  const dots: GalaxyDot[] = []
  const regions = new Array<number>(w * h).fill(-1)
  let y = 0
  for (const rh of rows) {
    let x = 0
    for (const cw of cols) {
      const d = dots.length
      // 矩形中心（半格坐标）：2x + cw, 2y + rh
      dots.push({ x: 2 * x + cw, y: 2 * y + rh })
      for (let yy = y; yy < y + rh; yy++) {
        for (let xx = x; xx < x + cw; xx++) regions[yy * w + xx] = d
      }
      x += cw
    }
    y += rh
  }
  return { dots, regions }
}

function randomTiling(rng: () => number, w: number, h: number): Tiling | null {
  const useEven = w % 2 === 0 && h % 2 === 0 && rng() < 0.5
  const parity: 0 | 1 = useEven ? 0 : 1
  const maxRows = parity === 0 ? Math.max(1, Math.floor(h / 2)) : Math.min(h, 4)
  const maxCols = parity === 0 ? Math.max(1, Math.floor(w / 2)) : Math.min(w, 4)
  const rows = randomComposition(rng, h, parity, 1, maxRows)
  const cols = randomComposition(rng, w, parity, 1, maxCols)
  if (!rows || !cols) return null
  const tiling = buildTiling(w, h, rows, cols)
  if (!tiling) return null
  const puzzle: GalaxyPuzzle = {
    id: '__gen__',
    name: '__gen__',
    width: w,
    height: h,
    difficulty: 'easy',
    dots: tiling.dots,
    regions: tiling.regions,
  }
  if (puzzleIssues(puzzle).length) return null
  return tiling
}

/* ─────────────────────────── 验收 ─────────────────────────── */

export interface CheckOutcome {
  ok: boolean
  frames: number
  nodes: number
  stage: 'solution' | 'unique' | 'logic' | 'ok'
}

export function checkTiling(
  w: number,
  h: number,
  tiling: Tiling,
  maxNodes = 300_000,
): CheckOutcome {
  const puzzle: GalaxyPuzzle = {
    id: '__gen__',
    name: '__gen__',
    width: w,
    height: h,
    difficulty: 'easy',
    dots: tiling.dots,
    regions: tiling.regions,
  }
  const emptyState = createEmptyState(puzzle)
  const solutionState = {
    puzzleId: puzzle.id,
    width: w,
    height: h,
    edges: edgesFromRegions(w, h, tiling.regions),
  }
  if (!validate(solutionState, puzzle).solved) {
    return { ok: false, frames: 0, nodes: 0, stage: 'solution' }
  }
  const count = countSolutions(puzzle, 2, maxNodes)
  if (count.timedOut || count.solutions.length !== 1) {
    return { ok: false, frames: 0, nodes: count.nodes, stage: 'unique' }
  }
  const plan = planLogicSolve(puzzle, emptyState)
  if (!plan.saturated || !plan.finalState || plan.frames.length < 4) {
    return { ok: false, frames: plan.frames.length, nodes: count.nodes, stage: 'logic' }
  }
  if (!validate(plan.finalState, puzzle).solved) {
    return { ok: false, frames: plan.frames.length, nodes: count.nodes, stage: 'logic' }
  }
  return { ok: true, frames: plan.frames.length, nodes: count.nodes, stage: 'ok' }
}

export interface GeneratedPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard'
  series: string
  dots: string
  solution: string
  frames: number
  attempts: number
  vertexDots: number
}

interface SizeSpec {
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard'
  series: string
}

const SIZE_POOL: SizeSpec[] = [
  { width: 6, height: 6, difficulty: 'easy', series: '入门' },
  { width: 6, height: 7, difficulty: 'easy', series: '入门' },
  { width: 7, height: 7, difficulty: 'medium', series: '进阶' },
  { width: 8, height: 7, difficulty: 'medium', series: '进阶' },
  { width: 8, height: 8, difficulty: 'medium', series: '进阶' },
  { width: 9, height: 8, difficulty: 'hard', series: '挑战' },
  { width: 9, height: 9, difficulty: 'hard', series: '挑战' },
  { width: 10, height: 9, difficulty: 'hard', series: '挑战' },
  { width: 10, height: 10, difficulty: 'hard', series: '挑战' },
]

const NAMES = [
  '星群初见',
  '六角微光',
  '双星初会',
  '六宫星盘',
  '星点拼图',
  '七曜巡游',
  '七星连珠',
  '星轨回旋',
  '中庭星图',
  '八面星风',
  '星汉灿烂',
  '八域回廊',
  '格点星旋',
  '九星拱卫',
  '九霄星图',
  '星海棋局',
  '十方星阵',
  '星路交点',
  '深邃星野',
  '交辉',
  '界线',
  '星门',
  '回廊星域',
  '长夜星图',
]

/** 生成一道题：随机拼铺 + 唯一解 + 逻辑可解 才算通过 */
export function generateOne(
  rng: () => number,
  w: number,
  h: number,
  difficulty: 'easy' | 'medium' | 'hard',
  series: string,
  maxAttempts = 5000,
): GeneratedPuzzle | null {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const tiling = randomTiling(rng, w, h)
    if (!tiling) continue
    // 区域数量太少/太多时观感一般
    const regions = new Set(tiling.regions).size
    if (regions < 4 || regions > 14) continue
    const check = checkTiling(w, h, tiling, 250_000)
    if (!check.ok) continue
    const vertexDots = tiling.dots.filter(
      (d) => (d.x & 1) === 0 && (d.y & 1) === 0,
    ).length
    return {
      id: `galaxies-${w}x${h}-${regions}r-${(rng() * 0xffffffff) >>> 0}`,
      name: '',
      width: w,
      height: h,
      difficulty,
      series,
      dots: formatDots(tiling.dots),
      solution: encodeRegions(tiling.regions),
      frames: check.frames,
      attempts: attempt,
      vertexDots,
    }
  }
  return null
}

/** 供 scripts/gen-config.mjs 调用：生成全部内置题 */
export function generateAll(log: (msg: string) => void = () => {}): GeneratedPuzzle[] {
  const out: GeneratedPuzzle[] = []
  const namePool = [...NAMES]
  let seed = 0x5f3759df
  for (let i = 0; i < SIZE_POOL.length; i++) {
    const spec = SIZE_POOL[i]!
    const rng = mulberry32((seed + i * 7919) >>> 0)
    const t0 = Date.now()
    let accepted = 0
    for (let k = 0; k < 2; k++) {
      const item = generateOne(rng, spec.width, spec.height, spec.difficulty, spec.series)
      if (!item) continue
      const nameIndex = (i * 2 + k) % namePool.length
      const name = namePool.splice(nameIndex, 1)[0] ?? `星系 ${i}-${k}`
      out.push({ ...item, name })
      accepted++
    }
    log(
      `[gen] ${spec.width}×${spec.height} ${spec.series}：接受 ${accepted} 题，用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    )
  }
  seed = 0
  return out
}

/** 调试：跑一道题并打印自检结果 */
export function debugGenerate(w: number, h: number, seed: number, tries = 2000): string {
  const rng = mulberry32(seed)
  const t0 = Date.now()
  const item = generateOne(rng, w, h, 'easy', '调试', tries)
  if (!item) return `failed (${Date.now() - t0}ms)`
  return `regions=${new Set(item.dots.split(';')).size} frames=${item.frames} attempts=${item.attempts} dots=${item.dots} ${Date.now() - t0}ms`
}

/** 调试：统计拼铺/唯一解/逻辑各阶段通过率 */
export function diagnoseSpec(
  w: number,
  h: number,
  seed: number,
  tries = 200,
): string {
  const rng = mulberry32(seed)
  const stat = { tilingFail: 0, regionCount: 0, uniqueFail: 0, logicFail: 0, ok: 0, timeout: 0 }
  const t0 = Date.now()
  for (let i = 0; i < tries; i++) {
    const tiling = randomTiling(rng, w, h)
    if (!tiling) {
      stat.tilingFail++
      continue
    }
    const regions = new Set(tiling.regions).size
    if (regions < 4 || regions > 14) {
      stat.regionCount++
      continue
    }
    const check = checkTiling(w, h, tiling, 250_000)
    if (check.ok) stat.ok++
    else if (check.stage === 'solution') stat.tilingFail++
    else if (check.stage === 'unique') stat.uniqueFail++
    else stat.logicFail++
  }
  return `tries=${tries} ${JSON.stringify(stat)} ${Date.now() - t0}ms`
}

/** 保留内部工具给探针脚本用 */
export { createSolverContext, Propagator, asGalaxyPuzzle }
