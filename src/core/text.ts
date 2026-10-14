// 文本工具：分句、清洗、语言识别

export interface Sentence {
  /** 句子在段落中的起始偏移 */
  o: number
  /** 结束偏移（不含） */
  e: number
}

const CJK = '\\u2e80-\\u2fff\\u3040-\\u30ff\\u3100-\\u312f\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
const CJK_PUNCT = '\\u3000-\\u303f\\uff00-\\uffef'
// 源文件里中文之间的换行（不是有意的空格）需要去掉
const cjkBreakRe = new RegExp(`([${CJK}${CJK_PUNCT}])[^\\S\\n]*\\n\\s*(?=[${CJK}${CJK_PUNCT}])`, 'g')
const cjkCharRe = new RegExp(`[${CJK}]`, 'g')
const kanaRe = /[぀-ヿ]/g
const hangulRe = /[가-힯]/g
const speakableRe = new RegExp(`[\\p{L}\\p{N}${CJK}]`, 'u')

/** 合并空白、去掉中文字符之间因换行产生的空格 */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u200b-\u200d\ufeff\u00ad]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(cjkBreakRe, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 是否包含可以朗读的字符（过滤 "* * *" 之类的分隔符） */
export function isSpeakable(text: string): boolean {
  return speakableRe.test(text)
}

export function cjkRatio(text: string): number {
  if (!text) return 0
  const sample = text.slice(0, 20000)
  const letters = sample.replace(/[\s\p{P}\p{S}\p{N}]/gu, '').length || 1
  return (sample.match(cjkCharRe)?.length ?? 0) / letters
}

/** 粗略识别书籍语言，返回 BCP-47 主语言代码 */
export function detectLang(text: string): string {
  const sample = text.slice(0, 20000)
  const letters = sample.replace(/[\s\p{P}\p{S}\p{N}]/gu, '').length || 1
  const kana = sample.match(kanaRe)?.length ?? 0
  const hangul = sample.match(hangulRe)?.length ?? 0
  if (kana / letters > 0.05) return 'ja'
  if (hangul / letters > 0.3) return 'ko'
  if (cjkRatio(sample) > 0.3) return 'zh'
  if (/[Ѐ-ӿ]/.test(sample) && (sample.match(/[Ѐ-ӿ]/g)!.length / letters) > 0.3) return 'ru'
  return 'en'
}

/** 规范化语言标签：zh-Hans / chi / zho → zh */
export function baseLang(lang?: string | null): string {
  if (!lang) return ''
  const l = lang.toLowerCase().trim()
  if (/^(zh|chi|zho|cmn)/.test(l)) return 'zh'
  if (/^(en|eng)/.test(l)) return 'en'
  if (/^(ja|jpn)/.test(l)) return 'ja'
  return l.split(/[-_]/)[0]
}

const TERMINATORS = new Set(['。', '！', '？', '!', '?', '；', ';', '…', '．', '｡'])
const CLOSERS = new Set(['”', '’', '"', "'", '」', '』', '）', ')', '】', '》', '〉', ']', '］', '}', '｝', '〕'])
const SOFT_BREAKS = new Set(['，', ',', '、', '：', ':', '——', '—', '－'])
// 后面一定跟着名字的称谓，句点不会是句末
const TITLES = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'mt', 'gen', 'col', 'capt', 'lt', 'sgt', 'rev', 'hon', 'messrs', 'mme', 'mlle'])
// 常见缩写：只有后面跟大写字母时才算句末
const ABBREVIATIONS = new Set([
  'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'no', 'vol', 'fig', 'inc', 'ltd', 'co', 'p', 'pp', 'ch', 'cf', 'approx',
  'a.m', 'p.m', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'u.s', 'u.k',
])
const SENTENCE_FINAL_ABBR = new Set(['etc', 'a.m', 'p.m', 'inc', 'ltd', 'co', 'jr', 'sr', 'u.s', 'u.k'])

function isCjkChar(ch: string) {
  const c = ch.charCodeAt(0)
  return (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xffef)
}

/** 句号是否真的是句末（排除缩写、小数、人名首字母） */
function isPeriodBoundary(text: string, i: number): boolean {
  const next = text[i + 1]
  if (next === undefined) return true
  if (next === '.') return false
  if (!/\s|["'”’)\]]/.test(next)) return false
  // 句点前面的单词
  let j = i - 1
  while (j >= 0 && /[A-Za-z.]/.test(text[j])) j--
  const word = text.slice(j + 1, i).toLowerCase()
  if (!word) return true
  if (TITLES.has(word)) return false
  // 单个大写字母（J. K. Rowling）
  if (word.length === 1 && /[A-Z]/.test(text[i - 1])) return false
  if (ABBREVIATIONS.has(word) || /^([a-z]\.)+[a-z]$/.test(word)) {
    if (!SENTENCE_FINAL_ABBR.has(word)) return false
    const rest = text.slice(i + 1).match(/^["'”’)\]]*\s+(\S)/)
    return !!rest && /[A-Z]/.test(rest[1])
  }
  return true
}

/**
 * 把一段文字切分成适合朗读和高亮的句子。
 * 中文按 。！？；…… 切分，英文按 . ! ? 切分；过长的句子再按逗号切开。
 */
export function splitSentences(text: string, maxLen = 0): Sentence[] {
  const result: Sentence[] = []
  const n = text.length
  if (!n) return result
  const cjk = cjkRatio(text) > 0.3
  const limit = maxLen || (cjk ? 90 : 220)
  let start = 0
  let i = 0
  const push = (end: number) => {
    // 去掉首尾空白
    let s = start
    let e = end
    while (s < e && /\s/.test(text[s])) s++
    while (e > s && /\s/.test(text[e - 1])) e--
    if (e > s) result.push({ o: s, e })
    start = end
  }
  while (i < n) {
    const ch = text[i]
    let boundary = false
    if (TERMINATORS.has(ch)) boundary = true
    else if (ch === '.' && isPeriodBoundary(text, i)) boundary = true
    if (boundary) {
      let j = i + 1
      // 连续的标点、省略号、后引号都归到当前句
      while (j < n && (TERMINATORS.has(text[j]) || CLOSERS.has(text[j]) || text[j] === '.')) j++
      push(j)
      i = j
      continue
    }
    i++
  }
  if (start < n) push(n)

  // 过长的句子按逗号/空格拆开，避免朗读引擎卡顿、方便高亮
  const out: Sentence[] = []
  for (const s of result) {
    if (s.e - s.o <= limit) {
      out.push(s)
      continue
    }
    let o = s.o
    while (s.e - o > limit) {
      let cut = -1
      for (let k = o + limit; k > o + limit * 0.4; k--) {
        if (SOFT_BREAKS.has(text[k - 1])) { cut = k; break }
      }
      if (cut < 0) {
        for (let k = o + limit; k > o + limit * 0.4; k--) {
          if (text[k - 1] === ' ' || (!cjk && /\s/.test(text[k - 1]))) { cut = k; break }
        }
      }
      if (cut < 0) cut = o + limit
      // 不要把引号、括号等收尾符号切到下一句开头
      while (cut < s.e && CLOSERS.has(text[cut])) cut++
      let e = cut
      while (e > o && /\s/.test(text[e - 1])) e--
      out.push({ o, e })
      o = cut
      while (o < s.e && /\s/.test(text[o])) o++
    }
    if (o < s.e) out.push({ o, e: s.e })
  }
  return out
}

/** 朗读前的文本清洗：去掉不需要读出来的符号 */
export function speechText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_~#=|<>^`]{2,}/g, ' ')
    .replace(/[…]{1,}|\.{3,}/g, '…')
    .replace(/[—―─]{2,}/g, '——')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 估算朗读时长（秒），rate 为倍速 */
export function estimateSeconds(chars: number, lang: string, rate: number): number {
  // 中文约 260 字/分钟，其它语言按字符约 900/分钟
  const perMinute = lang === 'zh' || lang === 'ja' ? 260 : 900
  return (chars / perMinute) * 60 / Math.max(0.1, rate)
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0 分钟'
  const m = Math.round(seconds / 60)
  if (m < 1) return '不到 1 分钟'
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  return `${h} 小时 ${m % 60} 分`
}

export { isCjkChar }
