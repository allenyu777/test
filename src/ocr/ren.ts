// 扫描识别常把"入"认成"人"（字形几乎一样）：按固定搭配改回来。
// 只改几乎不会是"人"的搭配，并排除"引进人才""夜深人静""陷人于不义"这类"人"本来就对的写法；宁可漏改，不能改错。
// 一字换一字，段落长度不变（阅读位置、笔记位置都不受影响）。

interface Rule {
  /** 含"人"的两个字（或成语） */
  word: string
  /** 前一个字是这些时不改 */
  notAfter?: string
  /** 后一个字是这些时不改 */
  notBefore?: string
  /** 只有后一个字是这些时才改 */
  onlyBefore?: string
}

const SEASON_NEXT = '以后时前，。、'

const RULES: Rule[] = [
  // 动词 + 入
  { word: '进人', notAfter: '先引促推增改激前跟奋演精', notBefore: '才物士员们民类群性口家手事' },
  { word: '收人', notAfter: '接没', notBefore: '员才民心' },
  { word: '输人', notAfter: '不', notBefore: '员' },
  { word: '加人', notAfter: '参增附施追更', notBefore: '员数口们工民才手' },
  { word: '投人', notBefore: '所' },
  { word: '陷人', notBefore: '于' },
  { word: '深人', notAfter: '夜', notBefore: '静' },
  { word: '列人' },
  { word: '纳人', notAfter: '接容吸', notBefore: '才数员口' },
  { word: '侵人' },
  { word: '涌人' },
  { word: '渗人' },
  { word: '介人' },
  { word: '融人' },
  { word: '卷人' },
  { word: '堕人' },
  { word: '汇人' },
  { word: '迁人' },
  { word: '潜人' },
  { word: '闯人' },
  { word: '跨人' },
  { word: '编人', notBefore: '员' },
  { word: '录人', notBefore: '员' },
  { word: '转人', notBefore: '员工' },
  { word: '注人', notAfter: '关专', notBefore: '员' },
  { word: '步人', notBefore: '后' },
  { word: '买人', notBefore: '心' },
  // 入 + 名词
  { word: '人侵', notBefore: '犯略占吞袭蚀扰' },
  { word: '人境', notBefore: '况遇地界' },
  { word: '人狱', notBefore: '中卒' },
  { word: '人伍' },
  { word: '人籍', notBefore: '贯' },
  { word: '人库' },
  { word: '人账' },
  { word: '人仓' },
  { word: '人关', notBefore: '系心注怀爱切联' },
  { word: '人京', notBefore: '城剧味腔师' },
  { word: '人党', notBefore: '性籍龄员派内外' },
  { word: '人场', onlyBefore: '券式费' },
  { word: '人冬', onlyBefore: SEASON_NEXT },
  { word: '人夏', onlyBefore: SEASON_NEXT },
  { word: '人秋', onlyBefore: SEASON_NEXT },
  { word: '人春', onlyBefore: SEASON_NEXT },
  { word: '人夜', onlyBefore: SEASON_NEXT },
  // 成语
  { word: '人不敷出' },
  { word: '人木三分' },
  { word: '人乡随俗' },
  { word: '人土为安' },
  { word: '出人境' },
  { word: '人情人理' },
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const ANY = new RegExp(RULES.map(r => escape(r.word)).join('|'), 'g')
const BY_WORD = new Map(RULES.map(r => [r.word, r]))

/** 把识别错的"人"改回"入" */
export function fixRu(text: string): string {
  if (!text.includes('人')) return text
  return text.replace(ANY, (word: string, offset: number) => {
    const rule = BY_WORD.get(word)!
    const prev = text[offset - 1] ?? ''
    const next = text[offset + word.length] ?? ''
    if (prev && rule.notAfter?.includes(prev)) return word
    if (next && rule.notBefore?.includes(next)) return word
    if (rule.onlyBefore && !(next && rule.onlyBefore.includes(next))) return word
    return word.replace(/人/g, '入')
  })
}
