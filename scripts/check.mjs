/**
 * 星系 —— 题库深度审计（npm run check）
 *
 * 在 Node 里用 esbuild 打包 src/game 的纯逻辑模块，逐题检查：
 *  1. RAW_PUZZLES 结构（id / 名称 / 宽高 / 难度 / 圆点串 / 参考解编码）
 *  2. 参考解能通过规则校验
 *  3. 题目唯一解（最多找 2 个解，必须只有 1 个）
 *  4. 逻辑解题（纯规则 + 反证）能推完，且终态合法
 *  5. 状态序列化往返、自定义题编解码、提示一格、状态栏文案
 *
 * 退出码：有任何错误 → 1。
 */
import { importTs } from './_bundle.mjs'

const mod = await importTs('src/game/audit.ts')
const report = mod.runAudit()

console.log('[check] 星系（Galaxies）题库审计')
console.log(`[check] 题目：RAW ${report.rawCount} 道 / 实际载入 ${report.loadedCount} 道`)
console.log('')
const header = ['题目', '尺寸', '圆点', '参考解', '唯一解', '解数', '逻辑帧', '逻辑解完']
const rows = report.puzzles.map((p) => [
  p.name,
  p.size,
  String(p.dots),
  p.referenceOk ? 'OK' : 'FAIL',
  p.unique ? 'YES' : 'NO',
  String(p.solutions),
  String(p.logicFrames),
  p.logicSolved && p.saturated ? 'OK' : 'NO',
])
const widths = header.map((h, i) =>
  Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ''))),
)
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - displayWidth(s)))
console.log('  ' + header.map((h, i) => pad(h, widths[i])).join('  '))
for (const r of rows) console.log('  ' + r.map((c, i) => pad(c, widths[i])).join('  '))

/** 中文字符按 2 列宽估算 */
function displayWidth(text) {
  let n = 0
  for (const ch of text) n += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1
  return n
}

console.log('')
console.log(
  `[check] 附加检查：状态序列化 ${report.stateOk ? 'OK' : 'FAIL'} · 自定义编解码 ${report.customOk ? 'OK' : 'FAIL'} · 提示一格 ${report.hintOk ? 'OK' : 'FAIL'} · 状态栏 ${report.statusOk ? 'OK' : 'FAIL'}`,
)

if (report.errors.length) {
  console.error('')
  for (const err of report.errors) console.error('[check] ERROR ' + err)
  console.error(`[check] 共 ${report.puzzles.length} 题，错误 ${report.errors.length} 处`)
  process.exitCode = 1
} else {
  console.log(
    `[check] 共 ${report.puzzles.length} 题，全部唯一解、可逻辑推完，错误 0`,
  )
}
