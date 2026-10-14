// 把文字识别结果整理成段落
import { isCjkChar, removeCjkSpaces } from '../core/text'

const PAGE_NUMBER = /^[\s\-—–·]*(\d{1,4}|[ivxlcdm]{1,6}|第\s*\d+\s*页|\d+\s*\/\s*\d+)[\s\-—–·]*$/i

function joinLines(lines: string[]): string {
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

/** 识别文字：空行分段，段内换行合并，去掉页码和中文字间空格 */
export function ocrTextToParagraphs(text: string): string[] {
  return tidyChinese(text.replace(/\r\n?/g, '\n'))
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
    .filter(p => p && !PAGE_NUMBER.test(p))
}
