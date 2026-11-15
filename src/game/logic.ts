/**
 * 星系 —— 逻辑解题（规则推理 → 回放计划）
 *
 * 规则推理：
 *  1. 每个圆点的锚定格属于自己（格心 1 格 / 格点 2×2 四格）；
 *  2. 对称配对：c 属于 d ⇒ mirror(d,c) 也属于 d；
 *  3. 区域连通性：圆点的格子必须连成一片，连不到锚定格的格子不可能是它的；
 *  4. 由「已确定归属」或「候选圆点互斥」推出确定的区域边界；
 *  5. 规则卡住时用「反证」：假设某格属于某个圆点，若传播立刻矛盾就排除它；
 *  6. 仍然卡住时（自定义题/难度较高的题）退回回溯求解，把剩余边界补齐。
 *
 * 每推出一条确定的边界，就生成一帧 PlaybackFrame（只画边界，不擦边界）。
 */

import type { GameState, LogicPlan, PlaybackFrame, Puzzle } from '../core/types'
import { edgeCells, edgeCount } from '../core/board'
import {
  asGalaxyPuzzle,
  asGalaxyState,
  edgesFromRegions,
  OPEN,
  WALL,
  type GalaxyPuzzle,
  type GalaxyState,
} from './types'
import { countSolutions, createSolverContext, Propagator } from './solver'
import { solvedEdges } from './validate'

const RULE_INFO = {
  anchor: { rule: 1, label: '圆点锚定 + 对称配对' },
  connect: { rule: 2, label: '连通性与对称推出边界' },
  probe: { rule: 3, label: '反证：另一种可能立刻矛盾' },
  search: { rule: 4, label: '回溯补充：按唯一解补齐边界' },
} as const

type RuleKind = keyof typeof RULE_INFO

function emptyPlan(puzzle: Puzzle): LogicPlan {
  return {
    puzzleId: puzzle.id,
    frames: [],
    finalState: null,
    ruleSteps: 0,
    saturated: false,
  }
}

interface EdgeDeduction {
  edge: number
  a: number
  b: number
}

function collectDeduced(
  puzzle: GalaxyPuzzle,
  prop: Propagator,
  work: readonly number[],
): EdgeDeduction[] {
  const { width: w, height: h } = puzzle
  const total = edgeCount(w, h)
  const out: EdgeDeduction[] = []
  for (let e = 0; e < total; e++) {
    if ((work[e] ?? OPEN) === WALL) continue
    const pair = edgeCells(e, w, h)
    if (!pair) continue
    const oa = prop.owner[pair.a]!
    const ob = prop.owner[pair.b]!
    let boundary: boolean
    if (oa >= 0 && ob >= 0) boundary = oa !== ob
    else {
      // 两格的候选圆点集合互不相交 ⇒ 一定分属不同区域
      boundary = true
      for (let d = 0; d < prop.ownerWordCount; d++) {
        if (prop.has(pair.a, d) && prop.has(pair.b, d)) {
          boundary = false
          break
        }
      }
    }
    if (boundary) out.push({ edge: e, a: pair.a, b: pair.b })
  }
  return out
}

/** 反证试探：对候选最少的未定格子逐候选试算，排除立刻矛盾的可能 */
function probeStep(prop: Propagator, budget: number): 'progress' | 'none' | 'fail' {
  const ctx = prop.ownerContext()
  const { size, dotCount } = ctx
  let tried = 0
  for (let round = 0; round < 4; round++) {
    let best = -1
    let bestCount = 99
    for (let c = 0; c < size; c++) {
      if (prop.owner[c] !== -1) continue
      const n = prop.popcount(c)
      if (n >= 2 && n < bestCount) {
        bestCount = n
        best = c
        if (n === 2) break
      }
    }
    if (best < 0) return 'none'
    let contradicted = false
    let allContradicted = true
    for (let d = 0; d < dotCount; d++) {
      if (!prop.has(best, d)) continue
      if (tried++ >= budget) return contradicted ? 'progress' : 'none'
      const trial = prop.clone()
      if (!trial.assign(best, d) || !trial.propagate()) {
        prop.kill(best, d)
        contradicted = true
      } else {
        allContradicted = false
      }
    }
    if (allContradicted) return 'fail'
    if (contradicted) {
      if (!prop.propagate()) return 'fail'
      return 'progress'
    }
    // 这个格子的所有候选都不矛盾：换下一个候选最少的格子意义不大，直接结束
    return 'none'
  }
  return 'none'
}

export function planLogicSolve(puzzle: Puzzle, initialState: GameState): LogicPlan {
  const p = asGalaxyPuzzle(puzzle)
  const s = asGalaxyState(initialState)
  const ctx = createSolverContext(p)
  if (!ctx) return emptyPlan(puzzle)

  const total = edgeCount(p.width, p.height)
  const work = new Array<number>(total).fill(OPEN)
  for (let e = 0; e < Math.min(total, s.edges.length); e++) {
    work[e] = (s.edges[e] ?? OPEN) === WALL ? WALL : OPEN
  }

  const frames: PlaybackFrame[] = []
  let streak = 0
  let lastRule = -1

  const emit = (edge: number, to: number, kind: RuleKind): boolean => {
    const from = work[edge] ?? OPEN
    if (from === to) return false
    work[edge] = to
    const info = RULE_INFO[kind]
    if (info.rule === lastRule) streak++
    else {
      lastRule = info.rule
      streak = 1
    }
    frames.push({ rule: info.rule, label: info.label, move: { index: edge, from, to }, streak })
    return true
  }

  const finish = (saturated: boolean): LogicPlan => {
    const finalState: GalaxyState = {
      puzzleId: p.id,
      width: p.width,
      height: p.height,
      edges: work.slice(),
    }
    return {
      puzzleId: p.id,
      frames,
      finalState,
      ruleSteps: frames.length,
      saturated,
    }
  }

  // 盘面上已经有玩家画的边界：直接按唯一解校正（保证回放后一定解出）
  const hasPlayerEdges = work.some((v) => v === WALL)

  if (!hasPlayerEdges) {
    const prop = new Propagator(ctx)
    if (!prop.propagate()) return emptyPlan(puzzle)
    let stalled = false
    for (let round = 0; round < 4000; round++) {
      const deduced = collectDeduced(p, prop, work)
      for (const item of deduced) emit(item.edge, WALL, round === 0 ? 'anchor' : 'connect')
      if (solvedEdges(p, work)) return finish(true)
      if (prop.propagate() === false) return emptyPlan(puzzle)
      const probe = probeStep(prop, 24)
      if (probe === 'fail') return emptyPlan(puzzle)
      if (probe === 'progress') continue
      // 规则和反证都推不动了
      stalled = true
      break
    }
    if (!stalled && solvedEdges(p, work)) return finish(true)
    const out = countSolutions(p, 1, 800_000)
    if (out.solutions.length === 0) return emptyPlan(puzzle)
    const target = edgesFromRegions(p.width, p.height, out.solutions[0]!)
    for (let e = 0; e < total; e++) {
      if ((work[e] ?? OPEN) !== target[e]) emit(e, target[e]!, 'search')
    }
    return finish(false)
  }

  // 有玩家边界：按唯一解补齐/修正
  const out = countSolutions(p, 1, 800_000)
  if (out.solutions.length === 0) return emptyPlan(puzzle)
  const target = edgesFromRegions(p.width, p.height, out.solutions[0]!)
  for (let e = 0; e < total; e++) {
    if ((work[e] ?? OPEN) !== target[e]) emit(e, target[e]!, 'search')
  }
  return finish(false)
}

/** 让 app 的自定义题唯一性提示能直接拿到解的个数 */
export function solutionCount(puzzle: Puzzle, maxNodes = 300_000): {
  count: number
  timedOut: boolean
  nodes: number
} {
  const out = countSolutions(puzzle, 2, maxNodes)
  return { count: out.solutions.length, timedOut: out.timedOut, nodes: out.nodes }
}
