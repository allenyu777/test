// 根据识别出的每一行在页面上的位置整理版面：拆开双栏、去掉页眉页脚（页码、书名、章节名）、分段
import { isNoteStart, notesToText } from '../parsers/notes'
import type { RuleLine } from './rules'
import { isPageNumber, withoutPageNumber } from './text'

export interface OcrLine {
  text: string
  /** 所在段落的编号（同一段落的行相同） */
  para: number
  x0: number
  y0: number
  x1: number
  y1: number
  /** 和正文并排、字号明显更小的一块（照片旁边的说明文字） */
  aside?: boolean
}

type RawLine = Omit<OcrLine, 'para'>

/** 识别出的一个文字框 */
export interface OcrBox {
  text: string
  x: number
  y: number
  w: number
  h: number
}

const hasWords = (t: string) => /[\p{L}\p{N}]/u.test(t)
const height = (l: { y0: number; y1: number }) => l.y1 - l.y0
const width = (l: { x0: number; x1: number }) => l.x1 - l.x0
const charCount = (t: string) => [...t.replace(/\s+/g, '')].length

const endsLikeSentence = (t: string) => /[。！？…”」』]$/.test(t.trim()) || /[A-Za-z][.!?]["'”’]?$/.test(t.trim())

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 较小的中位数：行距这类数里混着个别特别大的（页眉下的空白、分节），行数少时也不被它带偏 */
function lowerMedian(xs: number[]): number {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}

function boxesToLine(boxes: OcrBox[]): RawLine {
  const sorted = boxes.slice().sort((a, b) => a.x - b.x)
  return {
    text: sorted.map(b => b.text).join(' '),
    x0: Math.min(...sorted.map(b => b.x)),
    y0: Math.min(...sorted.map(b => b.y)),
    x1: Math.max(...sorted.map(b => b.x + b.w)),
    y1: Math.max(...sorted.map(b => b.y + b.h)),
  }
}

/** 双栏页面的栏间位置（不是双栏返回 null） */
function findGutter(lines: RawLine[]): number | null {
  if (lines.length < 6) return null
  const minX = Math.min(...lines.map(l => l.x0))
  const maxX = Math.max(...lines.map(l => l.x1))
  const span = maxX - minX
  const mid = minX + span / 2
  const narrow = lines.filter(l => width(l) < span * 0.6)
  const left = narrow.filter(l => (l.x0 + l.x1) / 2 < mid)
  const right = narrow.filter(l => (l.x0 + l.x1) / 2 >= mid)
  if (left.length < 3 || right.length < 3 || left.length < narrow.length * 0.3 || right.length < narrow.length * 0.3) return null
  const leftEdge = percentile(left.map(l => l.x1), 0.9)
  const rightEdge = percentile(right.map(l => l.x0), 0.1)
  if (leftEdge > rightEdge) return null
  // 两栏要并排（高度范围大部分重叠）
  const top = Math.max(Math.min(...left.map(l => l.y0)), Math.min(...right.map(l => l.y0)))
  const bottom = Math.min(Math.max(...left.map(l => l.y1)), Math.max(...right.map(l => l.y1)))
  if (bottom - top < (Math.max(...lines.map(l => l.y1)) - Math.min(...lines.map(l => l.y0))) * 0.3) return null
  return (leftEdge + rightEdge) / 2
}

/**
 * PaddleOCR 把同一高度上的文字框归成一行。双栏排版时左右两栏的同一行会被并在一起，
 * 这里在栏间空白处拆开，按"左栏从上到下、再右栏从上到下"排列；跨栏的标题等仍按原位置。
 * 不是双栏时，每一组就是一行。
 */
export function groupsToLines(groups: OcrBox[][]): RawLine[] {
  const nonEmpty = groups.filter(g => g.length)
  // 比较字号只看含汉字的框（破折号、省略号的框很扁，不代表字号）
  const sized = (b: OcrBox) => /[\u3400-\u4dff\u4e01-\u9fff]/.test(b.text.replace(/一/g, ''))
  const bodyHeight = median(nonEmpty.flat().filter(sized).map(b => b.h))
  // 同一行上字号差得多的两块不拼成一行：和正文并排的小字是照片说明（标记出来，当作图片说明处理）
  const sizeSplit: (RawLine[] | null)[] = []
  const segments: RawLine[] = []
  for (const group of nonEmpty) {
    const sorted = group.slice().sort((a, b) => a.x - b.x)
    const h = median(sorted.map(b => b.h))
    let current: OcrBox[] = []
    const parts: OcrBox[][] = []
    let resized = false
    for (const box of sorted) {
      const prev = current[current.length - 1]
      const jump = !!prev && sized(prev) && sized(box) && Math.max(box.h, prev.h) / Math.min(box.h, prev.h) > 1.3
      if (prev && (box.x - (prev.x + prev.w) > h * 2 || jump)) {
        parts.push(current)
        current = []
        resized ||= jump
      }
      current.push(box)
    }
    if (current.length) parts.push(current)
    const lines = parts.map(boxesToLine)
    segments.push(...lines)
    sizeSplit.push(
      resized
        ? parts.map((p, k) => {
            // 照片说明：比同一行旁边的正文明显小（不到 0.8 倍），也比全页正文小
            const hs = p.filter(sized).map(b => b.h)
            const others = parts.filter((_, j) => j !== k).flat().filter(sized).map(b => b.h)
            const h = median(hs)
            const small = hs.length > 0 && others.length > 0 && h < median(others) * 0.8 && h < bodyHeight * 0.85
            return small ? { ...lines[k], aside: true } : lines[k]
          })
        : null,
    )
  }
  const whole = nonEmpty.map((g, k) => sizeSplit[k] ?? [boxesToLine(g)]).flat()
  const gutter = segments.length > whole.length ? findGutter(segments) : null
  if (gutter == null) return whole
  const lineHeight = median(segments.map(height))
  const out: RawLine[] = []
  let band: RawLine[] = []
  const flush = () => {
    out.push(...band.filter(l => (l.x0 + l.x1) / 2 < gutter), ...band.filter(l => (l.x0 + l.x1) / 2 >= gutter))
    band = []
  }
  for (const l of segments.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    if (l.x0 < gutter - lineHeight && l.x1 > gutter + lineHeight) {
      flush()
      out.push(l)
    } else band.push(l)
  }
  flush()
  return out
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
 * 带页码（或整行就是页码），在页面边缘，和正文之间的空隙比正文行间距大得多，比正文行短，字不比正文大。
 * 不带页码的页眉（书名、章节名）交给按文字重复去页眉的规则（stripRunningHeads），
 * 这样页面边上真正的正文短行（一节的最后一句、单独一行的脚注）不会被误删。
 * 只有标点的斑点"行"也一起去掉。
 */
export function dropMarginLines(lines: OcrLine[], pageHeight: number): OcrLine[] {
  const real = lines.filter(l => hasWords(l.text) && height(l) > 0)
  if (!real.length) return real
  const maxWidth = Math.max(...real.map(width))
  const body = real.filter(l => width(l) >= maxWidth * 0.6)
  const lineHeight = median(body.map(height))
  const bodyWidth = median(body.map(width))
  // 扫描斑点识别出的零星字符
  const kept = real.filter(l => height(l) >= lineHeight * 0.35 || l.text.trim().length > 2)
  const rows = toRows(kept)
  if (rows.length === 1) return isPageNumber(rows[0].text) ? [] : kept

  // 正文行与行之间的空隙：不算第一个和最后一个空隙（页眉、页脚和正文之间的空白）；行太少时按行高估计
  const gaps: number[] = []
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i].y0 - rows[i - 1].y1)
  const interior = gaps.slice(1, -1)
  const lineGap = interior.length >= 2 ? Math.max(0, lowerMedian(interior)) : lineHeight * 0.5
  const bodyChars = median(body.map(l => charCount(l.text)))

  const margin = (row: Row, gap: number, atEdge: boolean) => {
    if (!atEdge || gap < Math.max(lineGap * 2, lineHeight)) return false
    if (!hasPageNumber(row)) return false
    // 句子结尾的是正文（例如脚注）；扫描斑点常被识别成句点，只认中文句末标点或英文单词后的句号
    if (endsLikeSentence(row.text) && !isPageNumber(row.text)) return false
    if (Math.max(...row.lines.map(height)) > lineHeight * 1.4) return false
    // 比正文行短（扫描斑点会把行的范围拉宽，所以也按字数算）
    return charCount(row.text) <= Math.max(20, bodyChars * 0.6) || row.lines.reduce((sum, l) => sum + width(l), 0) < bodyWidth * 0.7
  }

  const drop = new Set<OcrLine>()
  const [top, second] = rows
  if (margin(top, second.y0 - top.y1, top.y1 <= pageHeight * 0.2)) top.lines.forEach(l => drop.add(l))
  const last = rows[rows.length - 1]
  const prev = rows[rows.length - 2]
  // 只有两行时，第二行已经是正文的话就不再当页脚检查
  if (rows.length > 2 || !drop.size) {
    if (margin(last, last.y0 - prev.y1, last.y0 >= pageHeight * 0.8)) last.lines.forEach(l => drop.add(l))
  }
  return kept.filter(l => !drop.has(l))
}

/**
 * 分出页面下方的脚注区。页面图片里找到了脚注线（rules）时，线下面带编号的各行就是脚注；
 * 没有找到时的判断依据：从某一行起到页底，字比上面的正文小，
 * 开头一行带注释编号（〔1〕 [1] ① 1. 等），和正文之间隔着一段空白（脚注线）或者大多数行都带编号。
 * 上一页没写完的注释（没有编号、字同样小、紧挨着下面的注释）也一起去掉。
 */
export function splitFootnotes(lines: OcrLine[], pageHeight: number, rules: RuleLine[] = []): { body: OcrLine[]; notes: string[] } {
  const rows = toRows(lines)
  const rowHeight = (r: Row) => median(r.lines.map(height))
  const rowWidth = (r: Row) => Math.max(...r.lines.map(l => l.x1)) - Math.min(...r.lines.map(l => l.x0))
  const fullWidth = Math.max(0, ...rows.map(rowWidth))
  const split = (start: number) => {
    const noteRows = rows.slice(start)
    const drop = new Set(noteRows.flatMap(r => r.lines))
    // 去掉脚注后重新分段（脚注的字小、行短，会影响正文的左右边界）
    return { body: assignParagraphs(lines.filter(l => !drop.has(l))), notes: noteRows.map(r => r.text) }
  }

  // 页面上有脚注线：线下面的就是脚注（线要靠左、比正文短，在两行之间的空白里）
  if (rows.length >= 2) {
    const left = Math.min(...rows.map(r => Math.min(...r.lines.map(l => l.x0))))
    const lineHeight = median(rows.map(rowHeight))
    for (const rule of rules) {
      if (rule.y < pageHeight * 0.35) continue
      if (rule.x0 > left + lineHeight * 1.5 || rule.x1 - rule.x0 > fullWidth * 0.6) continue
      const k = rows.findIndex(r => r.y0 > rule.y)
      if (k < 1 || rows[k - 1].y1 > rule.y) continue
      const zone = rows.slice(k)
      const smaller = median(zone.map(rowHeight)) <= median(rows.slice(0, k).map(rowHeight)) * 0.92
      if (isNoteStart(zone[0].text, true) || smaller) return split(k)
    }
  }
  for (let k = 2; k < rows.length; k++) {
    if (rows[k].y0 < pageHeight * 0.4) continue
    // 上面要有正文（至少两行写满的），不是只有章节标题
    const body = rows.slice(0, k).filter(r => rowWidth(r) >= fullWidth * 0.7)
    if (body.length < 2) continue
    const bodyHeight = median(body.map(rowHeight))
    const small = (r: Row) => rowHeight(r) <= bodyHeight * 0.88
    if (!small(rows[k]) || !isNoteStart(rows[k].text, true)) continue
    const zone = rows.slice(k)
    if (median(zone.map(rowHeight)) > bodyHeight * 0.88) continue
    const gaps: number[] = []
    for (let i = 1; i < k; i++) gaps.push(rows[i].y0 - rows[i - 1].y1)
    const lineGap = gaps.length >= 2 ? Math.max(0, lowerMedian(gaps)) : bodyHeight * 0.5
    const apart = (i: number) => rows[i].y0 - rows[i - 1].y1 >= Math.max(lineGap * 2, bodyHeight * 0.9)
    // 往上带上前面的注释：字同样小的续行，或者带编号的行（编号的括号常被识别得很高，行高不准）
    let start = k
    while (
      start > 2 &&
      !apart(start) &&
      rows[start - 1].y0 >= pageHeight * 0.3 &&
      (small(rows[start - 1]) || isNoteStart(rows[start - 1].text))
    )
      start--
    const marked = zone.filter(r => isNoteStart(r.text, true)).length
    if (!apart(start) && (marked < 2 || marked * 2 < zone.length)) continue
    return split(start)
  }
  return { body: lines, notes: [] }
}

// 图表标题："图 2-4 山西与直隶、上海粮价波动趋势之对比""表3.1""Figure 2"（短，不是完整的句子）
const CAPTION_ROW = /^\s*(?:图|圖|插图|插圖|附图|附圖|表|附表|地图|地圖|fig\.?|figure|table|plate|chart)\s*[0-9０-９一二三四五六七八九十]+(?:\s*[-—–.．·:：]\s*[0-9０-９]+)*/i
// 图表下面的说明、出处
const NOTE_HEAD = /^\s*(?:说明|說明|注|資料來源|资料来源|数据来源|數據來源|来源|來源|source|sources|note|notes)\s*[:：]/i
const cjkCount = (t: string) => (t.match(/[\u3400-\u9fff]/g) ?? []).length

const isCaptionRow = (t: string) => CAPTION_ROW.test(t.trim()) && t.trim().length <= 50 && !/[。！？；，]/.test(t)
const TABLE_CAPTION = /^\s*(?:表|附表|续表|續表|table)/i
// 正文的句子（表格里的字一般不带逗号句号）
const SENTENCE = /[，。；！？,;]/

/**
 * 分出页面上的插图、表格和它们的说明（显示为灰色，朗读时跳过）：
 * - 表格：图片上的长横线（边框、三线表）围起来的各行，连同上面的"表 2-4 ……"标题、下面的"资料来源："；
 *   没找到横线时，"表 ……"标题下面连续几行不成句子的文字也算表格；
 * - 插图：图表标题那一行；它上面紧挨着的图里的文字（坐标轴数字、图例，不是写满的正文行）；
 * - 标题下面以"说明：""资料来源："开头的一段，以及后面缩进排版的各条说明（悬挂缩进，回到正文左边距就结束）。
 * tableLines：页面图片上的长横线（findTableLines）。
 */
export function splitFigures(
  all: OcrLine[],
  tableLines: RuleLine[] = [],
): { body: OcrLine[]; figures: string[][]; /** 每个图表在页面上的上边 */ tops: number[] } {
  // 和正文并排的小字（照片旁边的说明）：算作图片说明，正文接着读
  const asides = all.filter(l => l.aside)
  const lines = asides.length ? all.filter(l => !l.aside) : all
  const rows = toRows(lines)
  const rowLeft = (r: Row) => Math.min(...r.lines.map(l => l.x0))
  const rowWidth = (r: Row) => Math.max(...r.lines.map(l => l.x1)) - rowLeft(r)
  const fullWidth = Math.max(0, ...rows.map(rowWidth))
  const isBodyRow = (r: Row) => cjkCount(r.text) >= 12 && rowWidth(r) >= fullWidth * 0.6
  // 写满整行的正文（表格里的字只占一栏，不会从左写到右）
  const isFullRow = (r: Row) => cjkCount(r.text) >= 12 && rowWidth(r) >= fullWidth * 0.85
  const taken = new Set<Row>()
  const figures: string[][] = []
  const tops: number[] = []
  if (asides.length) {
    figures.push([asides.map(l => l.text.trim()).join('')])
    tops.push(Math.min(...asides.map(l => l.y0)))
  }

  // 标题（或表格）下面的说明：返回说明结束的位置
  const notesEnd = (from: number) => {
    let end = from
    if (end < rows.length && !taken.has(rows[end]) && NOTE_HEAD.test(rows[end].text)) {
      const head = rows[end]
      const headX = rowLeft(head)
      const charW = rowWidth(head) / Math.max(1, charCount(head.text))
      end++
      while (end < rows.length && !taken.has(rows[end])) {
        const r = rows[end]
        const x = rowLeft(r)
        const numbered = /^\s*\d{1,2}\s*[.．、]/.test(r.text)
        if (numbered ? x >= headX - charW : x >= headX + charW * 2.5) end++
        else break
      }
    }
    return end
  }

  // 表格：相邻两条横线之间没有正文句子，就是表格的一部分
  const ys = [...new Set(tableLines.map(l => l.y))].sort((a, b) => a - b)
  const center = (r: Row) => (r.y0 + r.y1) / 2
  let bandStart = -1
  for (let i = 0; i + 1 <= ys.length; i++) {
    const inside = i + 1 < ys.length ? rows.filter(r => center(r) > ys[i] && center(r) < ys[i + 1]) : null
    const full = inside?.filter(isFullRow) ?? []
    const tableGap = inside !== null && full.length < 2 && !full.some(r => SENTENCE.test(r.text))
    if (tableGap && bandStart < 0) bandStart = i
    if (tableGap) continue
    if (bandStart >= 0) {
      const y0 = ys[bandStart]
      const y1 = ys[i]
      bandStart = -1
      const first = rows.findIndex(r => center(r) > y0)
      let last = rows.findIndex(r => center(r) >= y1)
      if (last < 0) last = rows.length
      if (first < 0 || first >= last) continue
      // 表格里的字都在横线的左右范围以内；照片的上下边也是长横线，但旁边绕排的正文在照片外面，不是表格
      const bandLines = tableLines.filter(l => l.y >= y0 && l.y <= y1)
      const bx0 = Math.min(...bandLines.map(l => l.x0))
      const bx1 = Math.max(...bandLines.map(l => l.x1))
      const within = (r: Row) => {
        const w = rowWidth(r)
        const overlap = Math.min(bx1, rowLeft(r) + w) - Math.max(bx0, rowLeft(r))
        return w > 0 && overlap >= w * 0.5
      }
      const inBand = rows.slice(first, last)
      if (inBand.filter(within).length * 2 < inBand.length) continue
      // 上面的标题（中间可能隔着一行单位说明）
      let top = first
      for (let k = first - 1; k >= Math.max(0, first - 2); k--) {
        if (taken.has(rows[k])) break
        if (isCaptionRow(rows[k].text)) {
          top = k
          break
        }
      }
      const end = notesEnd(last)
      const parts: string[] = []
      if (top < first) parts.push(rows.slice(top, first).map(r => r.text).join(' '))
      parts.push(...rows.slice(first, last).map(r => r.text))
      if (end > last) parts.push(...notesToText(rows.slice(last, end).map(r => r.text)).split('\n\n'))
      figures.push(parts)
      tops.push(rows[top].y0)
      for (const r of rows.slice(top, end)) taken.add(r)
    }
  }

  for (let c = 0; c < rows.length; c++) {
    const caption = rows[c]
    if (taken.has(caption) || !isCaptionRow(caption.text)) continue
    // 图里的文字：标题上面紧挨着、不是正文的行
    let top = c
    while (top > 0 && !isBodyRow(rows[top - 1]) && !taken.has(rows[top - 1])) top--
    // 没有横线的表格：标题下面不成句子的各行
    let cells = c + 1
    if (TABLE_CAPTION.test(caption.text)) {
      while (cells < rows.length && !taken.has(rows[cells]) && !SENTENCE.test(rows[cells].text) && !NOTE_HEAD.test(rows[cells].text))
        cells++
    }
    const end = notesEnd(cells)
    const label = rows.slice(top, c).map(r => r.text).join(' ')
    const parts: string[] = []
    if (label.trim()) parts.push(label)
    parts.push(caption.text)
    parts.push(...rows.slice(c + 1, cells).map(r => r.text))
    if (end > cells) parts.push(...notesToText(rows.slice(cells, end).map(r => r.text)).split('\n\n'))
    figures.push(parts)
    tops.push(rows[top].y0)
    for (const r of rows.slice(top, end)) taken.add(r)
    c = end - 1
  }
  if (!figures.length) return { body: lines, figures, tops }
  const drop = new Set<OcrLine>()
  for (const r of taken) for (const l of r.lines) drop.add(l)
  return { body: assignParagraphs(lines.filter(l => !drop.has(l))), figures, tops }
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

/**
 * 按版面把行分成段落（PaddleOCR 只给出一行一行的结果）：
 * 首行缩进、上一行没写满、或者和上一行隔得比平时远，就是新的一段。
 * 双栏时每一栏单独计算左右边界（换栏时也开始新的一段）。
 */
export function assignParagraphs(lines: RawLine[]): OcrLine[] {
  const real = lines.filter(l => hasWords(l.text) && height(l) > 0)
  if (!real.length) return []
  // 按"回到上面"（换栏）拆成几部分
  const runs: RawLine[][] = [[]]
  for (const l of real) {
    const run = runs[runs.length - 1]
    const prev = run[run.length - 1]
    if (prev && l.y1 < prev.y0) runs.push([l])
    else run.push(l)
  }
  const lineHeight = median(real.map(height))
  let para = -1
  const out: OcrLine[] = []
  for (const run of runs) {
    const maxWidth = Math.max(...run.map(width))
    const body = run.filter(l => width(l) >= maxWidth * 0.6)
    // 字宽：整行宽度除以字数（比框的高度可靠：扫描歪了框会变高）
    const charWidth = median(body.map(l => width(l) / Math.max(1, charCount(l.text)))) || lineHeight
    // 左边界取靠左的那一批（短段落多时大多数行是缩进的首行），右边界取靠右的那一批
    const left = percentile(body.map(l => l.x0), 0.1)
    const right = percentile(run.map(l => l.x1), 0.9)
    const gaps: number[] = []
    for (let i = 1; i < run.length; i++) gaps.push(run[i].y0 - run[i - 1].y1)
    const lineGap = gaps.length >= 2 ? Math.max(0, lowerMedian(gaps)) : lineHeight * 0.5
    // 上一行是不是一段的第一行
    let prevStarts = true
    run.forEach((l, i) => {
      const prev = run[i - 1]
      let starts = !prev
      if (prev) {
        // 整段缩进的引文：首行缩进四个字，后面各行缩进两个字，一行行都比左边界靠右，
        // 但只有比上一行更靠右才是新的一段；和上一行对齐时，上一行是首行才算新的一段（几段都只有一行）
        const indented = l.x0 > left + charWidth * 1.2
        const deeper = l.x0 > prev.x0 + charWidth * 1.2
        const aligned = Math.abs(l.x0 - prev.x0) <= charWidth * 0.6
        // 没写满的行是一段的结尾；但绕着图片排的窄栏，每行都在同一个位置结束（和上一行对齐），不算没写满
        const before = run[i - 2]
        const sameEnd = (a: RawLine | undefined) =>
          !!a &&
          Math.abs(prev.x1 - a.x1) <= charWidth * 0.6 &&
          Math.abs(prev.x0 - a.x0) <= charWidth * 2.5 &&
          Math.abs(height(prev) - height(a)) <= height(prev) * 0.25
        const column = sameEnd(before) || (sameEnd(l) && !indented)
        const prevShort = prev.x1 < right - charWidth * 1.5 && !column
        const farApart = l.y0 - prev.y1 > Math.max(lineGap * 2, lineHeight * 0.8)
        starts = (indented && (deeper || (aligned && prevStarts))) || prevShort || farApart
      }
      if (starts) para++
      prevStarts = starts
      out.push({ ...l, para })
    })
  }
  return out
}
