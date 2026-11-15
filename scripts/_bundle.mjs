/**
 * 用 esbuild 把 src/game 下的 TypeScript 模块打包成 ESM data URL 再 import。
 * 这样 check / gen 脚本可以在 Node 里直接复用浏览器端的游戏逻辑（求解器、逻辑解题、校验）。
 */
import { build } from 'esbuild'
import path from 'node:path'

export async function importTs(entry) {
  const out = await build({
    entryPoints: [path.resolve(entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    target: 'node20',
    logLevel: 'silent',
  })
  const code = out.outputFiles[0].text
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  return import(url)
}
