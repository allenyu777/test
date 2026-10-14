// 把文字识别结果整理成段落
import { chapterLevel } from '../core/chapters'
import { isCjkChar, removeCjkSpaces } from '../core/text'

const PAGE_NUMBER = /^[\s\-—–·]*(\d{1,4}|[ivxlcdm]{1,6}|第\s*\d+\s*页|\d+\s*\/\s*\d+)[\s\-—–·]*$/i

export function joinLines(lines: string[]): string {
  let out = ''
  for (const line of lines) {
    if (!out) out = line
    else if (isCjkChar(out[out.length - 1]) || isCjkChar(line[0])) out += line
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line
    else out += ' ' + line
  }
  return out
}

const HAN = '\\u3400-\\u9fff\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef'
const FULL: Record<string, string> = { ',': '，', ':': '：', ';': '；', '!': '！', '?': '？', '(': '（', ')': '）' }
// 中文之间被识别成半角的标点（"小屋 , 窗外"）换成全角，并去掉两边的空格
const halfPunctRe = new RegExp(`([${HAN}])[ \\t]*([,:;!?()])[ \\t]*(?=[${HAN}]|$)`, 'gm')
const periodRe = new RegExp(`([${HAN}])\\s*\\.(?=\\s*([${HAN}]|$))`, 'gm')
// 中文和数字之间的空格（"第 1 段"）
const hanDigitRe = new RegExp(`([${HAN}])[ \\t]+(?=\\d)|(\\d)[ \\t]+(?=[${HAN}])`, 'g')

/** 中文识别结果的标点和空格整理 */
export function tidyChinese(text: string): string {
  const fixed = removeCjkSpaces(text)
    .replace(halfPunctRe, (_, a: string, p: string) => a + FULL[p])
    .replace(periodRe, '$1。')
    .replace(hanDigitRe, (_, a?: string, d?: string) => a ?? d ?? '')
  // 标点换成全角后，两侧可能又出现中文之间的空格
  return removeCjkSpaces(fixed)
}

export function isPageNumber(p: string): boolean {
  return PAGE_NUMBER.test(p)
}

/** 识别文字：空行分段，段内换行合并，去掉页首页尾的页码和中文字间空格 */
export function ocrTextToParagraphs(text: string): string[] {
  const paragraphs = tidyChinese(text.replace(/\r\n?/g, '\n'))
    .split(/\n\s*\n/)
    .map(block =>
      joinLines(
        block
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean),
      ),
    )
    .map(p => p.trim())
    .filter(Boolean)
  // 页码只会在页首或页尾；正文中间单独一行的数字（年份等）保留
  trimPageNumbers(paragraphs)
  return paragraphs
}

/** 两段文字共有字符的比例（以较短的一段为准） */
export function overlap(a: string, b: string): number {
  const x = a.replace(/\s+/g, '')
  const y = b.replace(/\s+/g, '')
  if (!x || !y) return 0
  const [short, long] = x.length <= y.length ? [x, y] : [y, x]
  const pool = [...long]
  let hit = 0
  for (const ch of short) {
    const i = pool.indexOf(ch)
    if (i >= 0) {
      hit++
      pool.splice(i, 1)
    }
  }
  return hit / short.length
}

const TERMINAL = /[。！？!?…．.；;：:”」』"'’）)】\]]$/

/** 段落是否以句末标点结束 */
export function endsSentence(p: string): boolean {
  return TERMINAL.test(p.trim())
}

/** 去掉一行开头或结尾的页码（页眉常和页码排在同一行） */
function withoutPageNumber(p: string): string {
  const t = p.replace(/^\s*\d{1,4}\s+|\s+\d{1,4}\s*$/g, '').trim()
  if (!t) return p
  // "Chapter 3" 里的 3 是章节号，不是页码
  if (chapterLevel(p) >= 0 && chapterLevel(t) < 0) return p
  return t
}

/** 像章节标题的一行（页码去掉后判断） */
function headingLike(p: string): boolean {
  return chapterLevel(p) >= 0 || chapterLevel(withoutPageNumber(p)) >= 0
}

/** 比较页眉用的键：去掉页码、空白和标点（保留章节号等数字） */
export function edgeKey(p: string): string {
  return withoutPageNumber(p)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/** 一页首尾可能是页眉的段落（短、没有句末标点）的键，供后面几页比较 */
export function edgeKeys(paragraphs: string[]): string[] {
  const keys: string[] = []
  for (const p of [paragraphs[0], paragraphs[paragraphs.length - 1]]) {
    if (!p || p.length > 30 || endsSentence(p)) continue
    const key = edgeKey(p)
    if (key.replace(/\d/g, '').length >= 2 && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/** 两个页眉键是否相同：允许个别字识别错（较长的键才允许） */
function sameHeader(a: string, b: string): boolean {
  if (a === b) return true
  const x = a.replace(/\d/g, '')
  const y = b.replace(/\d/g, '')
  if (x === y) return true
  if (Math.min(x.length, y.length) < 6 || Math.min(x.length, y.length) / Math.max(x.length, y.length) < 0.7) return false
  return overlap(x, y) >= 0.85
}

function trimPageNumbers(paragraphs: string[]) {
  while (paragraphs.length && isPageNumber(paragraphs[0])) paragraphs.shift()
  while (paragraphs.length && isPageNumber(paragraphs[paragraphs.length - 1])) paragraphs.pop()
}

/**
 * 去掉页眉页脚：页首、页尾的短段落和最近几页页首页尾出现过的一样（书名、章节名），就是页眉。
 * 像章节标题的行（"第13章""Chapter 3"）必须和之前的完全一样才算页眉，不同章节的标题不会被去掉。
 * keep 中的标题（书签）不去掉。
 */
export function stripRunningHeads(paragraphs: string[], recent: string[], keep: string[] = []): string[] {
  const running = (p: string) => {
    if (p.length > 30 || endsSentence(p)) return false
    if (keep.some(t => overlap(p, t) >= 0.6)) return false
    const key = edgeKey(p)
    if (key.replace(/\d/g, '').length < 2) return false
    if (headingLike(p)) return recent.includes(key)
    return recent.some(r => sameHeader(r, key))
  }
  const out = paragraphs.slice()
  // 去掉页眉后，旁边的页码也露出来了
  if (out.length && running(out[0])) {
    out.shift()
    trimPageNumbers(out)
  }
  if (out.length && running(out[out.length - 1])) {
    out.pop()
    trimPageNumbers(out)
  }
  return out
}

/** 上一页最后一段话没说完（没有句末标点），这一页第一段是它的后半句 */
export function continuesAcrossPage(prev: string, next: string): boolean {
  if (!prev || !next || prev.length < 20 || endsSentence(prev)) return false
  if (headingLike(prev) || headingLike(next)) return false
  // 编号小标题（"一、问题的提出""2. Methods"）
  if (next.length <= 30 && /^([一二三四五六七八九十百]+|\d{1,3})[、.．)）]\s*\S/.test(next)) return false
  // 短而没有标点的一行更可能是标题
  if (next.length <= 15 && !/[，。！？；：,.!?;:]/.test(next)) return false
  return true
}
