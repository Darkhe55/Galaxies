/**
 * 星系（Galaxies）题面图片导入（自动识图）
 *
 * 用法：
 *   node scripts/import-image.mjs <图片路径> [--size N | --width W --height H]
 *                                  [--name 名称] [--id ID] [--append] [--verify] [--dry]
 *
 * 识图原理：
 *   1. Playwright + Edge 打开图片到 canvas，取像素；
 *   2. 找题板粗黑外框 → 题板范围；浅灰细线投影 → 网格线，得到格距与格子数；
 *   3. 暗色连通域里挑出近正方形的圆环 = 星系圆点；
 *   4. 圆心落在「格点（网格线交点）」或「格心」上，换算成半格坐标：
 *        格点 x = 2k（偶数）、格心 x = 2k+1（奇数）
 *   5. 生成题库格式 dots = "x,y;x,y;…"；--append 写入 src/game/imported-puzzles.ts。
 *
 * 说明：项目现有参考解编码是 base36（≤36 个圆点），超过 36 个圆点的导入题
 * 仍可正常游玩（只是没有「显示解」参考解），这里会给出提示。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { build as esbuild } from 'esbuild'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EDGE_PATH =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name)
  if (i < 0) return fallback
  return process.argv[i + 1] ?? fallback
}
function has(name) {
  return process.argv.includes(name)
}

const imageArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!imageArg) {
  console.error(
    '用法：node scripts/import-image.mjs <图片路径> [--size N | --width W --height H] [--name 名称] [--id ID] [--append] [--verify] [--dry]',
  )
  process.exit(1)
}
const imagePath = path.resolve(process.cwd(), imageArg)
if (!existsSync(imagePath)) {
  console.error(`[import] 找不到图片：${imagePath}`)
  process.exit(1)
}

const sizeOpt = Number(arg('--size', '0')) || 0
const widthOpt = Number(arg('--width', '0')) || 0
const heightOpt = Number(arg('--height', '0')) || 0
const name = arg('--name', path.basename(imagePath, path.extname(imagePath)))
const id = arg('--id', `galaxies-import-${Date.now().toString(36)}`)
const series = arg('--series', '导入')
const append = has('--append')
const verify = has('--verify')
const dry = has('--dry')

/* ───────────────────────── 识图（浏览器内） ───────────────────────── */

const dataUrl = `data:image/png;base64,${readFileSync(imagePath).toString('base64')}`
const browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH })
const page = await browser.newPage()
await page.setContent('<canvas id="c"></canvas>')

const analyzed = await page.evaluate(async (url) => {
  const img = new Image()
  img.src = url
  await img.decode()
  const W = img.naturalWidth
  const H = img.naturalHeight
  const cv = document.getElementById('c')
  cv.width = W
  cv.height = H
  const g = cv.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0)
  const px = g.getImageData(0, 0, W, H).data
  const lum = (x, y) => {
    const i = (y * W + x) * 4
    return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
  }
  const dark = (x, y) => lum(x, y) < 110

  // 1) 粗黑外框：整行/整列大量暗像素
  const colDark = new Int32Array(W)
  const rowDark = new Int32Array(H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (dark(x, y)) {
        colDark[x]++
        rowDark[y]++
      }
  const lineCenters = (arr, minCount) => {
    const out = []
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] < minCount) continue
      let j = i
      while (j + 1 < arr.length && arr[j + 1] >= minCount) j++
      out.push((i + j) / 2)
      i = j
    }
    return out
  }
  const borderXs = lineCenters(colDark, H * 0.7)
  const borderYs = lineCenters(rowDark, W * 0.7)

  // 2) 浅灰网格线
  const isGridLine = (x, y) => {
    const l = lum(x, y)
    return l >= 170 && l <= 250
  }
  const colLine = new Int32Array(W)
  const rowLine = new Int32Array(H)
  const y0 = Math.max(0, Math.round((borderYs[0] ?? 0) + 4))
  const y1 = Math.min(H, Math.round((borderYs[borderYs.length - 1] ?? H) - 4))
  const x0 = Math.max(0, Math.round((borderXs[0] ?? 0) + 4))
  const x1 = Math.min(W, Math.round((borderXs[borderXs.length - 1] ?? W) - 4))
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (isGridLine(x, y)) {
        colLine[x]++
        rowLine[y]++
      }
  const gridXs = lineCenters(colLine, Math.max(8, (y1 - y0) * 0.5)).map((v) => v)
  const gridYs = lineCenters(rowLine, Math.max(8, (x1 - x0) * 0.5))

  // 3) 圆环连通域
  const seen = new Uint8Array(W * H)
  const rings = []
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      if (seen[k] || !dark(x, y)) continue
      let n = 0
      let sx = 0
      let sy = 0
      let minX = x
      let maxX = x
      let minY = y
      let maxY = y
      const st = [[x, y]]
      seen[k] = 1
      while (st.length) {
        const [cx, cy] = st.pop()
        n++
        sx += cx
        sy += cy
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const nk = ny * W + nx
          if (seen[nk] || !dark(nx, ny)) continue
          seen[nk] = 1
          st.push([nx, ny])
        }
      }
      const bw = maxX - minX + 1
      const bh = maxY - minY + 1
      if (bw >= 16 && bh >= 16 && bw <= 34 && bh <= 34 && Math.abs(bw - bh) <= 4) {
        rings.push({ cx: sx / n, cy: sy / n, w: bw, h: bh })
      }
    }
  return { W, H, borderXs, borderYs, gridXs, gridYs, rings }
}, dataUrl)
await browser.close()

const { W, H, borderXs, borderYs, gridXs, gridYs, rings } = analyzed
if (borderXs.length < 2 || borderYs.length < 2) {
  console.error('[import] 没找到题板粗黑外框，请确认图片是星系（Galaxies）题面')
  process.exit(1)
}
const boardLeft = borderXs[0]
const boardRight = borderXs[borderXs.length - 1]
const boardTop = borderYs[0]
const boardBottom = borderYs[borderYs.length - 1]

// 格距：优先用检出的网格线间距
function medianGap(lines) {
  if (lines.length < 2) return 0
  const gaps = []
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i] - lines[i - 1])
  gaps.sort((a, b) => a - b)
  return gaps[Math.floor(gaps.length / 2)]
}
let gapX = medianGap(gridXs)
let gapY = medianGap(gridYs)
if (!gapX) gapX = (boardRight - boardLeft) / Math.round((boardRight - boardLeft) / Math.max(20, (boardRight - boardLeft) / 30))
if (!gapY) gapY = gapX
// 由外框宽度推列数（取整后反推格距，比线检测更稳）
let nCols = widthOpt || sizeOpt || Math.round((boardRight - boardLeft) / gapX)
let nRows = heightOpt || sizeOpt || Math.round((boardBottom - boardTop) / gapY)
if (widthOpt || sizeOpt) gapX = (boardRight - boardLeft) / nCols
if (heightOpt || sizeOpt) gapY = (boardBottom - boardTop) / nRows
if (nCols < 2 || nRows < 2 || !Number.isFinite(gapX) || !Number.isFinite(gapY)) {
  console.error(`[import] 网格识别失败：${nCols}×${nRows}，格距 ${gapX.toFixed(2)}×${gapY.toFixed(2)}`)
  process.exit(1)
}

console.log(
  `[import] ${path.basename(imagePath)}：${W}×${H}，题板 ${nCols}×${nRows}，` +
    `格距 ${gapX.toFixed(2)}×${gapY.toFixed(2)}px，圆环 ${rings.length} 个`,
)

// 圆点 → 半格坐标
const dots = []
const used = new Set()
let maxDev = 0
for (const r of rings) {
  const fx = (r.cx - boardLeft) / gapX
  const fy = (r.cy - boardTop) / gapY
  const hx = Math.round(fx * 2)
  const hy = Math.round(fy * 2)
  maxDev = Math.max(maxDev, Math.abs(fx * 2 - hx), Math.abs(fy * 2 - hy))
  if (hx < 0 || hy < 0 || hx > nCols * 2 || hy > nRows * 2) continue
  // 半格坐标的 4 种奇偶组合都合法：偶偶=格点、奇奇=格心、奇偶/偶奇=边中点
  const key = `${hx},${hy}`
  if (used.has(key)) {
    console.warn(`[import] 警告：重复圆点 ${key}，已跳过`)
    continue
  }
  used.add(key)
  dots.push({ x: hx, y: hy })
}
dots.sort((a, b) => a.y - b.y || a.x - b.x)
if (!dots.length) {
  console.error('[import] 没有识别到圆点')
  process.exit(1)
}
const centerDots = dots.filter((d) => d.x % 2 === 1 && d.y % 2 === 1).length
console.log(
  `[import] 圆点 ${dots.length} 个（格心 ${centerDots} / 格点 ${dots.length - centerDots}），` +
    `最大格点偏差 ${maxDev.toFixed(2)} 半格`,
)
if (maxDev > 0.25) {
  console.warn('[import] 警告：圆点与格点偏差偏大，可能格距不准；可用 --width/--height 覆盖')
}

// 预览：格心圆点 o，格点圆点 +，空白 ·
const dotSet = new Set(dots.map((d) => `${d.x},${d.y}`))
console.log('[import] 圆点预览（o=格心 + =格点）：')
for (let y = 0; y < nRows * 2 + 1; y++) {
  let line = '  '
  for (let x = 0; x < nCols * 2 + 1; x++) {
    const key = `${x},${y}`
    line += dotSet.has(key) ? ((x + y) % 2 === 0 ? ' +' : ' o') : ' ·'
  }
  console.log(line)
}

const dotsStr = dots.map((d) => `${d.x},${d.y}`).join(';')
if (dots.length > 36) {
  console.warn(
    `[import] 提示：圆点 ${dots.length} 个超过 36 个（项目参考解编码上限），` +
      '导入后可以正常游玩，但没有「显示解」参考解',
  )
}

/* ───────────────────────── 校验求解 ───────────────────────── */

if (verify) {
  const bundleFile = path.join(ROOT, 'node_modules', '.cache', 'import-verify-galaxies.mjs')
  await esbuild({
    absWorkingDir: ROOT,
    stdin: {
      contents: `export { countSolutions } from './src/game/solver.ts'`,
      resolveDir: ROOT,
      sourcefile: 'import-verify-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundleFile,
    logLevel: 'silent',
  })
  const { countSolutions } = await import(pathToFileURL(bundleFile).href)
  const puzzle = { id, name, width: nCols, height: nRows, difficulty: 'custom', dots }
  const t0 = Date.now()
  const res = countSolutions(puzzle, 2, 400_000)
  const ms = Date.now() - t0
  if (res.timedOut) {
    console.warn(`[import] 唯一性检查超时（${res.nodes} 节点 / ${ms}ms），无法确认唯一解`)
  } else if (res.solutions.length === 0) {
    console.error('[import] 无解：圆点识别可能有误')
    if (!dry) process.exit(1)
  } else if (res.solutions.length >= 2) {
    console.warn(`[import] 解不唯一：至少 ${res.solutions.length} 个（${res.nodes} 节点 / ${ms}ms）`)
  } else {
    console.log(`[import] 唯一解检查通过（${res.nodes} 节点 / ${ms}ms）`)
  }
}

if (dry) {
  console.log('[import] --dry：仅识别，不写入。')
  process.exit(0)
}
if (!append) {
  console.log('[import] 预览模式（未写入）。dots 编码：')
  console.log(JSON.stringify(dotsStr))
  console.log('[import] 加 --append 可写入 src/game/imported-puzzles.ts')
  process.exit(0)
}

/* ───────────────────────── 写入题库 ───────────────────────── */

const file = path.join(ROOT, 'src/game/imported-puzzles.ts')
const entry = `  { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, width: ${nCols}, height: ${nRows}, difficulty: "custom", series: ${JSON.stringify(series)}, dots: ${JSON.stringify(dotsStr)}, solution: "" },\n`
if (!existsSync(file)) {
  writeFileSync(
    file,
    `/* 由 scripts/import-image.mjs 追加，npm run gen 不会覆盖。 */\nimport type { RawPuzzle } from './puzzles-data.ts'\n\nexport const IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]\n`,
  )
} else {
  let text = readFileSync(file, 'utf8')
  if (text.includes('IMPORTED_PUZZLES: RawPuzzle[] = []')) {
    text = text.replace('IMPORTED_PUZZLES: RawPuzzle[] = []', `IMPORTED_PUZZLES: RawPuzzle[] = [\n${entry}]`)
  } else {
    const marker = text.lastIndexOf('\n]')
    if (marker < 0) throw new Error('imported-puzzles.ts 格式异常，找不到数组结尾')
    text = text.slice(0, marker + 1) + entry + text.slice(marker + 1)
  }
  writeFileSync(file, text)
}
console.log(`[import] 已写入 ${file}`)
