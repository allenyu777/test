// 根据识别出的每一行在页面上的位置，去掉页眉、页脚（页码、书名、章节名）
import { headingLike, isPageNumber, withoutPageNumber } from './text'

export interface OcrLine {
  text: string
  /** 所在段落的编号（同一段落的行相同） */
  para: number
  x0: number
  y0: number
  x1: number
  y1: number
}

const hasWords = (t: string) => /[\p{L}\p{N}]/u.test(t)
const height = (l: { y0: number; y1: number }) => l.y1 - l.y0
const width = (l: { x0: number; x1: number }) => l.x1 - l.x0

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 同一高度上的几行（页码和书名可能被识别成左右两行） */
interface Row {
  lines: OcrLine[]
  y0: number
  y1: number
  text: string
}

function toRows(lines: OcrLine[]): Row[] {
  const rows: Row[] = []
  for (const l of lines.slice().sort((a, b) => a.y0 - b.y0)) {
    const row = rows.find(r => Math.min(r.y1, l.y1) - Math.max(r.y0, l.y0) > Math.min(r.y1 - r.y0, height(l)) * 0.5)
    if (row) {
      row.lines.push(l)
      row.y0 = Math.min(row.y0, l.y0)
      row.y1 = Math.max(row.y1, l.y1)
    } else rows.push({ lines: [l], y0: l.y0, y1: l.y1, text: '' })
  }
  for (const r of rows) {
    r.lines.sort((a, b) => a.x0 - b.x0)
    r.text = r.lines.map(l => l.text.trim()).join(' ')
  }
  return rows
}

/** 行的开头或结尾带页码，或者整行就是页码 */
function hasPageNumber(row: Row): boolean {
  return row.lines.some(l => isPageNumber(l.text.trim())) || withoutPageNumber(row.text) !== row.text.trim()
}

/**
 * 去掉页面最上面、最下面的页眉页脚行。判断依据：
 * 在页面边缘，和正文之间的空隙比正文行间距大得多，比正文行短，字不比正文大；
 * 像章节标题而又不带页码的不去掉（章节第一页顶部的标题）。
 * 只有标点的斑点"行"也一起去掉。
 */
export function dropMarginLines(lines: OcrLine[], pageHeight: number): OcrLine[] {
  const real = lines.filter(l => hasWords(l.text) && height(l) > 0)
  if (real.length < 3) return real
  const maxWidth = Math.max(...real.map(width))
  const body = real.filter(l => width(l) >= maxWidth * 0.6)
  const lineHeight = median(body.map(height))
  const bodyWidth = median(body.map(width))
  // 扫描斑点识别出的零星字符
  const kept = real.filter(l => height(l) >= lineHeight * 0.35 || l.text.trim().length > 2)
  const rows = toRows(kept)
  if (rows.length < 3) return kept

  // 正文行与行之间的空隙（页眉和正文之间的空隙明显更大）
  const gaps: number[] = []
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i].y0 - rows[i - 1].y1)
  const lineGap = Math.max(0, median(gaps))
  const bodyChars = median(body.map(l => l.text.replace(/\s+/g, '').length))

  const margin = (row: Row, gap: number, atEdge: boolean) => {
    if (!atEdge || gap < Math.max(lineGap * 2, lineHeight)) return false
    if (Math.max(...row.lines.map(height)) > lineHeight * 1.4) return false
    const numbered = hasPageNumber(row)
    if (headingLike(row.text) && !numbered) return false
    // 比正文行短（扫描斑点会把行的范围拉宽，所以也按字数算）
    const chars = row.text.replace(/\s+/g, '').length
    return chars <= Math.max(20, bodyChars * 0.6) || row.lines.reduce((sum, l) => sum + width(l), 0) < bodyWidth * 0.7
  }

  const drop = new Set<OcrLine>()
  const [top, second] = rows
  if (margin(top, second.y0 - top.y1, top.y1 <= pageHeight * 0.2)) top.lines.forEach(l => drop.add(l))
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  if (margin(last, last.y0 - prev.y1, last.y0 >= pageHeight * 0.8)) last.lines.forEach(l => drop.add(l))
  return kept.filter(l => !drop.has(l))
}

/** 把行按段落拼回文字：段内换行，段落之间空一行（交给 ocrTextToParagraphs 整理） */
export function linesToText(lines: OcrLine[]): string {
  let out = ''
  let para: number | null = null
  for (const l of lines) {
    if (para !== null) out += l.para === para ? '\n' : '\n\n'
    out += l.text.replace(/\n+$/, '')
    para = l.para
  }
  return out
}
