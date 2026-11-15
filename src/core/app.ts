/**
 * 通用谜题应用 —— 主逻辑
 *
 * 布局 / 会话 / 撤销重做 / 题库 / 自定义题板 / 逻辑回放 / 缩放平移 / 快捷键
 * 全部由本文件提供，只依赖 GameAdapter 契约。
 *
 * 新游戏入口：src/main.ts 里 `createApp(document.querySelector('#app'), adapter)`。
 */

import './styles.css'
import type { GameAdapter, GameState, HitTarget, Move, Puzzle } from './types'
import { $, on } from './ui'
import { ViewController, clientToViewBox } from './view'
import { LogicPlayer } from './playback'
import { CustomEditor } from './custom'
import { flashForMove } from './fx'
import { isMuted, resumeAudio, setMuted } from './audio'
import { edgeCells, horizontalEdgeIndex, verticalEdgeIndex } from './board'
import {
  loadSavedPuzzles,
  removeSavedPuzzle,
  savePuzzleToLibrary,
  type PuzzleCodec,
} from './library'
import {
  clearProgress,
  initStore,
  readLastPuzzle,
  readProgress,
  storeInProject,
  storeLocationLabel,
  writeLastPuzzle,
  writeProgress,
  type ProgressEntry,
} from './store'

interface Session {
  puzzle: Puzzle
  state: GameState
  undo: Move[]
  redo: Move[]
}

export function createApp(root: HTMLElement, adapter: GameAdapter) {
  const meta = adapter.meta
  const customMode = adapter.custom.mode ?? 'cell'
  const interactionHint =
    meta.interactionHint ??
    (meta.targetKind === 'edge'
      ? '<kbd>左键</kbd> 画边 · <kbd>右键</kbd> 清除'
      : meta.targetKind === 'vertex'
        ? '<kbd>左键</kbd> 标记顶点 · <kbd>右键</kbd> 清除'
        : '<kbd>左键</kbd> 循环标记 · <kbd>右键</kbd> 直接标排除')

  /* ———————————————————— 静态 DOM ———————————————————— */

  root.innerHTML = `
  <header class="topbar">
    <div class="brand">
      <h1>${meta.title}</h1>
      <p>${meta.tagline}</p>
    </div>
  </header>

  <div class="layout">
    <aside class="panel">
      <h2>题面</h2>
      <div class="toolbar" style="margin-top:0">
        <button class="btn" id="btn-random" type="button">随机抽题</button>
        <button class="btn" id="btn-custom" type="button">自定义</button>
        <button class="btn" id="btn-mute" type="button">音效：开</button>
      </div>
      <div class="puzzle-list" id="puzzle-list"></div>

      <div class="custom-editor" id="custom-editor" hidden>
        <h2>自定义题板</h2>
        <div class="custom-row">
          <label>宽 <input id="custom-w" type="number" min="${meta.customMinW}" max="${meta.customMaxW}" value="5" /></label>
          <label>高 <input id="custom-h" type="number" min="${meta.customMinH}" max="${meta.customMaxH}" value="5" /></label>
          <button class="btn" id="custom-regen" type="button">生成网格</button>
        </div>
        <div class="custom-hint" id="custom-hint"></div>
        <div class="custom-grid" id="custom-grid"></div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn primary" id="custom-apply" type="button">载入题板</button>
          <button class="btn" id="custom-save" type="button">保存到题库</button>
          <button class="btn" id="custom-solve" type="button">求解</button>
          <button class="btn" id="custom-logic" type="button">逻辑解题</button>
          <button class="btn danger" id="custom-close" type="button">关闭</button>
        </div>
        <div class="custom-msg" id="custom-msg"></div>
      </div>

      <div class="toolbar">
        <button class="btn primary" id="btn-check" type="button">检查</button>
        <button class="btn" id="btn-undo" type="button">撤销</button>
        <button class="btn" id="btn-redo" type="button">重做</button>
        <button class="btn" id="btn-hint" type="button">提示一格</button>
        <button class="btn" id="btn-logic" type="button">逻辑解题</button>
        <button class="btn" id="btn-solve" type="button">显示解</button>
        <button class="btn danger" id="btn-clear" type="button">清空</button>
      </div>

      <div class="status" id="status">选择左侧题目开始。</div>

      <div class="legend">
        <div>${interactionHint}</div>
        <div><kbd>按住拖拽</kbd> 连续涂写 · <kbd>中键/拖拽</kbd> 平移画布</div>
        <div><kbd>滚轮</kbd> 缩放 · <kbd>+</kbd>/<kbd>−</kbd>/<kbd>0</kbd> 放大/缩小/复位</div>
        <div><kbd>Z</kbd> / <kbd>Shift+Z</kbd> 撤销 / 重做</div>
        <div><kbd>C</kbd> 检查 · <kbd>Esc</kbd> 清空 · <kbd>L</kbd> 逻辑解题/停止回放 · <kbd>P</kbd> 暂停/继续</div>
        <div><kbd>R</kbd> 随机 · <kbd>M</kbd> 音效开关</div>
      </div>
    </aside>

    <main class="panel board-wrap" id="board-wrap">
      <div class="zoom-bar">
        <button class="btn" id="zoom-out" type="button" title="缩小">−</button>
        <span class="zoom-label" id="zoom-label">100%</span>
        <button class="btn" id="zoom-in" type="button" title="放大">+</button>
        <button class="btn" id="zoom-reset" type="button">复位</button>
      </div>
      <div id="board"></div>
    </main>
  </div>

  <p class="footer-note">${meta.footerNote}</p>
`

  // 顶栏品牌提示（部分游戏有额外一行）
  const hintEl = document.getElementById('custom-hint')
  if (hintEl) {
    if (customMode === 'none') {
      hintEl.textContent = '本游戏暂不支持自定义题板。'
    } else if (customMode === 'edge') {
      const cycle = (adapter.custom.edgeValueCycle ?? [])
        .map((v) => adapter.custom.edgeLabel?.(v) ?? String(v))
        .join(' → ')
      hintEl.textContent = `点击边循环：${cycle} ｜ ${adapter.custom.hint}`
    } else {
      hintEl.textContent = `点击循环：${adapter.custom.valueCycle
        .map((v) => adapter.custom.cellLabel(v))
        .join(' → ')} ｜ ${adapter.custom.hint}`
    }
  }

  if (customMode === 'none') {
    const btn = document.getElementById('btn-custom') as HTMLButtonElement | null
    if (btn) {
      btn.disabled = true
      btn.textContent = '自定义（不支持）'
    }
  }

  /* ———————————————————— 会话 ———————————————————— */

  let session: Session | null = null
  let pendingDeleteId: string | null = null
  let library: Puzzle[] = [...adapter.builtinPuzzles]

  const codec: PuzzleCodec = {
    encode: (p) => adapter.custom.encodePuzzle(p),
    decode: (r) => adapter.custom.decodePuzzle(r),
  }

  function refreshLibrary(): void {
    const saved = loadSavedPuzzles(codec)
    library = [...saved, ...adapter.builtinPuzzles]
  }

  function findPuzzle(id: string): Puzzle | undefined {
    return library.find((p) => p.id === id) || adapter.builtinPuzzles.find((p) => p.id === id)
  }

  function sortedLibrary(): Puzzle[] {
    const rank = (p: Puzzle) => (p.difficulty === 'custom' ? 0 : 1)
    return [...library].sort((a, b) => rank(a) - rank(b))
  }

  function difficultyLabel(d: Puzzle['difficulty']): string {
    return d === 'easy' ? '入门' : d === 'medium' ? '进阶' : d === 'custom' ? '自定义' : '挑战'
  }

  function setStatus(text: string, tone: 'ok' | 'bad' | 'solving' | '' = ''): void {
    const el = $('#status')
    el.textContent = text
    el.className = 'status' + (tone ? ` ${tone}` : '')
  }

  /* ———————————————————— 题库列表 ———————————————————— */

  function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;'
        case '<':
          return '&lt;'
        case '>':
          return '&gt;'
        case '"':
          return '&quot;'
        default:
          return '&#39;'
      }
    })
  }

    function renderPuzzleList(): void {
    refreshLibrary()
    const list = $('#puzzle-list')
    list.innerHTML = sortedLibrary()
      .map((p) => {
        const active = session?.puzzle.id === p.id ? ' active' : ''
        const isCustom = p.difficulty === 'custom'
        const confirming = pendingDeleteId === p.id
        const actions = isCustom
          ? `<button class="puzzle-act" type="button" data-edit="${escapeHtml(p.id)}" title="编辑题面">编辑</button>` +
            `<button class="puzzle-act danger${confirming ? ' confirm' : ''}" type="button" data-del="${escapeHtml(p.id)}" title="${confirming ? '再点一次确认删除' : '从题库删除'}">${confirming ? '确认' : '×'}</button>`
          : ''
        return `
          <div class="puzzle-row">
            <button class="puzzle-item${active}" data-id="${escapeHtml(p.id)}" type="button">
              <span class="title">${escapeHtml(p.name)}</span>
              <span class="meta">${p.width}×${p.height} · ${difficultyLabel(p.difficulty)}</span>
            </button>
            ${actions}
          </div>
        `
      })
      .join('')
    list.querySelectorAll<HTMLButtonElement>('.puzzle-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = btn.dataset.id ? findPuzzle(btn.dataset.id) : undefined
        if (p) selectPuzzle(p)
      })
    })
    list.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.edit
        if (id) editPuzzle(id)
      })
    })
    list.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.del
        if (!id) return
        if (pendingDeleteId === id) deletePuzzle(id)
        else {
          pendingDeleteId = id
          renderPuzzleList()
        }
      })
    })
  }


  // 删除二次确认：点击其它位置自动取消，避免误触
  document.addEventListener('click', (e) => {
    if (!pendingDeleteId) return
    const target = e.target as Element | null
    if (target?.closest('[data-del]')) return
    pendingDeleteId = null
    renderPuzzleList()
  })


  /* ———————————————————— 校验与状态 ———————————————————— */

  function currentResult() {
    if (!session) return null
    return adapter.validate(session.state, session.puzzle)
  }

  function renderBoardOnly(): void {
    if (!session) return
    const result = adapter.validate(session.state, session.puzzle)
    const svg = adapter.renderBoard(session.puzzle, session.state, result)
    const board = $('#board')
    board.innerHTML = svg
    bindBoardEvents()
    view.apply(board.querySelector<SVGSVGElement>('svg.board-svg'))
    drawKeyboardCursor()
  }

  function refresh(): void {
    renderPuzzleList()
    renderBoardOnly()
    if (!session) return
    const result = currentResult()
    if (!result) return
    if (result.solved) {
      setStatus('完成！答案完全正确。', 'ok')
      return
    }
    const bits = adapter.statusBits(result)
    const badRegions = (result as unknown as { badRegions?: number }).badRegions ?? 0
    setStatus(bits.join(' · ') || '尚未完成', badRegions > 0 ? 'bad' : '')
  }

  /* ———————————————————— 会话控制 ———————————————————— */

  function loadSave(puzzleId: string): GameState | null {
    try {
      const data = readProgress(puzzleId)
      if (!data) return null
      return adapter.deserializeState(data)
    } catch {
      return null
    }
  }

  function saveState(): void {
    if (!session) return
    writeProgress(adapter.serializeState(session.state) as ProgressEntry)
  }

  function selectPuzzle(puzzle: Puzzle): void {
    logicPlayer.stop()
    kbCursor = null
    const saved = loadSave(puzzle.id)
    session = {
      puzzle,
      state: saved ?? adapter.createEmptyState(puzzle),
      undo: [],
      redo: [],
    }
    writeLastPuzzle(puzzle.id)
    view.reset()
    refresh()
    setStatus(`已载入「${puzzle.name}」。`)
  }

  function pushMove(move: Move): void {
    if (!session) return
    adapter.applyMove(session.state, move)
    session.undo.push(move)
    session.redo.length = 0
    saveState()
  }

  /* ———————————————————— 棋盘交互 ———————————————————— */

  interface DragState {
    dragging: boolean
    moved: boolean
    lastClient: { x: number; y: number }
    painting: { kind: 'cycle' | 'force'; to: number } | null
    pending: HitTarget | null
    painted: Set<number>
  }

  const dragState: DragState = {
    dragging: false,
    moved: false,
    lastClient: { x: 0, y: 0 },
    painting: null,
    pending: null,
    painted: new Set(),
  }

  function hitAtClient(clientX: number, clientY: number): HitTarget | null {
    if (!session) return null
    const svg = document.querySelector<SVGSVGElement>('svg.board-svg')
    if (!svg) return null
    const vb = clientToViewBox(svg, clientX, clientY)
    if (!vb) return null
    const m = adapter.metricsFor(session.puzzle)
    return adapter.hitTest(m, session.puzzle, vb.x, vb.y)
  }

  /**
   * 拖拽/平移的全局指针监听（只注册一次）。
   * 不能挂在 svg 上：画边界后棋盘会重绘，旧的 svg 节点被替换，pointermove 会断掉。
   */
  function bindGlobalPointerEvents(): void {
    window.addEventListener('pointermove', (e) => {
      if (!dragState.dragging) return
      const dx = e.clientX - dragState.lastClient.x
      const dy = e.clientY - dragState.lastClient.y
      if (!dragState.moved && Math.hypot(dx, dy) < 6) return
      dragState.moved = true
      if (dragState.painting) {
        const hit = hitAtClient(e.clientX, e.clientY)
        if (hit && !dragState.painted.has(hit.index)) {
          if (!session) return
          dragState.painted.add(hit.index)
          const from = adapter.valueAt(session.state, hit.index)
          const to =
            dragState.painting.kind === 'force'
              ? dragState.painting.to
              : adapter.cycleValue(session.state, hit)
          if (from !== to) {
            pushMove({ index: hit.index, from, to })
            refresh()
          }
        }
        dragState.lastClient = { x: e.clientX, y: e.clientY }
        return
      }
      // 平移
      const svg = document.querySelector<SVGSVGElement>('svg.board-svg')
      if (svg) {
        const rect = svg.getBoundingClientRect()
        view.panBy(dx, dy, svg, rect.width, rect.height)
      }
      dragState.lastClient = { x: e.clientX, y: e.clientY }
    })

    const endDrag = (): void => {
      if (!dragState.dragging) return
      dragState.dragging = false
      if (!dragState.moved && dragState.pending && dragState.painting) {
        if (!session) return
        const from = adapter.valueAt(session.state, dragState.pending.index)
        const to = dragState.painting.to
        if (from !== to) {
          pushMove({ index: dragState.pending.index, from, to })
          refresh()
        }
      }
      dragState.pending = null
      dragState.painting = null
    }
    window.addEventListener('pointerup', endDrag)
    window.addEventListener('pointercancel', endDrag)
  }

  function bindBoardEvents(): void {
    const board = $('#board')
    const svg = board.querySelector<SVGSVGElement>('svg.board-svg')
    if (!svg) return

    view.apply(svg)

    svg.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    })

    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault()
        const vb = clientToViewBox(svg, e.clientX, e.clientY)
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
        view.setZoom(view.zoom * factor, vb ?? undefined)
      },
      { passive: false },
    )

    svg.addEventListener('pointerdown', (e) => {
      resumeAudio()
      if (e.button === 2) {
        const hit = hitAtClient(e.clientX, e.clientY)
        if (hit) {
          if (!session) return
          const to = adapter.rightClickValue(session.state, hit)
          const from = adapter.valueAt(session.state, hit.index)
          if (from !== to) {
            pushMove({ index: hit.index, from, to })
            refresh()
          }
        }
        return
      }
      if (e.button !== 0) return
      e.preventDefault()

      dragState.lastClient = { x: e.clientX, y: e.clientY }
      dragState.dragging = true
      dragState.moved = false
      dragState.painted = new Set()
      const hit = hitAtClient(e.clientX, e.clientY)
      if (hit) {
        if (!session) return
        const from = adapter.valueAt(session.state, hit.index)
        // 边模式：按下时就决定这一笔是「画」还是「擦」，拖动时不再逐条翻转
        const edgeMode = meta.targetKind === 'edge'
        const to = edgeMode ? (from === 0 ? 1 : 0) : adapter.cycleValue(session.state, hit)
        dragState.painting = from === to ? null : { kind: edgeMode ? 'force' : 'cycle', to }
        dragState.pending = hit
      } else {
        dragState.painting = null
        dragState.pending = null
      }
    })
  }

  bindGlobalPointerEvents()

  /* ———————————————————— 键盘光标（边模式：方向键移动 + 空格切换边界） ———————————————————— */

  let kbCursor: { x: number; y: number; prev: number | null } | null = null

  /** 光标当前高亮的边：默认右/下邻边；移动后高亮「刚跨过的那条边」 */
  function activeKeyboardEdge(): number | null {
    if (!session || !kbCursor) return null
    const w = session.puzzle.width
    const h = session.puzzle.height
    const cur = kbCursor.y * w + kbCursor.x
    const prev = kbCursor.prev
    if (prev === null) {
      if (kbCursor.x + 1 < w) return horizontalEdgeIndex(w, kbCursor.x, kbCursor.y)
      if (kbCursor.y + 1 < h) return verticalEdgeIndex(w, h, kbCursor.x, kbCursor.y)
      return null
    }
    if (prev === cur - 1 && kbCursor.x > 0) return horizontalEdgeIndex(w, kbCursor.x - 1, kbCursor.y)
    if (prev === cur + 1 && kbCursor.x + 1 < w) return horizontalEdgeIndex(w, kbCursor.x, kbCursor.y)
    if (prev === cur - w && kbCursor.y > 0) return verticalEdgeIndex(w, h, kbCursor.x, kbCursor.y - 1)
    if (prev === cur + w && kbCursor.y + 1 < h) return verticalEdgeIndex(w, h, kbCursor.x, kbCursor.y)
    return null
  }

  function drawKeyboardCursor(): void {
    if (!session || !kbCursor) return
    const svg = document.querySelector<SVGSVGElement>('svg.board-svg')
    if (!svg) return
    const m = adapter.metricsFor(session.puzzle)
    const ox = m.originX ?? m.pad
    const oy = m.originY ?? m.pad
    const cw = m.cellW ?? m.cell
    const ch = m.cellH ?? m.cell
    const w = session.puzzle.width
    const h = session.puzzle.height
    const ns = 'http://www.w3.org/2000/svg'
    const g = document.createElementNS(ns, 'g')
    g.setAttribute('class', 'kb-cursor')
    const rect = document.createElementNS(ns, 'rect')
    rect.setAttribute('class', 'kb-cursor-cell')
    rect.setAttribute('x', String(ox + kbCursor.x * cw + 2))
    rect.setAttribute('y', String(oy + kbCursor.y * ch + 2))
    rect.setAttribute('width', String(Math.max(0, cw - 4)))
    rect.setAttribute('height', String(Math.max(0, ch - 4)))
    g.appendChild(rect)
    const edge = activeKeyboardEdge()
    if (edge !== null) {
      const pair = edgeCells(edge, w, h)
      if (pair) {
        const line = document.createElementNS(ns, 'line')
        line.setAttribute('class', 'kb-cursor-edge')
        if (pair.horizontal) {
          const x = ox + (pair.a % w) * cw + cw
          const y = oy + Math.floor(pair.a / w) * ch
          line.setAttribute('x1', String(x))
          line.setAttribute('y1', String(y))
          line.setAttribute('x2', String(x))
          line.setAttribute('y2', String(y + ch))
        } else {
          const x = ox + (pair.a % w) * cw
          const y = oy + Math.floor(pair.a / w) * ch + ch
          line.setAttribute('x1', String(x))
          line.setAttribute('y1', String(y))
          line.setAttribute('x2', String(x + cw))
          line.setAttribute('y2', String(y))
        }
        g.appendChild(line)
      }
    }
    svg.appendChild(g)
  }

  function ensureKeyboardCursor(): void {
    if (!session) return
    if (!kbCursor) {
      kbCursor = {
        x: Math.floor(session.puzzle.width / 2),
        y: Math.floor(session.puzzle.height / 2),
        prev: null,
      }
    }
  }

  function moveKeyboardCursor(dx: number, dy: number): void {
    ensureKeyboardCursor()
    if (!session || !kbCursor) return
    const w = session.puzzle.width
    const h = session.puzzle.height
    const cur = kbCursor.y * w + kbCursor.x
    const nx = Math.max(0, Math.min(w - 1, kbCursor.x + dx))
    const ny = Math.max(0, Math.min(h - 1, kbCursor.y + dy))
    if (nx === kbCursor.x && ny === kbCursor.y) return
    kbCursor = { x: nx, y: ny, prev: cur }
  }

  function toggleKeyboardEdge(): void {
    ensureKeyboardCursor()
    if (!session) return
    const edge = activeKeyboardEdge()
    if (edge === null) return
    const from = adapter.valueAt(session.state, edge)
    const to = adapter.cycleValue(session.state, { index: edge, kind: 'edge' })
    if (from === to) return
    pushMove({ index: edge, from, to })
    refresh()
    setStatus(from === 0 ? '已在光标处画上边界。' : '已擦除光标处的边界。', 'ok')
  }

  /** 边模式的键盘操作；返回 true 表示已消费该按键 */
  function handleBoardKey(e: KeyboardEvent): boolean {
    if (meta.targetKind !== 'edge' || !session) return false
    const k = e.key
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault()
      moveKeyboardCursor(
        k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0,
        k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0,
      )
      refresh()
      return true
    }
    if (k === ' ' || k === 'Enter') {
      e.preventDefault()
      toggleKeyboardEdge()
      return true
    }
    return false
  }

  /* ———————————————————— 撤销 / 重做 / 清空 ———————————————————— */

  function undo(): void {
    if (!session || !session.undo.length) return
    const move = session.undo.pop()!
    const inv = adapter.invertMove(move)
    adapter.applyMove(session.state, inv)
    session.redo.push(move)
    saveState()
    refresh()
  }

  function redo(): void {
    if (!session || !session.redo.length) return
    const move = session.redo.pop()!
    adapter.applyMove(session.state, move)
    session.undo.push(move)
    saveState()
    refresh()
  }

  function clearBoard(): void {
    if (!session) return
    logicPlayer.stop()
    session.state = adapter.createEmptyState(session.puzzle)
    session.undo = []
    session.redo = []
    if (kbCursor) kbCursor = { x: kbCursor.x, y: kbCursor.y, prev: null }
    saveState()
    refresh()
    setStatus('已清空当前盘面。')
  }

  /* ———————————————————— 检查 / 提示 / 显示解 ———————————————————— */

  function check(): void {
    const result = currentResult()
    if (!session || !result) return
    if (result.solved) {
      setStatus('正确！', 'ok')
    } else {
      const parts = adapter.statusBits(result)
      setStatus(parts.join(' · ') || '还差一点', 'bad')
    }
    refresh()
  }

  function showSolution(): void {
    if (!session) return
    const sol = adapter.getReferenceSolution(session.puzzle.id)
    if (sol) {
      session.state = adapter.cloneState(sol)
      session.undo = []
      session.redo = []
      saveState()
      refresh()
      setStatus('已填入参考解。', 'ok')
      return
    }
    const r = adapter.solvePuzzle(session.puzzle, 1_500_000)
    if (!r.solved || !r.solution) {
      setStatus(r.timedOut ? '求解超时。' : '无解或题面矛盾。', 'bad')
      return
    }
    session.state = adapter.cloneState(r.solution)
    session.undo = []
    session.redo = []
    saveState()
    refresh()
    setStatus('已填入一组可行解。', 'ok')
  }

  function hint(): void {
    if (!session) return
    let sol = adapter.getReferenceSolution(session.puzzle.id)
    if (!sol) {
      const r = adapter.solvePuzzle(session.puzzle, 1_500_000)
      if (!r.solved || !r.solution) {
        setStatus('暂时给不出提示。', 'bad')
        return
      }
      sol = r.solution
    }
    const move = adapter.firstHintMove(session.state, sol)
    if (move) {
      pushMove(move)
      refresh()
      setStatus('已提示一格。', 'ok')
    } else {
      setStatus('当前已与可行解一致，或无未知格可提示。', 'ok')
    }
  }

  /* ———————————————————— 缩放 ———————————————————— */

  const view = new ViewController(
    () => {
      if (!session) return { cell: 48, pad: 16, width: 5, height: 5, svgWidth: 400, svgHeight: 400, k: 1 }
      return adapter.metricsFor(session.puzzle)
    },
    (label) => {
      const el = document.getElementById('zoom-label')
      if (el) el.textContent = label
    },
  )

  /* ———————————————————— 逻辑解题回放 ———————————————————— */

  let logicButtonsDisabled = false

  function setButtonsDisabled(disabled: boolean): void {
    logicButtonsDisabled = disabled
    for (const id of ['btn-check', 'btn-undo', 'btn-redo', 'btn-hint', 'btn-solve', 'btn-clear'] as const) {
      const el = document.getElementById(id) as HTMLButtonElement | null
      if (el) el.disabled = disabled
    }
    const board = document.getElementById('board')
    if (board) board.style.pointerEvents = disabled ? 'none' : ''
    updateLogicButton()
  }

  function updateLogicButton(): void {
    const btn = document.getElementById('btn-logic') as HTMLButtonElement | null
    if (!btn) return
    if (logicPlayer.playing) {
      btn.textContent = '停止回放'
      btn.classList.remove('primary')
      btn.classList.add('danger')
    } else {
      btn.textContent = '逻辑解题'
      btn.classList.add('primary')
      btn.classList.remove('danger')
    }
    btn.disabled = logicButtonsDisabled && !logicPlayer.playing
  }

  function flash(move: Move, streak: number): void {
    if (!session) return
    adapter.playForMove(move, streak)
    const svg = document.querySelector<SVGSVGElement>('svg.board-svg')
    if (!svg) return
    const m = adapter.metricsFor(session.puzzle)
    if (adapter.flashForMove) adapter.flashForMove(svg, move, streak, m)
    else flashForMove(svg, move, streak, m)
  }

  const logicPlayer = new LogicPlayer(adapter, {
    setStatus,
    pushMove,
    render: () => renderBoardOnly(),
    flash,
    samePuzzle: (id) => session?.puzzle.id === id,
    currentPuzzle: () => session?.puzzle ?? null,
    setButtonsDisabled,
    onFinished: (_saturated, frames) => {
      updateLogicButton()
      if (session) {
        const result = currentResult()
        if (result?.solved) setStatus(`逻辑解题完成（${frames} 帧），盘面已解出。`, 'ok')
        else setStatus(`回放完毕（${frames} 帧）。`, 'ok')
      }
    },
  })

  function runLogicSolver(): void {
    if (!session || logicPlayer.playing) return
    const snapshot = adapter.cloneState(session.state)
    void logicPlayer.start(session.puzzle, snapshot)
  }

  function stopLogic(): void {
    logicPlayer.stop()
    updateLogicButton()
  }

  /* ———————————————————— 自定义题板 ———————————————————— */

  /** 自定义题唯一性提示（小盘面自动校验；太大时跳过，避免卡顿） */
  function uniquenessNote(p: Puzzle): { text: string; tone: 'ok' | 'bad' | '' } {
    if (p.width * p.height > 144) return { text: '（盘面较大，未自动校验唯一性）', tone: '' }
    const r = adapter.solvePuzzle(p, 400_000)
    if (r.timedOut) return { text: '（唯一性校验超时）', tone: '' }
    if (!r.solved) return { text: '题面无解，请调整圆点位置。', tone: 'bad' }
    if ((r.solutionCount ?? 1) > 1) return { text: '题面有多解（不唯一）。', tone: 'bad' }
    return { text: '唯一解 ✓', tone: 'ok' }
  }

  const custom = new CustomEditor(adapter, {
    setStatus,
    message: (text, tone = '') => {
      const el = document.getElementById('custom-msg')
      if (!el) return
      el.textContent = text
      el.className = 'custom-msg' + (tone ? ` ${tone}` : '')
    },
    uniqueness: (p) => uniquenessNote(p),
    loadPuzzle: (p) => {
      // 载入即入库：稳定 id 保证进度可续
      const saved = savePuzzleToLibrary(p, codec)
      refreshLibrary()
      logicPlayer.stop()
      session = {
        puzzle: saved.find((x) => x.id === p.id) ?? p,
        state: adapter.createEmptyState(p),
        undo: [],
        redo: [],
      }
      writeLastPuzzle(p.id)
      view.reset()
      refresh()
      const note = uniquenessNote(session.puzzle)
      setStatus(
        `已载入自定义 ${p.width}×${p.height}，并存入题库（刷新后仍在列表里）。${note.text}`,
        note.tone === 'bad' ? 'bad' : 'ok',
      )
    },
    savePuzzle: (p) => {
      savePuzzleToLibrary(p, codec)
      refreshLibrary()
      renderPuzzleList()
    },
    solveCurrent: () => {
      if (!session || !session.puzzle.id.startsWith(meta.customIdPrefix)) {
        setStatus('请先载入自定义题板。', 'bad')
        return
      }
      const r = adapter.solvePuzzle(session.puzzle, 1_500_000)
      const msg = document.getElementById('custom-msg')
      if (!r.solved || !r.solution) {
        setStatus(r.timedOut ? '求解超时：盘面过大或题面矛盾/无解。' : '无解或题面矛盾。', 'bad')
        if (msg) {
          msg.textContent = r.timedOut ? '求解超时，可先「逻辑解题」再求解。' : '无解或题面矛盾。'
          msg.className = 'custom-msg bad'
        }
        return
      }
      session.state = adapter.cloneState(r.solution)
      session.undo = []
      session.redo = []
      saveState()
      refresh()
      const count = r.solutionCount ?? 1
      const multi = count > 1
      setStatus(
        `自定义盘已求解（${multi ? '题面多解，填入其中一解' : '唯一解'}，搜索 ${r.nodes} 节点）。`,
        multi ? 'bad' : 'ok',
      )
      if (msg) {
        msg.textContent = `求解成功${multi ? '（题面不唯一）' : '（唯一解）'}（搜索 ${r.nodes} 节点）。`
        msg.className = 'custom-msg ' + (multi ? 'bad' : 'ok')
      }
    },
    runLogic: () => {
      if (!session) return
      runLogicSolver()
    },
  })

  /* ———————————————————— 自定义题管理 ———————————————————— */

  function editPuzzle(id: string): void {
    const puzzle = findPuzzle(id)
    if (!puzzle || puzzle.difficulty !== 'custom') return
    custom.edit(puzzle)
  }

  function deletePuzzle(id: string): void {
    const puzzle = findPuzzle(id)
    if (!puzzle || puzzle.difficulty !== 'custom') return
    pendingDeleteId = null
    const wasCurrent = session?.puzzle.id === id
    custom.clearEditing(id)
    removeSavedPuzzle(id, codec)
    clearProgress(id)
    refreshLibrary()
    if (wasCurrent) {
      const next = sortedLibrary()[0]
      if (next) {
        selectPuzzle(next)
      } else {
        session = null
        $('#board').innerHTML = ''
        $('#zoom-label').textContent = '100%'
        renderPuzzleList()
      }
    } else {
      renderPuzzleList()
    }
    setStatus(`已删除「${puzzle.name}」。`, 'ok')
  }

  /* ———————————————————— 按钮绑定 ———————————————————— */

  on($('#btn-check'), 'click', check)
  on($('#btn-undo'), 'click', undo)
  on($('#btn-redo'), 'click', redo)
  on($('#btn-clear'), 'click', clearBoard)
  on($('#btn-solve'), 'click', showSolution)
  on($('#btn-hint'), 'click', hint)
  on($('#btn-random'), 'click', pickRandomPuzzle)
  on($('#btn-mute'), 'click', toggleMute)
  on($('#btn-custom'), 'click', () => custom.open())
  on($('#custom-regen'), 'click', () => custom.regen())
  on($('#custom-apply'), 'click', () => custom.load())
  on($('#custom-save'), 'click', () => custom.save())
  on($('#custom-solve'), 'click', () => custom.solve())
  on($('#custom-logic'), 'click', () => custom.logic())
  on($('#custom-close'), 'click', () => custom.close())
  on($('#btn-logic'), 'click', () => {
    resumeAudio()
    if (logicPlayer.playing) stopLogic()
    else runLogicSolver()
  })
  on($('#zoom-in'), 'click', () => view.zoomIn())
  on($('#zoom-out'), 'click', () => view.zoomOut())
  on($('#zoom-reset'), 'click', () => {
    view.reset()
    view.apply(document.querySelector<SVGSVGElement>('svg.board-svg'))
  })

  function pickRandomPuzzle(): void {
    refreshLibrary()
    const cur = session?.puzzle.id
    const pool = cur ? library.filter((p) => p.id !== cur) : library
    const list = pool.length ? pool : library
    const p = list[Math.floor(Math.random() * list.length)]!
    selectPuzzle(p)
    setStatus(`随机抽到「${p.name}」。`)
  }

  function toggleMute(): void {
    const next = !isMuted()
    setMuted(next)
    const btn = document.getElementById('btn-mute')
    if (btn) btn.textContent = next ? '音效：关' : '音效：开'
    if (!next) resumeAudio()
  }

  /* ———————————————————— 快捷键 ———————————————————— */

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    // 待确认删除时，Esc 先取消确认
    if (e.key === 'Escape' && pendingDeleteId) {
      e.preventDefault()
      pendingDeleteId = null
      renderPuzzleList()
      return
    }
    // 自定义题板键盘录入优先
    if (custom.handleKey(e)) return
    // 边模式的棋盘键盘操作（方向键移动光标 / 空格切换边界）
    if (handleBoardKey(e)) return

    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault()
      redo()
    } else if (k === 'c') {
      e.preventDefault()
      check()
    } else if (k === 'l') {
      e.preventDefault()
      if (logicPlayer.playing) stopLogic()
      else runLogicSolver()
    } else if (k === 'p') {
      e.preventDefault()
      logicPlayer.togglePause()
    } else if (k === 'r') {
      e.preventDefault()
      pickRandomPuzzle()
    } else if (k === 'm') {
      e.preventDefault()
      toggleMute()
    } else if (k === '+' || k === '=') {
      e.preventDefault()
      view.zoomIn()
    } else if (k === '-' || k === '_') {
      e.preventDefault()
      view.zoomOut()
    } else if (k === '0') {
      e.preventDefault()
      view.reset()
      view.apply(document.querySelector<SVGSVGElement>('svg.board-svg'))
    } else if (k === 'escape') {
      clearBoard()
    }
  })

  /* ———————————————————— 启动 ———————————————————— */

  void (async () => {
    try {
      await initStore({ prefix: meta.storageKeyPrefix })
      refreshLibrary()
      let boot: Puzzle | undefined
      const lastId = readLastPuzzle()
      if (lastId) boot = findPuzzle(lastId)
      if (!boot) boot = sortedLibrary()[0]
      if (boot) selectPuzzle(boot)
      else setStatus('没有可用题面。', 'bad')
      if (storeInProject()) {
        const el = $('#status')
        el.textContent += `（题库/进度：${storeLocationLabel()}）`
      }
      document.title = meta.title
    } catch (err) {
      setStatus(`初始化失败：${err instanceof Error ? err.message : String(err)}`, 'bad')
    }
  })()

  root.setAttribute('data-booted', '1')
  try {
    const url = new URL(location.href)
    if (url.searchParams.has('_r')) {
      url.searchParams.delete('_r')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
  } catch {
    /* URL 不可用时忽略 */
  }

  // 便于调试
  ;(window as unknown as Record<string, unknown>).__game = {
    adapter,
    getSession: () => session,
    selectPuzzle,
    setStatus,
  }

  return {
    selectPuzzle,
    getSession: () => session,
    adapter,
  }
}