/**
 * ════════════════════════════════════════════════════════════════════
 *  星系（Galaxies）—— 游戏适配器
 * ════════════════════════════════════════════════════════════════════
 *
 * 规则：
 *   1. 棋盘上给出若干圆点（位于格子中心或格线交点上）；
 *   2. 把棋盘划分成若干区域，每个区域恰好包含一个圆点；
 *   3. 每个区域必须关于自己的圆点呈 180° 旋转对称；
 *   4. 所有格子都要被覆盖，区域互不重叠。
 *
 * 状态：每条相邻格之间的边 0 = 同区域 / 1 = 区域边界。
 */

import { playDrop, playPluck } from '../core/audio'
import type { CustomSupport, GameAdapter, Move, Puzzle, SolveResult } from '../core/types'
import { custom as customSupport } from './custom'
import { planLogicSolve } from './logic'
import { builtinPuzzles, getReferenceSolution } from './puzzles'
import { hitTest, metricsFor, renderBoard } from './render'
import { solvePuzzle } from './solver'
import {
  applyMove,
  cloneState,
  createEmptyState,
  cycleValue,
  deserializeState,
  firstHintMove,
  invertMove,
  rightClickValue,
  serializeState,
  valueAt,
} from './state'
import { WALL } from './types'
import { statusBits, validate } from './validate'

const meta = {
  title: '星系（Galaxies）',
  tagline: '每个圆点一个 180° 旋转对称的区域 —— 用边界把星空分成星系',
  footerNote:
    '规则：把棋盘划分成若干区域，每个区域恰好包含一个圆点，并且关于该圆点 180° 旋转对称；所有格子都要被覆盖。圆点可能在格子中心，也可能在格线交点上。',
  storageKeyPrefix: 'galaxies',
  customIdPrefix: 'galaxies-custom-',
  customMinW: 4,
  customMinH: 4,
  customMaxW: 30,
  customMaxH: 30,
  targetKind: 'edge' as const,
  interactionHint:
    '<kbd>左键拖拽</kbd> 画边界 · <kbd>右键</kbd> 擦除 · <kbd>方向键</kbd> 移动光标 · <kbd>空格</kbd> 切换刚跨过的边界',
}

const custom: CustomSupport = customSupport

function playForMove(move: Move, streak: number): void {
  // to = 画边界（落子）→ 拨弦；to = 擦除 → 水滴
  if (move.to === WALL) playPluck(streak, 1)
  else playDrop(streak)
}

export const adapter: GameAdapter = {
  meta,
  builtinPuzzles,
  getReferenceSolution,
  createEmptyState,
  cloneState,
  cycleValue,
  rightClickValue,
  applyMove,
  invertMove,
  valueAt,
  serializeState,
  deserializeState,
  validate,
  statusBits,
  metricsFor,
  renderBoard,
  hitTest,
  planLogicSolve,
  solvePuzzle: (puzzle: Puzzle, maxNodes?: number): SolveResult => solvePuzzle(puzzle, maxNodes),
  firstHintMove,
  custom,
  playForMove,
}
