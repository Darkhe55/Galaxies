/* 自动生成，勿手改。运行 npm run gen 重新生成。 */

export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 圆点串 "x,y;x,y;…"（半格坐标：格心=奇数、格点=偶数） */
  dots: string
  /** 参考解：每格一个 base36 区域号（= dots 下标） */
  solution: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "galaxies-6x6-9r-2854412582", name: "星群初见", width: 6, height: 6, difficulty: "easy", series: "入门", dots: "2,2;6,2;10,2;2,6;6,6;10,6;2,10;6,10;10,10", solution: "001122001122334455334455667788667788" },
  { id: "galaxies-6x6-4r-3138481973", name: "双星初会", width: 6, height: 6, difficulty: "easy", series: "入门", dots: "3,3;9,3;3,9;9,9", solution: "000111000111000111222333222333222333" },
  { id: "galaxies-6x7-6r-17598610", name: "星点拼图", width: 6, height: 7, difficulty: "easy", series: "入门", dots: "1,3;7,3;1,9;7,9;1,13;7,13", solution: "011111011111011111233333233333233333455555" },
  { id: "galaxies-6x7-6r-219801157", name: "七星连珠", width: 6, height: 7, difficulty: "easy", series: "入门", dots: "1,1;7,1;1,5;7,5;1,11;7,11", solution: "011111233333233333233333455555455555455555" },
  { id: "galaxies-7x7-9r-2146707345", name: "中庭星图", width: 7, height: 7, difficulty: "medium", series: "进阶", dots: "1,5;3,5;9,5;1,11;3,11;9,11;1,13;3,13;9,13", solution: "0122222012222201222220122222012222234555556788888" },
  { id: "galaxies-7x7-9r-338070128", name: "星汉灿烂", width: 7, height: 7, difficulty: "medium", series: "进阶", dots: "1,5;5,5;11,5;1,11;5,11;11,11;1,13;5,13;11,13", solution: "0111222011122201112220111222011122234445556777888" },
  { id: "galaxies-8x7-4r-2558926653", name: "格点星旋", width: 8, height: 7, difficulty: "medium", series: "进阶", dots: "1,7;5,7;11,7;15,7", solution: "01112223011122230111222301112223011122230111222301112223" },
  { id: "galaxies-8x7-4r-328698864", name: "九霄星图", width: 8, height: 7, difficulty: "medium", series: "进阶", dots: "3,7;9,7;13,7;15,7", solution: "00011123000111230001112300011123000111230001112300011123" },
  { id: "galaxies-8x8-4r-2259392108", name: "十方星阵", width: 8, height: 8, difficulty: "medium", series: "进阶", dots: "5,3;13,3;5,11;13,11", solution: "0000011100000111000001112222233322222333222223332222233322222333" },
  { id: "galaxies-8x8-8r-1826808276", name: "深邃星野", width: 8, height: 8, difficulty: "medium", series: "进阶", dots: "1,1;9,1;1,5;9,5;1,11;9,11;1,15;9,15", solution: "0111111123333333233333332333333345555555455555554555555567777777" },
  { id: "galaxies-9x8-4r-133664574", name: "界线", width: 9, height: 8, difficulty: "hard", series: "挑战", dots: "9,1;9,3;9,7;9,13", solution: "000000000111111111222222222222222222222222222333333333333333333333333333" },
  { id: "galaxies-9x8-12r-306284554", name: "回廊星域", width: 9, height: 8, difficulty: "hard", series: "挑战", dots: "1,1;7,1;15,1;1,3;7,3;15,3;1,7;7,7;15,7;1,13;7,13;15,13", solution: "0111112223444445556777778886777778886777778889aaaaabbb9aaaaabbb9aaaaabbb" },
  { id: "galaxies-9x9-9r-4273255850", name: "六角微光", width: 9, height: 9, difficulty: "hard", series: "挑战", dots: "5,1;13,1;17,1;5,7;13,7;17,7;5,15;13,15;17,15", solution: "000001112333334445333334445333334445333334445333334445666667778666667778666667778" },
  { id: "galaxies-9x9-9r-1442537893", name: "星轨回旋", width: 9, height: 9, difficulty: "hard", series: "挑战", dots: "3,1;11,1;17,1;3,5;11,5;17,5;3,13;11,13;17,13", solution: "000111112333444445333444445333444445666777778666777778666777778666777778666777778" },
  { id: "galaxies-10x9-6r-1858948634", name: "九星拱卫", width: 10, height: 9, difficulty: "hard", series: "挑战", dots: "9,1;19,1;9,5;19,5;9,13;19,13", solution: "000000000122222222232222222223222222222344444444454444444445444444444544444444454444444445" },
  { id: "galaxies-10x9-6r-57745721", name: "交辉", width: 10, height: 9, difficulty: "hard", series: "挑战", dots: "5,1;15,1;5,5;15,5;5,13;15,13", solution: "000001111122222333332222233333222223333344444555554444455555444445555544444555554444455555" },
  { id: "galaxies-10x10-8r-4220812451", name: "六宫星盘", width: 10, height: 10, difficulty: "hard", series: "挑战", dots: "3,3;11,3;17,3;19,3;3,13;11,13;17,13;19,13", solution: "0001111123000111112300011111234445555567444555556744455555674445555567444555556744455555674445555567" },
  { id: "galaxies-10x10-4r-826926685", name: "星海棋局", width: 10, height: 10, difficulty: "hard", series: "挑战", dots: "7,3;17,3;7,13;17,13", solution: "0000000111000000011100000001112222222333222222233322222223332222222333222222233322222223332222222333" },
]
