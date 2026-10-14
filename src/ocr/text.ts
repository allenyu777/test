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

/** 识别文字：空行分段，段内换行合并，去掉页码和中文字间空格 */
export function ocrTextToParagraphs(text: string): string[] {
  return removeCjkSpaces(text.replace(/\r\n?/g, '\n'))
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
