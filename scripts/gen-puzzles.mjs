/**
 * 题库生成器（星系）
 *
 * 读取 scripts/gen-config.mjs 的 generatePuzzles()，校验结构后写入
 * src/game/puzzles-data.ts。
 *
 * 题面字段：
 *   dots     —— 圆点串 "x,y;x,y;…"（半格坐标：格心=奇数、格点=偶数）
 *   solution —— 参考解：每格一个 base36 区域号（= dots 下标）
 */
import { writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const DATA_FILE = path.resolve('src/game/puzzles-data.ts')
const CONFIG_FILE = path.resolve('scripts/gen-config.mjs')

let items = []
let generatorName = ''

if (existsSync(CONFIG_FILE)) {
  const cfg = await import(`./gen-config.mjs?t=${Date.now()}`)
  if (cfg && typeof cfg.generatePuzzles === 'function') {
    items = (await cfg.generatePuzzles()) || []
    generatorName = cfg.NAME || '星系生成器'
  }
} else {
  console.warn('[gen] 未找到 scripts/gen-config.mjs，将生成空题库。')
}

for (const p of items) {
  if (!p || typeof p.id !== 'string' || !p.name || !p.width || !p.height) {
    throw new Error('[gen] 无效的题面条目：' + JSON.stringify(p))
  }
  if (typeof p.dots !== 'string' || !p.dots.trim()) {
    throw new Error(`[gen] ${p.id} 缺少圆点串`)
  }
  if (typeof p.solution !== 'string' || p.solution.length !== p.width * p.height) {
    throw new Error(`[gen] ${p.id} 的 solution 长度不等于 ${p.width}×${p.height}`)
  }
  if (!['easy', 'medium', 'hard', 'custom'].includes(p.difficulty)) {
    throw new Error(`[gen] ${p.id} 难度非法`)
  }
}
if (items.length < 6) throw new Error(`[gen] 只生成出 ${items.length} 道题，至少需要 6 道`)

const lines = []
lines.push('/* 自动生成，勿手改。运行 npm run gen 重新生成。 */')
lines.push('')
lines.push('export interface RawPuzzle {')
lines.push('  id: string')
lines.push('  name: string')
lines.push('  width: number')
lines.push('  height: number')
lines.push(`  difficulty: 'easy' | 'medium' | 'hard' | 'custom'`)
lines.push('  series: string')
lines.push('  /** 圆点串 "x,y;x,y;…"（半格坐标：格心=奇数、格点=偶数） */')
lines.push('  dots: string')
lines.push('  /** 参考解：每格一个 base36 区域号（= dots 下标） */')
lines.push('  solution: string')
lines.push('}')
lines.push('')
lines.push('export const RAW_PUZZLES: RawPuzzle[] = [')
for (const p of items) {
  lines.push(
    `  { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, width: ${p.width}, height: ${p.height}, difficulty: ${JSON.stringify(p.difficulty)}, series: ${JSON.stringify(p.series || '内置')}, dots: ${JSON.stringify(p.dots)}, solution: ${JSON.stringify(p.solution)} },`,
  )
}
lines.push(']')
lines.push('')
writeFileSync(DATA_FILE, lines.join('\n'))
console.log(`[gen] 写入 ${DATA_FILE}：${items.length} 题（${generatorName}）`)
