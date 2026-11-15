/**
 * 星系 —— 题库加载（内置题）
 */

import type { GameState } from '../core/types'
import { RAW_PUZZLES } from './puzzles-data'
import {
  asGalaxyPuzzle,
  decodeRegions,
  edgesFromRegions,
  parseDots,
  puzzleIssues,
  type GalaxyPuzzle,
  type GalaxyState,
} from './types'

export const builtinPuzzles: GalaxyPuzzle[] = []
const solutions = new Map<string, number[]>()

for (const raw of RAW_PUZZLES) {
  const size = raw.width * raw.height
  const dots = parseDots(raw.dots)
  if (!dots) {
    console.warn(`[星系] 题面圆点解析失败：${raw.id}`)
    continue
  }
  const puzzle: GalaxyPuzzle = {
    id: raw.id,
    name: raw.name,
    width: raw.width,
    height: raw.height,
    difficulty: raw.difficulty,
    dots,
  }
  const regions = raw.solution ? decodeRegions(raw.solution, size) : null
  if (regions) puzzle.regions = regions
  const issues = puzzleIssues(puzzle)
  if (issues.length) {
    console.warn(`[星系] 跳过结构异常的题面 ${raw.id}：${issues.join('；')}`)
    continue
  }
  builtinPuzzles.push(puzzle)
  if (regions) solutions.set(raw.id, regions)
}

export function getReferenceSolution(id: string): GameState | null {
  const regions = solutions.get(id)
  if (!regions) return null
  const puzzle = builtinPuzzles.find((p) => p.id === id)
  if (!puzzle) return null
  const state: GalaxyState = {
    puzzleId: puzzle.id,
    width: puzzle.width,
    height: puzzle.height,
    edges: edgesFromRegions(puzzle.width, puzzle.height, regions),
  }
  return state
}

export function puzzleById(id: string): GalaxyPuzzle | undefined {
  return builtinPuzzles.find((p) => p.id === id)
}

/** 参考解区域号（生成器/审计用） */
export function referenceRegions(puzzle: GalaxyPuzzle): number[] | null {
  const p = asGalaxyPuzzle(puzzle)
  return p.regions ?? solutions.get(p.id) ?? null
}
