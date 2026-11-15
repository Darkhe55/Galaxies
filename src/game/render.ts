/**
 * 星系 —— SVG 渲染与命中
 *
 * 视觉层次：
 *   棋盘底色 → 区域填色（贪心四色，相邻区域不同色）→ 浅网格线 →
 *   玩家画的粗边界 → 圆点 → 错误高亮 → 边的透明命中层
 */

import type { BoardMetrics, GameState, Puzzle, ValidationResult } from '../core/types'
import { edgeCells, edgeCenter, edgeCount, regionFill, squareMetrics } from '../core/board'
import {
  asGalaxyPuzzle,
  asGalaxyState,
  dotOffset,
  WALL,
  type GalaxyResult,
} from './types'
import { regionsFromEdges } from './validate'

export function metricsFor(puzzle: Puzzle): BoardMetrics {
  const area = puzzle.width * puzzle.height
  const cell = area <= 64 ? 58 : area <= 100 ? 52 : area <= 169 ? 44 : area <= 256 ? 38 : 32
  const pad = Math.max(20, Math.round(cell * 0.46))
  return squareMetrics(puzzle.width, puzzle.height, {
    cell,
    pad,
    targetKind: 'edge',
  })
}

/** 相邻区域贪心配色：返回 regionIndex → 调色板下标 */
function regionPaletteIndex(
  w: number,
  h: number,
  regionOf: Int32Array,
  edgeOn: ArrayLike<number>,
): number[] {
  const regionCount = regionOf.reduce((m, r) => Math.max(m, r + 1), 0)
  const adj: Array<Set<number>> = Array.from({ length: regionCount }, () => new Set<number>())
  for (let e = 0; e < edgeOn.length; e++) {
    if ((edgeOn[e] ?? 0) !== WALL) continue
    const pair = edgeCells(e, w, h)
    if (!pair) continue
    const ra = regionOf[pair.a]!
    const rb = regionOf[pair.b]!
    if (ra === rb) continue
    adj[ra]?.add(rb)
    adj[rb]?.add(ra)
  }
  const used: number[] = new Array(regionCount).fill(-1)
  const paletteSize = 12
  for (let r = 0; r < regionCount; r++) {
    const forbidden = new Set<number>()
    for (const n of adj[r] ?? []) if (used[n]! >= 0) forbidden.add(used[n]!)
    let pick = 0
    while (pick < paletteSize && forbidden.has(pick)) pick++
    used[r] = pick % paletteSize
  }
  return used
}

export function renderBoard(
  puzzle: Puzzle,
  state: GameState,
  result: ValidationResult,
  _colorGrid?: unknown,
): string {
  const m = metricsFor(puzzle)
  const p = asGalaxyPuzzle(puzzle)
  const s = asGalaxyState(state)
  const r = result as GalaxyResult
  const w = p.width
  const h = p.height
  const { regionOf } = regionsFromEdges(w, h, s.edges)
  const palette = regionPaletteIndex(w, h, regionOf, s.edges)
  const bad = new Set<number>(r.badCells ?? [])
  const warn = new Set<number>(r.warnCells ?? [])
  const badDots = new Set<number>(r.badDots ?? [])
  const warnDots = new Set<number>(r.warnDots ?? [])
  const ox = m.originX ?? m.pad
  const oy = m.originY ?? m.pad
  const cw = m.cellW ?? m.cell
  const ch = m.cellH ?? m.cell

  const parts: string[] = []
  parts.push(
    `<rect class="gx-board-bg" x="${(ox - m.pad * 0.4).toFixed(2)}" y="${(oy - m.pad * 0.4).toFixed(2)}" width="${(w * cw + m.pad * 0.8).toFixed(2)}" height="${(h * ch + m.pad * 0.8).toFixed(2)}" rx="${(m.cell * 0.18).toFixed(2)}" />`,
  )

  // —— 区域填色 ——
  const fills: string[] = []
  for (let i = 0; i < w * h; i++) {
    const x = ox + (i % w) * cw
    const y = oy + Math.floor(i / w) * ch
    const region = regionOf[i] ?? 0
    const fill = regionFill(palette[region] ?? 0)
    fills.push(
      `<rect class="gx-region" data-region="${region}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cw.toFixed(2)}" height="${ch.toFixed(2)}" fill="${fill}" />`,
    )
  }
  parts.push(`<g class="gx-regions">${fills.join('')}</g>`)

  // —— 浅网格线（所有内部边都画淡线，边界另画粗线） ——
  const gridLines: string[] = []
  for (let e = 0; e < edgeCount(w, h); e++) {
    if ((s.edges[e] ?? 0) === WALL) continue
    const c = edgeCenter(m, e, w, h)
    if (!c) continue
    const pair = edgeCells(e, w, h)!
    if (pair.horizontal) {
      gridLines.push(
        `<line class="gx-grid-line" x1="${c.x.toFixed(2)}" y1="${(c.y - ch * 0.5).toFixed(2)}" x2="${c.x.toFixed(2)}" y2="${(c.y + ch * 0.5).toFixed(2)}" />`,
      )
    } else {
      gridLines.push(
        `<line class="gx-grid-line" x1="${(c.x - cw * 0.5).toFixed(2)}" y1="${c.y.toFixed(2)}" x2="${(c.x + cw * 0.5).toFixed(2)}" y2="${c.y.toFixed(2)}" />`,
      )
    }
  }
  parts.push(`<g class="gx-grid">${gridLines.join('')}</g>`)

  // —— 错误 / 提示格子 ——
  const marks: string[] = []
  for (const i of bad) {
    const x = ox + (i % w) * cw
    const y = oy + Math.floor(i / w) * ch
    marks.push(
      `<rect class="gx-cell-bad" x="${(x + 1).toFixed(2)}" y="${(y + 1).toFixed(2)}" width="${(cw - 2).toFixed(2)}" height="${(ch - 2).toFixed(2)}" />`,
    )
  }
  for (const i of warn) {
    if (bad.has(i)) continue
    const x = ox + (i % w) * cw
    const y = oy + Math.floor(i / w) * ch
    marks.push(
      `<rect class="gx-cell-warn" x="${(x + 1).toFixed(2)}" y="${(y + 1).toFixed(2)}" width="${(cw - 2).toFixed(2)}" height="${(ch - 2).toFixed(2)}" />`,
    )
  }
  parts.push(`<g class="gx-marks">${marks.join('')}</g>`)

  // —— 玩家画的区域边界（粗线，带 data-index 供落子特效定位） ——
  const walls: string[] = []
  for (let e = 0; e < edgeCount(w, h); e++) {
    if ((s.edges[e] ?? 0) !== WALL) continue
    const c = edgeCenter(m, e, w, h)
    if (!c) continue
    const pair = edgeCells(e, w, h)!
    if (pair.horizontal) {
      walls.push(
        `<line class="gx-wall" data-index="${e}" x1="${c.x.toFixed(2)}" y1="${(c.y - ch * 0.5).toFixed(2)}" x2="${c.x.toFixed(2)}" y2="${(c.y + ch * 0.5).toFixed(2)}" />`,
      )
    } else {
      walls.push(
        `<line class="gx-wall" data-index="${e}" x1="${(c.x - cw * 0.5).toFixed(2)}" y1="${c.y.toFixed(2)}" x2="${(c.x + cw * 0.5).toFixed(2)}" y2="${c.y.toFixed(2)}" />`,
      )
    }
  }
  parts.push(`<g class="gx-walls">${walls.join('')}</g>`)

  // 外框
  parts.push(
    `<rect class="gx-outline" x="${ox.toFixed(2)}" y="${oy.toFixed(2)}" width="${(w * cw).toFixed(2)}" height="${(h * ch).toFixed(2)}" />`,
  )

  // —— 圆点 ——
  const dots: string[] = []
  for (let d = 0; d < p.dots.length; d++) {
    const dot = p.dots[d]!
    const off = dotOffset(dot)
    const cx = ox + off.dx * cw
    const cy = oy + off.dy * ch
    const isBad = badDots.has(d)
    const isWarn = !isBad && warnDots.has(d)
    dots.push(
      `<g class="gx-dot-group${isBad ? ' bad' : isWarn ? ' warn' : ''}" data-dot="${d}">` +
        `<circle class="gx-dot-halo" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(m.cell * 0.19).toFixed(2)}" />` +
        `<circle class="gx-dot" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(m.cell * 0.125).toFixed(2)}" />` +
        `</g>`,
    )
  }
  parts.push(`<g class="gx-dots">${dots.join('')}</g>`)

  // —— 命中层：每条边一块透明矩形 ——
  const hits: string[] = []
  for (let e = 0; e < edgeCount(w, h); e++) {
    const c = edgeCenter(m, e, w, h)
    if (!c) continue
    const pair = edgeCells(e, w, h)!
    // pair.horizontal = 左右相邻 → 真实边界是一条竖线；反之为横线
    if (pair.horizontal) {
      const hitW = Math.max(12, cw * 0.42)
      const hitH = ch * 0.92
      hits.push(
        `<rect class="gx-edge-hit" data-index="${e}" data-dir="v" x="${(c.x - hitW / 2).toFixed(2)}" y="${(c.y - hitH / 2).toFixed(2)}" width="${hitW.toFixed(2)}" height="${hitH.toFixed(2)}" />`,
      )
    } else {
      const hitW = cw * 0.92
      const hitH = Math.max(12, ch * 0.42)
      hits.push(
        `<rect class="gx-edge-hit" data-index="${e}" data-dir="h" x="${(c.x - hitW / 2).toFixed(2)}" y="${(c.y - hitH / 2).toFixed(2)}" width="${hitW.toFixed(2)}" height="${hitH.toFixed(2)}" />`,
      )
    }
  }
  parts.push(`<g class="gx-hits">${hits.join('')}</g>`)

  return `<svg class="board-svg gx-board" viewBox="0 0 ${m.svgWidth} ${m.svgHeight}" width="${m.svgWidth}" height="${m.svgHeight}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - x1, py - y1)
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** 边对应的真实边界线段（两格公共边的两端点） */
export function boundarySegment(
  m: BoardMetrics,
  e: number,
  w: number,
  h: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const pair = edgeCells(e, w, h)
  if (!pair) return null
  const o = { x: m.originX ?? m.pad, y: m.originY ?? m.pad }
  const cw = m.cellW ?? m.cell
  const ch = m.cellH ?? m.cell
  if (pair.horizontal) {
    const x = o.x + (pair.a % w) * cw + cw
    const y = o.y + Math.floor(pair.a / w) * ch
    return { x1: x, y1: y, x2: x, y2: y + ch }
  }
  const x = o.x + (pair.a % w) * cw
  const y = o.y + Math.floor(pair.a / w) * ch + ch
  return { x1: x, y1: y, x2: x + cw, y2: y }
}

export function hitTest(
  m: BoardMetrics,
  _puzzle: Puzzle,
  x: number,
  y: number,
): { index: number; kind: 'edge' } | null {
  const total = edgeCount(m.width, m.height)
  const tol = Math.min(m.cellW ?? m.cell, m.cellH ?? m.cell) * 0.36
  let best = -1
  let bestDist = Infinity
  for (let e = 0; e < total; e++) {
    const seg = boundarySegment(m, e, m.width, m.height)
    if (!seg) continue
    const d = distToSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
  }
  return best >= 0 && bestDist <= tol ? { index: best, kind: 'edge' } : null
}
