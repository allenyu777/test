// PDF：用 pdf.js 提取文字，再按行距、缩进、标点把行合并成段落
import { BookBuilder, type ParsedBook, type TocEntry } from '../core/book'
import { chapterLevel } from '../core/chapters'
import { cjkRatio, detectLang, isCjkChar } from '../core/text'
import type { OcrLang } from '../db'
import { garbleRatio, guessOcrLang, isGarbled } from './garble'
import { isNoteStart, notesToText } from './notes'
import { titleFromFileName } from './txt'
import type { Progress } from './foliate'

interface Line {
  text: string
  x: number
  right: number
  y: number
  size: number
}

interface TextItemLike {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

const TERMINAL = /[。！？!?…”」』"'.:：;；）)]$/
const PAGE_NUMBER = /^[\s\-—–·]*(\d{1,4}|[ivxlcdm]{1,6}|第\s*\d+\s*页|\d+\s*\/\s*\d+|page\s*\d+)[\s\-—–·]*$/i

function needsSpace(a: string, b: string): boolean {
  const last = a[a.length - 1]
  const first = b[0]
  if (!last || !first || /\s/.test(last) || /\s/.test(first)) return false
  return !isCjkChar(last) && !isCjkChar(first)
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const SUPERSCRIPT_REF = /^\s*[\[〔［(（]?\s*\d{1,3}\s*[\]〕］)）]?\s*$|^\s*[①-⑳*]\s*$/

/** 把 pdf.js 的文字片段合并成行 */
export function groupLines(items: TextItemLike[]): Line[] {
  const lines: Line[] = []
  let cur: Line | null = null
  const push = () => {
    if (cur && cur.text.trim()) {
      cur.text = cur.text.replace(/\s+/g, ' ').trim()
      lines.push(cur)
    }
    cur = null
  }
  for (const item of items) {
    if (typeof item.str !== 'string') continue
    const [, , c, d, e, f] = item.transform
    const size = Math.hypot(c, d) || item.height || 10
    // 正文里上标的注释编号显示成上标数字（"伤稼"⁷"），朗读时跳过
    if (cur && size < cur.size * 0.8 && f > cur.y && f - cur.y < cur.size && SUPERSCRIPT_REF.test(item.str)) {
      cur.text += item.str.replace(/[^\d①-⑳*]/g, '').replace(/\d/g, d => SUPERSCRIPT_DIGITS[+d])
      cur.right = Math.max(cur.right, e + (item.width || 0))
      continue
    }
    if (cur && Math.abs(f - cur.y) > Math.max(size, cur.size) * 0.5) push()
    if (!cur) cur = { text: '', x: e, right: e, y: f, size }
    else {
      const gap = e - cur.right
      if (gap > size * 0.2 && needsSpace(cur.text, item.str)) cur.text += ' '
    }
    cur.text += item.str
    cur.x = Math.min(cur.x, e)
    cur.right = Math.max(cur.right, e + (item.width || 0))
    cur.size = Math.max(cur.size, size)
    if (item.hasEOL) push()
  }
  push()
  return lines
}

const median = (values: number[]) => {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const normalizeRepeat = (s: string) => s.replace(/\d+/g, '#').replace(/\s+/g, '')

/** 页面顶部、底部各两行（页眉、页脚、水印所在的位置） */
function edgeLines<T>(lines: T[]): T[] {
  return lines.length <= 4 ? lines : [...lines.slice(0, 2), ...lines.slice(-2)]
}

/**
 * 在很多页的顶部或底部重复出现的短行（页眉、水印、"扫描全能王"之类的标记）。
 * 乱码行不算，留给乱码检测。
 */
export function repeatedLineKeys(pages: { text: string }[][], minShare = 0.5): Set<string> {
  const counts = new Map<string, number>()
  for (const lines of pages) {
    const keys = new Set(edgeLines(lines).filter(l => l.text.length <= 60 && garbleRatio(l.text) < 0.15).map(l => normalizeRepeat(l.text)))
    for (const key of keys) if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const threshold = Math.max(3, pages.length * minShare)
  return new Set([...counts].filter(([, n]) => n >= threshold).map(([k]) => k))
}

/** 去掉页面顶部、底部重复出现的行 */
export function dropRepeatedLines<T extends { text: string }>(lines: T[], repeated: Set<string> | undefined): T[] {
  if (!repeated?.size) return lines
  const edge = new Set(edgeLines(lines))
  return lines.filter(l => !(edge.has(l) && repeated.has(normalizeRepeat(l.text))))
}

/** 去掉每页重复出现的页眉页脚和页码 */
export function stripHeadersFooters(pages: Line[][]): Line[][] {
  // 页数太少时无法判断哪些是重复的页眉页脚
  if (pages.length < 5) return pages.map(lines => lines.filter(l => !PAGE_NUMBER.test(l.text)))
  const counts = new Map<string, number>()
  for (const lines of pages) {
    // 只看每页第一行和最后一行（页眉、页脚、页码所在）
    const edge = new Set([...lines.slice(0, 1), ...lines.slice(-1)].map(l => normalizeRepeat(l.text)))
    for (const key of edge) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const threshold = Math.max(3, pages.length * 0.5)
  return pages.map(lines =>
    lines.filter((l, i) => {
      const isEdge = i === 0 || i === lines.length - 1
      if (!isEdge) return true
      if (PAGE_NUMBER.test(l.text)) return false
      // 页眉页脚一般很短（书名、章节名）
      if (l.text.length > 40) return true
      return (counts.get(normalizeRepeat(l.text)) ?? 0) < threshold
    }),
  )
}

/**
 * 页面下方脚注开始的那一行（没有脚注返回 lines.length）：从这一行起到页底，字号都比上面的正文小，
 * 开头一行带注释编号（〔1〕 [1] ① 1 等），位置在页面下半部分。
 */
export function footnoteStart(lines: Line[]): number {
  if (lines.length < 3) return lines.length
  const top = Math.max(...lines.map(l => l.y))
  const bottom = Math.min(...lines.map(l => l.y))
  const fullWidth = Math.max(...lines.map(l => l.right - l.x))
  for (let k = 2; k < lines.length; k++) {
    // PDF 的坐标从下往上
    if (lines[k].y > bottom + (top - bottom) * 0.6) continue
    // 上面要有正文（至少两行写满的），不是只有章节标题
    const body = lines.slice(0, k).filter(l => l.right - l.x >= fullWidth * 0.7)
    if (body.length < 2) continue
    const bodySize = median(body.map(l => l.size))
    const small = (l: Line) => l.size <= bodySize * 0.92 || PAGE_NUMBER.test(l.text)
    if (lines[k].size > bodySize * 0.92 || !isNoteStart(lines[k].text, true)) continue
    if (!lines.slice(k).every(small)) continue
    return k
  }
  return lines.length
}

/** 按行距、缩进、句末标点合并成段落；返回段落和每页起始段落序号 */
export function linesToParagraphs(pages: Line[][], builder: BookBuilder): number[] {
  const all = pages.flat()
  const cjk = cjkRatio(all.slice(0, 400).map(l => l.text).join('')) > 0.3
  const widths = all.map(l => l.right - l.x).sort((a, b) => a - b)
  const fullWidth = widths[Math.floor(widths.length * 0.8)] ?? 0
  const bodySize = median(all.map(l => l.size))
  const pageStarts: number[] = []
  let para = ''
  let paraHead = false
  // 上一页的脚注：等跨页的那一段结束后再放
  let pendingNotes: string[] = []

  const join = (a: string, b: string) => {
    if (!a) return b
    if (cjk && (isCjkChar(a[a.length - 1]) || isCjkChar(b[0]))) return a + b
    if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b
    return a + ' ' + b
  }
  const flush = () => {
    if (para) builder.add(para, paraHead ? 2 : undefined)
    para = ''
    paraHead = false
    for (const note of pendingNotes) builder.add(note, undefined, 'note')
    pendingNotes = []
  }

  let prevLine: Line | null = null
  for (const all of pages) {
    pageStarts.push(builder.length)
    const split = footnoteStart(all)
    const lines = all.slice(0, split)
    const left = lines.length ? Math.min(...lines.map(l => l.x)) : 0
    const gaps: number[] = []
    for (let i = 1; i < lines.length; i++) {
      const dy = Math.abs(lines[i - 1].y - lines[i].y)
      if (dy > 0) gaps.push(dy)
    }
    const spacing = median(gaps) || bodySize * 1.5
    lines.forEach((line, i) => {
      const isHeading = chapterLevel(line.text) >= 0 || line.size > bodySize * 1.3
      const indented = line.x - left > line.size * 1.2
      let newPara = !para
      if (para && prevLine) {
        const prevShort = prevLine.right - prevLine.x < fullWidth * 0.82
        const sameColumnGap = i > 0 ? Math.abs(lines[i - 1].y - line.y) : 0
        if (isHeading || paraHead) newPara = true
        else if (i > 0 && sameColumnGap > spacing * 1.6) newPara = true
        else if (indented && (cjk || prevShort)) newPara = true
        else if (prevShort && TERMINAL.test(prevLine.text)) newPara = true
      }
      if (newPara) flush()
      para = join(para, line.text)
      if (isHeading) paraHead = true
      prevLine = line
    })
    if (split < all.length) {
      const notes = notesToText(all.slice(split).filter(l => !PAGE_NUMBER.test(l.text)).map(l => l.text))
      pendingNotes.push(...notes.split('\n\n').map(n => n.split('\n').reduce((a, b) => join(a, b), '')))
    }
  }
  flush()
  return pageStarts
}

/** 扫描版（没有文字层）或文字层是乱码的 PDF：需要按页面图片识别文字 */
export class ScannedPdfError extends Error {
  constructor(
    readonly pages: number,
    readonly title: string,
    readonly author: string,
    readonly reason: 'scanned' | 'garbled' = 'scanned',
    readonly langHint: OcrLang = 'chi_sim',
  ) {
    super(reason === 'garbled' ? '这本 PDF 的文字是乱码，需要重新识别文字' : '这是扫描版 PDF，需要先识别文字')
  }
}

export type PdfDocument = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs')['getDocument']>['promise']>

/**
 * 打开 PDF。pdf.js 会把传入的数据转交给后台线程，默认先复制一份；
 * 数据只用这一次时传 copy: false，避免大文件占两份内存。
 */
export async function openPdf(data: ArrayBuffer | Uint8Array, { copy = true } = {}): Promise<PdfDocument> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const cMapUrl = import.meta.env.DEV ? '/node_modules/pdfjs-dist/cmaps/' : new URL('pdfjs/cmaps/', document.baseURI).href
  const bytes = data instanceof Uint8Array ? (copy ? data.slice() : data) : new Uint8Array(copy ? data.slice(0) : data)
  return pdfjs.getDocument({
    data: bytes,
    cMapUrl,
    cMapPacked: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise
}

async function pdfInfo(pdf: PdfDocument, fileName: string) {
  let title = ''
  let author = ''
  try {
    const meta = await pdf.getMetadata()
    const info = meta.info as Record<string, string> | undefined
    title = info?.Title?.trim() ?? ''
    author = info?.Author?.trim() ?? ''
  } catch {
    // 没有元数据
  }
  const fromName = titleFromFileName(fileName)
  // 很多 PDF 的 Title 是 "Microsoft Word - xxx.doc" 这类无意义内容
  if (!title || /\.(docx?|pdf|indd|tex)$|^untitled|microsoft word/i.test(title)) title = fromName.title
  return { title, author: author || fromName.author }
}

/** 读取某一页的文字行（页码从 0 开始） */
export async function pageLines(pdf: PdfDocument, index: number): Promise<Line[]> {
  const page = await pdf.getPage(index + 1)
  try {
    const content = await page.getTextContent()
    return groupLines(content.items as TextItemLike[])
  } finally {
    page.cleanup()
  }
}

/** 抽样找出各页重复的文字行（水印、页眉），识别时忽略 */
export async function sampleRepeatedLines(pdf: PdfDocument): Promise<Set<string>> {
  const n = pdf.numPages
  const step = Math.max(1, Math.floor(n / 30))
  const pages: Line[][] = []
  for (let i = 0; i < n; i += step) pages.push(await pageLines(pdf, i))
  return repeatedLineKeys(pages)
}

/** 读取某一页的文字层（页码从 0 开始），按段落返回正文和脚注；页面首尾属于 ignore 的重复行会被去掉 */
export async function pageParagraphs(pdf: PdfDocument, index: number, ignore?: Set<string>): Promise<{ paragraphs: string[]; notes: string[] }> {
  const page = await pdf.getPage(index + 1)
  try {
    const content = await page.getTextContent()
    const builder = new BookBuilder()
    const lines = dropRepeatedLines(groupLines(content.items as TextItemLike[]), ignore)
    linesToParagraphs(stripHeadersFooters([lines]), builder)
    const notes = new Set(builder.notes)
    return { paragraphs: builder.blocks.filter((_, i) => !notes.has(i)), notes: builder.blocks.filter((_, i) => notes.has(i)) }
  } finally {
    page.cleanup()
  }
}

/** 把一页渲染成图片（供文字识别），宽度约 targetWidth 像素 */
export async function renderPage(pdf: PdfDocument, index: number, targetWidth = 1600): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(index + 1)
  try {
    const base = page.getViewport({ scale: 1 })
    // iOS 对画布面积有上限，控制在约 1600 万像素以内
    const scale = Math.min(3, targetWidth / base.width, Math.sqrt(12_000_000 / (base.width * base.height)))
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport, canvas } as Parameters<typeof page.render>[0]).promise
    return canvas
  } finally {
    page.cleanup()
  }
}

export interface OutlineItem {
  title: string
  /** 页码（从 0 开始） */
  page: number
  level: number
}

/** 读取 PDF 书签 */
export async function readOutline(pdf: PdfDocument): Promise<OutlineItem[]> {
  const result: OutlineItem[] = []
  try {
    const outline = await pdf.getOutline()
    const walk = async (items: typeof outline, level: number) => {
      for (const item of items ?? []) {
        try {
          let dest = item.dest
          if (typeof dest === 'string') dest = await pdf.getDestination(dest)
          if (Array.isArray(dest) && dest[0] != null) {
            const ref = dest[0]
            const page = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)
            if (item.title?.trim()) result.push({ title: item.title.trim(), page, level })
          }
        } catch {
          // 忽略无效书签
        }
        await walk(item.items, level + 1)
      }
    }
    await walk(outline, 0)
  } catch {
    // 没有书签
  }
  return result
}

export async function parsePdf(buffer: ArrayBuffer, fileName: string, onProgress?: Progress): Promise<ParsedBook> {
  const pdf = await openPdf(buffer)

  try {
    const pages: Line[][] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(groupLines(content.items as TextItemLike[]))
      page.cleanup()
      if (i % 5 === 0) onProgress?.(i / pdf.numPages, `正在提取文字 ${i}/${pdf.numPages} 页`)
    }
    // 每页都有的水印、页眉不算正文（扫描版常带"扫描全能王"之类的文字标记）
    const repeated = repeatedLineKeys(pages)
    const pageText = pages.map(lines => dropRepeatedLines(lines, repeated).map(l => l.text).join('\n'))
    const garbled = pageText.map(t => isGarbled(t))
    const garbledPages = garbled.filter(Boolean).length
    const goodText = pageText.filter((_, i) => !garbled[i])
    const totalChars = goodText.reduce((sum, t) => sum + t.length, 0)
    const textPages = goodText.filter(t => t.length >= 20).length
    // 字体缺少正确的字符映射时，提取出的文字是乱码：这些页按图片识别
    const tooManyGarbled = garbledPages >= Math.max(3, pdf.numPages * 0.05)
    // 大部分页面没有文字层：按扫描版处理，交给文字识别
    if (tooManyGarbled || totalChars < Math.max(50, pdf.numPages * 5) || textPages < pdf.numPages * 0.6) {
      const info = await pdfInfo(pdf, fileName)
      // 乱码页里的标题等行常常是正常的，也拿来判断繁简
      const cleanLines = pages.flat().map(l => l.text).filter(t => garbleRatio(t) === 0)
      const hint = guessOcrLang([info.title, info.author, ...cleanLines].join('\n').slice(0, 20000))
      throw new ScannedPdfError(pdf.numPages, info.title, info.author, garbledPages ? 'garbled' : 'scanned', hint)
    }
    // 个别乱码页（例如公式页）直接跳过
    for (let i = 0; i < pages.length; i++) if (garbled[i]) pages[i] = []

    const builder = new BookBuilder()
    const pageStarts = linesToParagraphs(stripHeadersFooters(pages), builder)

    // PDF 书签作为目录
    const toc: TocEntry[] = []
    for (const item of await readOutline(pdf)) {
      const b = pageStarts[item.page]
      if (b != null) toc.push({ title: item.title, b, level: item.level })
    }

    const { title, author } = await pdfInfo(pdf, fileName)
    return {
      title,
      author,
      lang: detectLang(builder.blocks.slice(0, 300).join('\n')),
      blocks: builder.blocks,
      heads: builder.heads,
      notes: builder.notes,
      toc,
    }
  } finally {
    pdf.destroy()
  }
}
