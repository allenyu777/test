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
  while (paragraphs.length && isPageNumber(paragraphs[0])) paragraphs.shift()
  while (paragraphs.length && isPageNumber(paragraphs[paragraphs.length - 1])) paragraphs.pop()
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

/** 比较页眉用的键：去掉空白、数字和标点 */
export function edgeKey(p: string): string {
  return p.toLowerCase().replace(/[\s\d\p{P}\p{S}]/gu, '')
}

/** 一页首尾可能是页眉的段落（短、没有句末标点）的键，供后面几页比较 */
export function edgeKeys(paragraphs: string[]): string[] {
  const keys: string[] = []
  for (const p of [paragraphs[0], paragraphs[paragraphs.length - 1]]) {
    if (!p || p.length > 30 || endsSentence(p)) continue
    const key = edgeKey(p)
    if (key.length >= 2 && !keys.includes(key)) keys.push(key)
  }
  return keys
}

/**
 * 去掉页眉页脚：页首、页尾的短段落和最近几页页首页尾出现过的一样（书名、章节名），就是页眉。
 * keep 中的标题（书签）不去掉。
 */
export function stripRunningHeads(paragraphs: string[], recent: string[], keep: string[] = []): string[] {
  const running = (p: string) => {
    if (p.length > 30 || endsSentence(p)) return false
    if (keep.some(t => overlap(p, t) >= 0.6)) return false
    const key = edgeKey(p)
    if (key.length < 2) return false
    return recent.some(r => r === key || (Math.min(r.length, key.length) / Math.max(r.length, key.length) >= 0.7 && overlap(r, key) >= 0.8))
  }
  const out = paragraphs.slice()
  if (out.length && running(out[0])) out.shift()
  if (out.length && running(out[out.length - 1])) out.pop()
  return out
}

/** 上一页最后一段话没说完（没有句末标点），这一页第一段是它的后半句 */
export function continuesAcrossPage(prev: string, next: string): boolean {
  if (!prev || !next || prev.length < 20 || endsSentence(prev)) return false
  if (chapterLevel(next) >= 0) return false
  // 短而没有标点的一行更可能是标题
  if (next.length <= 15 && !/[，。！？；：,.!?;:、]/.test(next)) return false
  return true
}
