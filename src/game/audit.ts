/**
 * 星系 —— 题库深度审计（npm run check 调用）
 *
 * 在 Node 里（通过 esbuild 打包）检查：
 *  - RAW_PUZZLES 结构（id/name/宽高/难度/圆点串/参考解长度）
 *  - 每道内置题：参考解通过校验、唯一解、逻辑解题可推完
 *  - 状态序列化 / 自定义题编解码 / 提示一格 / 状态栏文案
 */

import { RAW_PUZZLES } from './puzzles-data'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { countSolutions } from './solver'
import { planLogicSolve } from './logic'
import { analyze, statusBits, validate } from './validate'
import {
  applyMove,
  cloneState,
  createEmptyState,
  deserializeState,
  firstHintMove,
  serializeState,
} from './state'
import { custom } from './custom'
import {
  asGalaxyPuzzle,
  asGalaxyState,
  decodeRegions,
  edgesFromRegions,
  formatDots,
  parseDots,
} from './types'

export interface PuzzleAudit {
  id: string
  name: string
  size: string
  dots: number
  referenceOk: boolean
  unique: boolean
  solutions: number
  logicFrames: number
  logicSolved: boolean
  saturated: boolean
  errors: string[]
}

export interface AuditReport {
  rawCount: number
  loadedCount: number
  puzzles: PuzzleAudit[]
  errors: string[]
  customOk: boolean
  stateOk: boolean
  hintOk: boolean
  statusOk: boolean
}

function auditRaw(): string[] {
  const errors: string[] = []
  if (RAW_PUZZLES.length < 6) errors.push(`内置题少于 6 道（当前 ${RAW_PUZZLES.length}）`)
  const ids = new Set<string>()
  for (const raw of RAW_PUZZLES) {
    const tag = raw.id || '(空 id)'
    if (!raw.id) errors.push('存在空 id 的题目')
    if (ids.has(raw.id)) errors.push(`${tag}: id 重复`)
    ids.add(raw.id)
    if (!raw.name) errors.push(`${tag}: 缺少 name`)
    if (!Number.isInteger(raw.width) || raw.width < 2) errors.push(`${tag}: width 非法`)
    if (!Number.isInteger(raw.height) || raw.height < 2) errors.push(`${tag}: height 非法`)
    if (!['easy', 'medium', 'hard', 'custom'].includes(raw.difficulty)) {
      errors.push(`${tag}: difficulty 非法`)
    }
    const dots = parseDots(raw.dots)
    if (!dots) errors.push(`${tag}: 圆点串无法解析`)
    if (typeof raw.solution !== 'string' || raw.solution.length !== raw.width * raw.height) {
      errors.push(`${tag}: 参考解长度不等于 ${raw.width}×${raw.height}`)
    } else if (!decodeRegions(raw.solution, raw.width * raw.height)) {
      errors.push(`${tag}: 参考解编码非法`)
    }
    if (dots && raw.solution) {
      const regions = decodeRegions(raw.solution, raw.width * raw.height)
      if (regions) {
        for (let d = 0; d < dots.length; d++) {
          if (!regions.includes(d)) errors.push(`${tag}: 圆点 ${d} 没有对应区域`)
        }
        for (const r of regions) {
          if (r < 0 || r >= dots.length) {
            errors.push(`${tag}: 参考解区域号越界`)
            break
          }
        }
      }
    }
  }
  return errors
}

export function runAudit(): AuditReport {
  const errors: string[] = auditRaw()
  const puzzles: PuzzleAudit[] = []

  for (const puzzle of builtinPuzzles) {
    const p = asGalaxyPuzzle(puzzle)
    const tag = p.id
    const itemErrors: string[] = []
    const ref = getReferenceSolution(p.id)
    let referenceOk = false
    if (!ref) itemErrors.push('缺少参考解')
    else {
      const r = validate(ref, p)
      referenceOk = r.solved
      if (!referenceOk) itemErrors.push('参考解未通过校验')
    }

    const count = countSolutions(p, 2, 600_000)
    const unique = !count.timedOut && count.solutions.length === 1
    if (count.timedOut) itemErrors.push('唯一解校验超时')
    else if (count.solutions.length === 0) itemErrors.push('题目无解')
    else if (count.solutions.length > 1) itemErrors.push(`题目有多解（至少 ${count.solutions.length} 个）`)

    const empty = createEmptyState(p)
    const plan = planLogicSolve(p, empty)
    const logicSolved = plan.finalState ? validate(plan.finalState, p).solved : false
    if (!plan.saturated) itemErrors.push('逻辑推理未能在规则内推完（退回回溯）')
    if (!logicSolved) itemErrors.push('逻辑解题终态不是合法解')
    if (plan.frames.length === 0) itemErrors.push('逻辑解题没有产生回放帧')

    // 提示一格：应能把空盘朝参考解推进一步
    let hintOk = false
    if (ref) {
      const move = firstHintMove(empty, ref)
      if (move) {
        const st = cloneState(empty)
        applyMove(st, move)
        hintOk = st.edges[move.index] === move.to
      }
      if (!hintOk) itemErrors.push('提示一格无法从空盘推进')
    }

    errors.push(...itemErrors.map((e) => `${tag}: ${e}`))
    puzzles.push({
      id: p.id,
      name: p.name,
      size: `${p.width}×${p.height}`,
      dots: p.dots.length,
      referenceOk,
      unique,
      solutions: count.solutions.length,
      logicFrames: plan.frames.length,
      logicSolved,
      saturated: plan.saturated,
      errors: itemErrors,
    })
  }

  // —— 状态序列化往返 ——
  let stateOk = true
  {
    const puzzle = builtinPuzzles[0]
    if (!puzzle) stateOk = false
    else {
      const st = createEmptyState(puzzle)
      const data = serializeState(st)
      const back = deserializeState(data)
      if (!back || back.edges.length !== st.edges.length) stateOk = false
      const sol = getReferenceSolution(puzzle.id)
      if (sol) {
        const st2 = cloneState(sol)
        st2.edges[0] = st2.edges[0] === 1 ? 0 : 1
        const back2 = deserializeState(serializeState(st2))
        if (!back2 || back2.edges[0] !== st2.edges[0]) stateOk = false
      }
    }
    if (!stateOk) errors.push('状态序列化往返失败')
  }

  // —— 自定义题编解码 ——
  let customOk = true
  {
    const w = 6
    const h = 6
    const grid = new Array<number | null>(w * h).fill(null)
    grid[0] = 1
    grid[7] = 1
    grid[35] = 1
    const puzzle = custom.makePuzzle(w, h, grid, 'galaxies-custom-test')
    const record = { ...custom.encodePuzzle(puzzle), id: puzzle.id, width: w, height: h, name: puzzle.name }
    const back = custom.decodePuzzle(record)
    if (!back) customOk = false
    else {
      const pDots = asGalaxyPuzzle(puzzle).dots
      const bDots = asGalaxyPuzzle(back).dots
      if (formatDots(pDots) !== formatDots(bDots)) customOk = false
      const gridBack = custom.toGrid?.(back)
      if (!gridBack || gridBack.grid[0] !== 1 || gridBack.grid[7] !== 1) customOk = false
    }
    if (!customOk) errors.push('自定义题编解码往返失败')
  }

  // —— 状态栏文案 ——
  let statusOk = true
  {
    const puzzle = builtinPuzzles[0]
    if (puzzle) {
      const ref = getReferenceSolution(puzzle.id)
      if (ref) {
        const bits = statusBits(validate(ref, puzzle))
        if (!bits.length || !bits[0]!.includes('完成')) statusOk = false
      } else statusOk = false
    } else statusOk = false
    if (!statusOk) errors.push('完成状态的状态栏文案不正确')
  }

  // —— 提示一格整体布尔 ——
  const hintOk = puzzles.every((p) => p.referenceOk)

  // —— 额外：参考解与内置 regions 一致 ——
  for (const puzzle of builtinPuzzles) {
    const p = asGalaxyPuzzle(puzzle)
    if (!p.regions) continue
    const edges = edgesFromRegions(p.width, p.height, p.regions)
    const ref = getReferenceSolution(p.id)
    if (!ref) continue
    const refState = getReferenceSolution(p.id)
    if (!refState) continue
    const refEdges = asGalaxyState(refState).edges
    for (let e = 0; e < edges.length; e++) {
      if (refEdges[e] !== edges[e]) {
        errors.push(`${p.id}: 参考解边状态与区域号不一致（边 ${e}）`)
        break
      }
    }
    const re = analyze(p, edges)
    if (!re.solved) errors.push(`${p.id}: 由参考解区域号还原的盘面未解出`)
  }

  return {
    rawCount: RAW_PUZZLES.length,
    loadedCount: builtinPuzzles.length,
    puzzles,
    errors,
    customOk,
    stateOk,
    hintOk,
    statusOk,
  }
}
