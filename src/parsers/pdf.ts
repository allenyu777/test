// PDF：用 pdf.js 提取文字，再按行距、缩进、标点把行合并成段落
import { BookBuilder, type ParsedBook, type TocEntry } from '../core/book'
import { chapterLevel } from '../core/chapters'
import { cjkRatio, detectLang, isCjkChar } from '../core/text'
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

/** 去掉每页重复出现的页眉页脚和页码 */
export function stripHeadersFooters(pages: Line[][]): Line[][] {
  // 页数太少时无法判断哪些是重复的页眉页脚
  if (pages.length < 5) return pages.map(lines => lines.filter(l => !PAGE_NUMBER.test(l.text)))
  const counts = new Map<string, number>()
  for (const lines of pages) {
    const edge = new Set([...lines.slice(0, 2), ...lines.slice(-2)].map(l => normalizeRepeat(l.text)))
    for (const key of edge) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const threshold = Math.max(3, pages.length * 0.3)
  return pages.map(lines =>
    lines.filter((l, i) => {
      const isEdge = i < 2 || i >= lines.length - 2
      if (!isEdge) return true
      if (PAGE_NUMBER.test(l.text)) return false
      // 页眉页脚一般很短（书名、章节名）
      if (l.text.length > 40) return true
      return (counts.get(normalizeRepeat(l.text)) ?? 0) < threshold
    }),
  )
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
  }

  let prevLine: Line | null = null
  for (const lines of pages) {
    pageStarts.push(builder.length)
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
  }
  flush()
  return pageStarts
}

/** 扫描版 PDF：没有文字层，需要先做文字识别 */
export class ScannedPdfError extends Error {
  constructor(
    readonly pages: number,
    readonly title: string,
    readonly author: string,
  ) {
    super('这是扫描版 PDF，需要先识别文字')
  }
}

type PdfDocument = Awaited<ReturnType<typeof import('pdfjs-dist/legacy/build/pdf.mjs')['getDocument']>['promise']>

/** 打开 PDF（会复制一份数据，pdf.js 会把传入的数据转交给后台线程） */
export async function openPdf(data: ArrayBuffer | Uint8Array): Promise<PdfDocument> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const cMapUrl = import.meta.env.DEV ? '/node_modules/pdfjs-dist/cmaps/' : new URL('pdfjs/cmaps/', document.baseURI).href
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0))
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

/** 读取某一页的文字层（页码从 0 开始），按段落返回 */
export async function pageParagraphs(pdf: PdfDocument, index: number): Promise<string[]> {
  const page = await pdf.getPage(index + 1)
  try {
    const content = await page.getTextContent()
    const builder = new BookBuilder()
    linesToParagraphs(stripHeadersFooters([groupLines(content.items as TextItemLike[])]), builder)
    return builder.blocks
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
    const totalChars = pages.reduce((sum, lines) => sum + lines.reduce((s, l) => s + l.text.length, 0), 0)
    const textPages = pages.filter(lines => lines.reduce((s, l) => s + l.text.length, 0) >= 20).length
    // 大部分页面没有文字层：按扫描版处理，交给文字识别
    if (totalChars < Math.max(50, pdf.numPages * 5) || textPages < pdf.numPages * 0.6) {
      const info = await pdfInfo(pdf, fileName)
      throw new ScannedPdfError(pdf.numPages, info.title, info.author)
    }

    const builder = new BookBuilder()
    const pageStarts = linesToParagraphs(stripHeadersFooters(pages), builder)

    // PDF 书签作为目录
    const toc: TocEntry[] = []
    try {
      const outline = await pdf.getOutline()
      const walk = async (items: typeof outline, level: number) => {
        for (const item of items ?? []) {
          try {
            let dest = item.dest
            if (typeof dest === 'string') dest = await pdf.getDestination(dest)
            if (Array.isArray(dest) && dest[0] != null) {
              const ref = dest[0]
              const pageIndex = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref)
              const b = pageStarts[pageIndex]
              if (b != null) toc.push({ title: item.title, b, level })
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

    const { title, author } = await pdfInfo(pdf, fileName)
    return {
      title,
      author,
      lang: detectLang(builder.blocks.slice(0, 300).join('\n')),
      blocks: builder.blocks,
      heads: builder.heads,
      toc,
    }
  } finally {
    pdf.destroy()
  }
}
