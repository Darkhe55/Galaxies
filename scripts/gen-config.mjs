/**
 * 星系 —— 题库生成配置（npm run gen 调用）
 *
 * 具体的「随机矩形拼铺 + 唯一解 + 逻辑可解」算法在 src/game/generator.ts，
 * 这里只负责用 esbuild 打包后调用它，并把结果转成 puzzles-data.ts 需要的字段。
 */
import { importTs } from './_bundle.mjs'

export const NAME = '星系生成器（随机对称拼铺 + 唯一解 + 逻辑可解过滤）'

export async function generatePuzzles() {
  const mod = await importTs('src/game/generator.ts')
  const raw = mod.generateAll((msg) => console.log(msg))
  return raw.map((p) => ({
    id: p.id,
    name: p.name,
    width: p.width,
    height: p.height,
    difficulty: p.difficulty,
    series: p.series,
    dots: p.dots,
    solution: p.solution,
  }))
}
