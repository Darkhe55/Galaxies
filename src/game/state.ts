/**
 * 星系 —— 棋盘状态（每条边 0/1）
 */

import type { GameState, HitTarget, Move, Puzzle } from '../core/types'
import { edgeCount } from '../core/board'
import {
  asGalaxyPuzzle,
  asGalaxyState,
  decodeEdges,
  encodeEdges,
  OPEN,
  WALL,
  type GalaxyState,
} from './types'

export function createEmptyState(puzzle: Puzzle): GalaxyState {
  const p = asGalaxyPuzzle(puzzle)
  return {
    puzzleId: p.id,
    width: p.width,
    height: p.height,
    edges: new Array<number>(edgeCount(p.width, p.height)).fill(OPEN),
  }
}

export function cloneState(state: GameState): GalaxyState {
  const s = asGalaxyState(state)
  return {
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    edges: s.edges.slice(),
  }
}

export function edgeValue(state: GameState, edge: number): number {
  return asGalaxyState(state).edges[edge] ?? OPEN
}

/** 左键：画边界 ↔ 擦除 */
export function cycleValue(state: GameState, target: HitTarget): number {
  return edgeValue(state, target.index) === WALL ? OPEN : WALL
}

/** 右键：擦除 */
export function rightClickValue(): number {
  return OPEN
}

export function applyMove(state: GameState, move: Move): void {
  const s = asGalaxyState(state)
  if (move.index < 0 || move.index >= s.edges.length) return
  s.edges[move.index] = move.to === WALL ? WALL : OPEN
}

export function invertMove(move: Move): Move {
  return { index: move.index, from: move.to, to: move.from }
}

export function valueAt(state: GameState, index: number): number {
  return asGalaxyState(state).edges[index] ?? OPEN
}

export function serializeState(state: GameState): Record<string, unknown> {
  const s = asGalaxyState(state)
  return {
    version: 1,
    puzzleId: s.puzzleId,
    width: s.width,
    height: s.height,
    edges: encodeEdges(s.edges),
  }
}

export function deserializeState(data: Record<string, unknown>): GalaxyState | null {
  if (typeof data.puzzleId !== 'string') return null
  if (typeof data.width !== 'number' || typeof data.height !== 'number') return null
  const w = data.width
  const h = data.height
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return null
  const expected = edgeCount(w, h)
  let edges: number[] | null = null
  if (typeof data.edges === 'string') {
    edges = decodeEdges(data.edges, expected)
  } else if (Array.isArray(data.edges)) {
    if (data.edges.length !== expected) return null
    edges = data.edges.map((v) => (Number(v) === WALL ? WALL : OPEN))
  }
  if (!edges) return null
  return { puzzleId: data.puzzleId, width: w, height: h, edges }
}

/**
 * 提示一格：找到第一处与参考解不同的边，返回把它改成参考解值的 move。
 * 参考解比当前多一条边界 → from=0（播放拨弦音）；反之 → from=1（水滴音）。
 */
export function firstHintMove(state: GameState, solution: GameState): Move | null {
  const s = asGalaxyState(state)
  const sol = asGalaxyState(solution)
  const total = Math.min(s.edges.length, sol.edges.length)
  for (let e = 0; e < total; e++) {
    const from = s.edges[e] ?? OPEN
    const to = sol.edges[e] ?? OPEN
    if (from !== to) return { index: e, from, to }
  }
  return null
}
