/**
 * 星系（Galaxies）—— Playwright（Edge）端到端验证
 *
 * 覆盖：
 *  - 页面 / 题库 / 参考解合法性
 *  - 内置题：逻辑解题回放、显示解、提示一格
 *  - 鼠标拖拽画边界 + 撤销重做
 *  - 键盘方向键移动光标 + 空格切换边界
 *  - 错误高亮
 *  - 自定义题板：放圆点 → 载入 → 求解 → 保存 → 编辑 → 删除
 *
 * 用法：先启动 5217 端口服务（npm start / npm run dev），再 node scripts/ui-check.mjs
 * 可用环境变量 EDGE_PATH 指定 Edge 可执行文件路径。
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { PORT } from './_port.mjs'

const executablePath =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT_DIR = 'output/playwright'
mkdirSync(OUT_DIR, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath })
const page = await browser.newPage({ viewport: { width: 1360, height: 960 } })

let failures = 0
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('CONSOLE-ERROR', msg.text())
})

function ok(cond, label, extra = '') {
  if (cond) {
    console.log('PASS', label, extra)
  } else {
    failures++
    console.error('FAIL', label, extra)
  }
}

function shot(name) {
  return page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: true })
}

/** viewBox 坐标 → 屏幕坐标 */
async function vbToScreen(x, y) {
  const info = await page.evaluate(() => {
    const svg = document.querySelector('svg.board-svg')
    const r = svg.getBoundingClientRect()
    const vb = svg.viewBox.baseVal
    return { left: r.left, top: r.top, sx: r.width / vb.width, sy: r.height / vb.height, vx: vb.x, vy: vb.y }
  })
  return { x: info.left + (x - info.vx) * info.sx, y: info.top + (y - info.vy) * info.sy }
}

/** 当前盘面的度量与边数量 */
async function boardInfo() {
  return page.evaluate(() => {
    const g = window.__game
    const s = g.getSession()
    const m = g.adapter.metricsFor(s.puzzle)
    return {
      w: s.puzzle.width,
      h: s.puzzle.height,
      ox: m.originX ?? m.pad,
      oy: m.originY ?? m.pad,
      cw: m.cellW ?? m.cell,
      ch: m.cellH ?? m.cell,
      edgeTotal: s.state.edges.length,
      edgeOn: s.state.edges.reduce((a, v) => a + (v ? 1 : 0), 0),
      puzzleId: s.puzzle.id,
      name: s.puzzle.name,
      dots: s.puzzle.dots.map((d) => ({ ...d })),
    }
  })
}

/** 边中点（viewBox 坐标）：horizontal pair = 左右相邻 → 真实边界是竖线 */
async function edgeMidpoint(e) {
  const b = await boardInfo()
  const hCount = b.h * (b.w - 1)
  if (e < hCount) {
    const x = b.ox + (e % (b.w - 1)) * b.cw + b.cw
    const y = b.oy + Math.floor(e / (b.w - 1)) * b.ch + b.ch / 2
    return { x, y }
  }
  const v = e - hCount
  const x = b.ox + (v % b.w) * b.cw + b.cw / 2
  const y = b.oy + Math.floor(v / b.w) * b.ch + b.ch
  return { x, y }
}

async function clickEdge(e) {
  const p = await edgeMidpoint(e)
  const s = await vbToScreen(p.x, p.y)
  await page.mouse.click(s.x, s.y)
  await page.waitForTimeout(70)
}

async function selectPuzzleByName(name) {
  await page.locator('.puzzle-item', { hasText: name }).first().click()
  await page.waitForTimeout(140)
}

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' })
await page.waitForSelector('svg.board-svg')
await page.waitForTimeout(250)

/* ———————————————— 1. 页面/题库 ———————————————— */
ok((await page.title()).includes('星系'), '标题包含「星系」', await page.title())
const puzzleCount = await page.locator('.puzzle-item').count()
ok(puzzleCount >= 6, '内置题库至少 6 道', `count=${puzzleCount}`)
await shot('01-initial.png')

const refReport = await page.evaluate(() => {
  const a = window.__game.adapter
  return a.builtinPuzzles.map((p) => {
    const sol = a.getReferenceSolution(p.id)
    const r = sol ? a.validate(sol, p) : null
    return { id: p.id, name: p.name, solved: r?.solved ?? false }
  })
})
ok(refReport.length >= 6, '参考解数量', `${refReport.length}`)
ok(refReport.every((r) => r.solved), '所有参考解通过校验', JSON.stringify(refReport.filter((r) => !r.solved)))

/* ———————————————— 2. 内置题：逻辑解题 ———————————————— */
await selectPuzzleByName('双星初会')
await page.click('#btn-clear')
await page.waitForTimeout(100)
const logicT0 = Date.now()
await page.click('#btn-logic')
await page.waitForFunction(
  () => {
    const btn = document.querySelector('#btn-logic')
    return btn && btn.textContent === '逻辑解题' && !btn.classList.contains('danger')
  },
  { timeout: 120000 },
)
await page.waitForTimeout(300)
const afterLogic = await page.evaluate(() => {
  const g = window.__game
  const s = g.getSession()
  return {
    solved: g.adapter.validate(s.state, s.puzzle).solved,
    status: document.querySelector('#status').textContent,
    on: s.state.edges.reduce((a, v) => a + (v ? 1 : 0), 0),
  }
})
ok(afterLogic.solved, '逻辑解题回放后盘面解出', JSON.stringify({ ms: Date.now() - logicT0, ...afterLogic }))
await shot('02-builtin-logic.png')

/* ———————————————— 3. 显示解 / 提示一格 ———————————————— */
await page.click('#btn-clear')
await page.click('#btn-solve')
await page.waitForTimeout(180)
const afterSolve = await page.evaluate(() => {
  const g = window.__game
  const s = g.getSession()
  return g.adapter.validate(s.state, s.puzzle).solved
})
ok(afterSolve, '「显示解」填入正确解')
await shot('03-show-solution.png')

await page.click('#btn-clear')
await page.click('#btn-hint')
await page.waitForTimeout(120)
const afterHint = await boardInfo()
ok(afterHint.edgeOn === 1, '「提示一格」画出一条边界', `edgeOn=${afterHint.edgeOn}`)

/* ———————————————— 4. 鼠标拖拽画边界 + 撤销/重做 ———————————————— */
await page.click('#btn-clear')
await page.waitForTimeout(100)
const b = await boardInfo()
const w = b.w
const dragEdges = [0, 1, 2] // 第 0..2 行的第 0 条水平边（左右相邻格之间的竖线）
const startMid = await edgeMidpoint(dragEdges[0])
const endMid = await edgeMidpoint(dragEdges[2])
const start = await vbToScreen(startMid.x, startMid.y)
const end = await vbToScreen(endMid.x, endMid.y)
await page.mouse.move(start.x, start.y)
await page.mouse.down()
const steps = 18
for (let i = 1; i <= steps; i++) {
  const t = i / steps
  await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t)
}
await page.mouse.up()
await page.waitForTimeout(120)
const afterDrag = await boardInfo()
ok(afterDrag.edgeOn === 3, '鼠标拖拽连续画出 3 条边界', `edgeOn=${afterDrag.edgeOn}`)
const dragSvg = await page.evaluate(() => document.querySelectorAll('.gx-wall').length)
ok(dragSvg >= 3, '边界线已渲染到 SVG', `wallLines=${dragSvg}`)
await shot('04-mouse-drag.png')

for (let i = 0; i < 3; i++) {
  await page.click('#btn-undo')
  await page.waitForTimeout(60)
}
const afterUndo = await boardInfo()
ok(afterUndo.edgeOn === 0, '撤销 3 次回到空盘', `edgeOn=${afterUndo.edgeOn}`)
await page.click('#btn-redo')
await page.waitForTimeout(60)
const afterRedo = await boardInfo()
ok(afterRedo.edgeOn === 1, '重做 1 次恢复 1 条边界', `edgeOn=${afterRedo.edgeOn}`)

/* ———————————————— 5. 键盘：方向键移动 + 空格切换 ———————————————— */
await page.click('#btn-clear')
await page.waitForTimeout(100)
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(90)
const cursorVisible = await page.locator('svg.board-svg .kb-cursor').count()
ok(cursorVisible === 1, '键盘光标出现')
await shot('05-keyboard-cursor.png')
await page.keyboard.press('Space')
await page.waitForTimeout(90)
const afterSpace = await boardInfo()
ok(afterSpace.edgeOn === 1, '空格切换出一条边界', `edgeOn=${afterSpace.edgeOn}`)
const cursorEdge = await page.locator('svg.board-svg .kb-cursor-edge').count()
ok(cursorEdge === 1, '键盘光标高亮当前边界')
await page.keyboard.press('Space')
await page.waitForTimeout(90)
const afterSpace2 = await boardInfo()
ok(afterSpace2.edgeOn === 0, '再按空格擦除该边界', `edgeOn=${afterSpace2.edgeOn}`)
await shot('06-keyboard-boundary.png')

/* ———————————————— 6. 实时校验/错误高亮 ———————————————— */
await page.click('#btn-clear')
// 找一条「画上后会出现红色错误格」的边；找不到就退而求其次找提示格
const badEdge = await page.evaluate(() => {
  const g = window.__game
  const s = g.getSession()
  const tryEdges = (edges) => {
    const clone = g.adapter.cloneState(s.state)
    for (const e of edges) clone.edges[e] = 1
    const r = g.adapter.validate(clone, s.puzzle)
    return { bad: r.badCells ? r.badCells.length : 0, warn: r.warnCells ? r.warnCells.length : 0 }
  }
  const total = s.state.edges.length
  // 单条边 / 两条边组合
  for (let e = 0; e < total; e++) {
    const r = tryEdges([e])
    if (r.bad > 0) return { edges: [e], bad: r.bad, warn: r.warn }
  }
  for (let e1 = 0; e1 < total; e1++) {
    for (let e2 = e1 + 1; e2 < total; e2++) {
      const r = tryEdges([e1, e2])
      if (r.bad > 0) return { edges: [e1, e2], bad: r.bad, warn: r.warn }
    }
  }
  // 随机多边组合（更容易造出「含一个圆点但不对称」的区域）
  let seed = 20240101
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let t = 0; t < 30000; t++) {
    const count = 3 + Math.floor(rnd() * 4)
    const set = new Set()
    while (set.size < count) set.add(Math.floor(rnd() * total))
    const r = tryEdges([...set])
    if (r.bad > 0) return { edges: [...set], bad: r.bad, warn: r.warn }
  }
  // 退而求其次：只要提示高亮
  for (let e = 0; e < total; e++) {
    const r = tryEdges([e])
    if (r.warn > 0) return { edges: [e], bad: r.bad, warn: r.warn }
  }
  return { edges: [], bad: 0, warn: 0 }
})
ok(badEdge.edges.length > 0, '找到能触发错误高亮的边界组合', JSON.stringify(badEdge))
if (badEdge.edges.length > 0) {
  for (const e of badEdge.edges) await clickEdge(e)
  await page.waitForTimeout(120)
  const hi = await page.evaluate(() => {
    const g = window.__game
    const s = g.getSession()
    const r = g.adapter.validate(s.state, s.puzzle)
    return {
      badCells: r.badCells.length,
      badDots: r.badDots.length,
      warnCells: r.warnCells.length,
      status: document.querySelector('#status').textContent,
      rects: document.querySelectorAll('.gx-cell-bad, .gx-cell-warn').length,
      dotRects: document.querySelectorAll('.gx-dot-group.bad').length,
    }
  })
  ok(hi.badCells > 0 || hi.warnCells > 0, '出现错误/提示高亮', JSON.stringify(hi))
  ok(hi.rects > 0, '高亮格子已渲染', `rects=${hi.rects}`)
  const redRects = await page.evaluate(() => document.querySelectorAll('.gx-cell-bad').length)
  const statusTone = await page.evaluate(() => document.querySelector('#status').className)
  if (badEdge.bad > 0) {
    ok(redRects > 0, '红色错误格已渲染', `red=${redRects}`)
    ok(statusTone.includes('bad'), '状态栏切换为错误色', statusTone)
  }
  console.log('status:', hi.status, '| class:', statusTone)
  await shot('07-error-highlight.png')
}

/* ———————————————— 7. 自定义题板：放置 / 载入 / 求解 / 保存 ———————————————— */
const sourcePuzzle = await page.evaluate(() => {
  const a = window.__game.adapter
  const p = a.builtinPuzzles.find((x) => x.dots.every((d) => d.x % 2 === 1 && d.y % 2 === 1))
  return p ? { id: p.id, name: p.name, dots: p.dots, width: p.width, height: p.height } : null
})
ok(!!sourcePuzzle, '找到全部为格心圆点的内置题用于自定义题测试')

await page.click('#btn-custom')
await page.waitForTimeout(100)
await page.fill('#custom-w', String(sourcePuzzle.width))
await page.fill('#custom-h', String(sourcePuzzle.height))
await page.click('#custom-regen')
await page.waitForTimeout(120)
const dotCells = sourcePuzzle.dots.map((d) => ((d.y - 1) / 2) * sourcePuzzle.width + (d.x - 1) / 2)
for (const cell of dotCells) {
  await page.locator('.custom-cell').nth(cell).click()
  await page.waitForTimeout(25)
}
const placed = await page.evaluate(() => document.querySelectorAll('.custom-cell:not(.empty)').length)
ok(placed === dotCells.length, '自定义编辑器放置圆点', `placed=${placed}/${dotCells.length}`)
await shot('08-custom-editor.png')

await page.click('#custom-apply')
await page.waitForTimeout(500)
const customLoaded = await page.evaluate(() => {
  const g = window.__game
  const s = g.getSession()
  return {
    id: s.puzzle.id,
    dots: s.puzzle.dots.length,
    name: s.puzzle.name,
    status: document.querySelector('#status').textContent,
    customRows: document.querySelectorAll('[data-edit]').length,
    msg: document.querySelector('#custom-msg').textContent,
  }
})
ok(customLoaded.id.startsWith('galaxies-custom-'), '自定义题 id 前缀正确', customLoaded.id)
ok(customLoaded.dots === dotCells.length, '自定义题圆点数量正确', `${customLoaded.dots}`)
ok(customLoaded.status.includes('唯一解'), '载入时自动校验唯一解', customLoaded.status)

await page.click('#custom-solve')
await page.waitForTimeout(500)
const customSolved = await page.evaluate(() => {
  const g = window.__game
  const s = g.getSession()
  return {
    solved: g.adapter.validate(s.state, s.puzzle).solved,
    status: document.querySelector('#status').textContent,
    msg: document.querySelector('#custom-msg').textContent,
  }
})
ok(customSolved.solved, '自定义题「求解」解出', JSON.stringify(customSolved))
await shot('09-custom-solved.png')

await page.click('#custom-save')
await page.waitForTimeout(300)
await page.click('#custom-close')
await page.waitForTimeout(200)
const savedRows = await page.locator('[data-edit]').count()
ok(savedRows >= 1, '自定义题已保存到题库', `rows=${savedRows}`)
await shot('10-custom-saved.png')

/* ———————————————— 8. 编辑自定义题 ———————————————— */
await page.locator('[data-edit]').first().click()
await page.waitForTimeout(250)
const editBefore = await page.evaluate(() => ({
  filled: document.querySelectorAll('.custom-cell:not(.empty)').length,
  msg: document.querySelector('#custom-msg').textContent,
}))
ok(editBefore.filled === dotCells.length, '编辑已保存题：圆点还原到编辑器', `filled=${editBefore.filled}`)
const firstFilled = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.custom-cell')]
  return cells.findIndex((c) => !c.classList.contains('empty'))
})
const firstEmpty = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.custom-cell')]
  return cells.findIndex((c) => c.classList.contains('empty'))
})
await page.locator('.custom-cell').nth(firstFilled).click() // 去掉一个圆点
await page.waitForTimeout(40)
await page.locator('.custom-cell').nth(firstEmpty).click() // 在空格放圆点
await page.waitForTimeout(40)
await page.click('#custom-save')
await page.waitForTimeout(400)
const editMsg = await page.evaluate(() => document.querySelector('#custom-msg').textContent)
ok(editMsg.includes('更新'), '编辑后保存覆盖原题', editMsg)
await page.click('#custom-close')
await page.waitForTimeout(200)
await page.locator('.puzzle-item', { hasText: '自定义' }).first().click()
await page.waitForTimeout(300)
const edited = await page.evaluate(() => {
  const g = window.__game
  const s = g.getSession()
  return {
    dots: s.puzzle.dots.map((d) => `${d.x},${d.y}`),
    filledCells: document.querySelectorAll('.custom-cell:not(.empty)').length,
  }
})
const expectedNewDot = `${2 * (firstEmpty % sourcePuzzle.width) + 1},${2 * Math.floor(firstEmpty / sourcePuzzle.width) + 1}`
ok(edited.dots.includes(expectedNewDot), '编辑后的圆点位置已生效', JSON.stringify(edited.dots))
ok(edited.dots.length === dotCells.length, '编辑后圆点数量不变', `${edited.dots.length}`)

/* ———————————————— 9. 删除自定义题 ———————————————— */
const beforeDelete = await page.locator('[data-edit]').count()
await page.locator('[data-del]').first().click()
await page.waitForTimeout(120)
await page.locator('[data-del].confirm').first().click()
await page.waitForTimeout(400)
const afterDelete = await page.locator('[data-edit]').count()
ok(afterDelete === beforeDelete - 1, '删除自定义题', `before=${beforeDelete} after=${afterDelete}`)
await shot('11-custom-deleted.png')

/* ———————————————— 汇总 ———————————————— */
ok(pageErrors.length === 0, '页面无 JS 异常', JSON.stringify(pageErrors))
console.log('')
console.log('截图目录：', OUT_DIR)
console.log('页面异常数：', pageErrors.length, '，失败项：', failures)
await browser.close()
if (failures > 0 || pageErrors.length > 0) process.exitCode = 1
console.log(failures === 0 && pageErrors.length === 0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED')
