// 扫描版 PDF 的后台识别：逐页识别、逐页保存，识别完一页就能接着听
import { buildSections, type BookContent, type TocEntry } from '../core/book'
import { detectChapters } from '../core/chapters'
import { normalizeText } from '../core/text'
import * as db from '../db'
import type { OcrInfo } from '../db'
import { extendLoadedBook, library, patchBookLocal } from '../library'
import { isGarbled } from '../parsers/garble'
import {
  openPdf,
  pageParagraphs,
  readOutline,
  renderPage,
  sampleRepeatedLines,
  type OutlineItem,
  type PdfDocument,
} from '../parsers/pdf'
import { setWakeLock } from '../tts/audio'
import { recognizeCanvas, releaseLocalOcr } from './engines'
import {
  continuesAcrossPage,
  edgeKeys,
  isPageNumber,
  isPlatePage,
  joinLines,
  ocrTextToParagraphs,
  overlap,
  stripRunningHeads,
} from './text'

type Listener = (bookId: string) => void

/**
 * 根据已识别的段落重新生成目录和分段：
 * 优先用 PDF 自带的书签，其次用识别出的章节标题，都没有就每 10 页一个目录项
 */
export function rebuildOcrContent(content: BookContent, outline: OutlineItem[] = []) {
  const pages = content.pages ?? []
  const fromOutline: TocEntry[] = []
  for (const item of outline) {
    const start = pages[item.page]
    if (start == null || start >= content.blocks.length) continue
    // 章节从页面中间开始时，指向标题所在的段落
    const end = Math.min(pages.slice(item.page + 1).find(x => x != null) ?? content.blocks.length, content.blocks.length)
    let b = start
    for (let i = start; i < end; i++) {
      if (content.blocks[i] === item.title) {
        b = i
        break
      }
    }
    fromOutline.push({ title: item.title, b, level: item.level })
  }
  const hits = fromOutline.length ? [] : detectChapters(content.blocks)
  content.heads = {}
  for (const h of hits) content.heads[h.index] = h.level + 2
  // 书签标题正好是某个段落时，按标题样式显示
  for (const t of fromOutline) if (content.blocks[t.b] === t.title) content.heads[t.b] = Math.min(6, t.level + 1)
  let toc: TocEntry[] = fromOutline.length ? fromOutline : hits.map(h => ({ title: content.blocks[h.index], b: h.index, level: h.level }))
  if (toc.length < 2 && !fromOutline.length) {
    toc = []
    for (let p = 0; p < pages.length; p += 10) {
      const b = pages[p]
      if (b == null || b >= content.blocks.length || toc.some(t => t.b === b)) continue
      toc.push({ title: `第 ${p + 1} 页`, b, level: 0 })
    }
    if (!toc.length && content.blocks.length) toc.push({ title: '第 1 页', b: 0, level: 0 })
  }
  content.toc = toc
  content.sections = content.blocks.length ? buildSections(content.blocks, toc) : []
}

/** 书签指向这一页时，页首识别不准的章节标题用书签标题替换 */
export function applyOutlineTitles(paragraphs: string[], titles: string[]): string[] {
  const out = paragraphs.slice()
  for (const title of titles) {
    const limit = Math.min(3, out.length)
    for (let i = 0; i < limit; i++) {
      const p = out[i]
      if (p.length <= title.length * 2 + 6 && overlap(p, title) >= 0.6) {
        out[i] = title
        break
      }
    }
  }
  return out
}

/**
 * 把识别出的一页加到正文末尾。
 * 上一页最后一句话没说完时，和这一页的第一段接成一段（不然朗读会在句子中间停顿）。
 * titles：书签指向这一页的标题，不和上一页接起来；joinable：上一页是正文（空白页、插图页之后不接）。
 */
export function appendPage(content: BookContent, page: number, paragraphs: string[], titles: string[] = [], joinable = true) {
  content.pages ??= []
  const rest = paragraphs.slice()
  const last = content.blocks.length - 1
  if (
    joinable &&
    rest.length &&
    last >= 0 &&
    content.heads[last] == null &&
    !titles.includes(rest[0]) &&
    continuesAcrossPage(content.blocks[last], rest[0])
  ) {
    content.blocks[last] = joinLines([content.blocks[last], rest.shift()!])
  }
  // 指向这一页上开始的第一段（接上去的半句话算上一页的段落）
  content.pages[page] = content.blocks.length
  content.blocks.push(...rest)
}

// 识别失败后的重试间隔
const RETRY_DELAYS = [2000, 8000]
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** 等一会儿再试也不会好的错误（密钥不对、请求被拒、原文件没了） */
function permanentError(message = ''): boolean {
  return /密钥无效|不在本机|（4(?!08|29)\d\d）/.test(message)
}

class OcrRunner {
  private queue: string[] = []
  private current: string | null = null
  /** 正在听或正在看的书，优先识别 */
  private priority: string | null = null
  /** 识别中被删除的书 */
  private cancelled = new Set<string>()
  private listeners = new Set<Listener>()
  /** 正在进行中的识别任务数（后台队列 + 导入时的首页识别） */
  private active = 0

  constructor() {
    // 网络恢复后，继续因为网络问题停下的书
    if (typeof window !== 'undefined') window.addEventListener('online', () => this.retryFailed())
  }

  /** 有新页面识别完成时通知（播放器用来接着往下读） */
  onExtended(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  isRunning(id: string) {
    return this.current === id || this.queue.includes(id)
  }

  /** 加入后台队列 */
  start(id: string) {
    this.cancelled.delete(id)
    if (!this.isRunning(id)) {
      if (id === this.priority) this.queue.unshift(id)
      else this.queue.push(id)
    }
    this.pump()
  }

  /** 正在听或正在看的书排到最前面；正在识别别的书时，识别完当前这一页就换过来 */
  prioritize(id: string) {
    this.priority = id
    if (this.current !== id && this.queue.includes(id)) this.queue = [id, ...this.queue.filter(x => x !== id)]
  }

  /** 书被删除：移出队列，正在识别的话不再保存 */
  cancel(id: string) {
    this.queue = this.queue.filter(x => x !== id)
    if (this.current === id) this.cancelled.add(id)
    if (this.priority === id) this.priority = null
  }

  /** App 启动时继续之前没识别完的书 */
  resumeAll() {
    for (const b of library.get().books) if (b.ocr?.status === 'running') this.start(b.id)
    this.retryFailed()
  }

  private retryFailed() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    for (const b of library.get().books) {
      if (b.ocr?.status === 'error' && !permanentError(b.ocr.error)) this.resume(b.id).catch(console.error)
    }
  }

  async pause(id: string) {
    this.queue = this.queue.filter(x => x !== id)
    await this.setOcr(id, { status: 'paused' })
  }

  async resume(id: string) {
    if (await this.setOcr(id, { status: 'running', error: undefined })) this.start(id)
  }

  private async setOcr(id: string, patch: Partial<OcrInfo>): Promise<OcrInfo | null> {
    const ocr = await db.patchOcr(id, patch)
    if (ocr) {
      patchBookLocal(id, { ocr })
      this.listeners.forEach(fn => fn(id))
    }
    return ocr
  }

  private async pump() {
    if (this.current) return
    const id = this.queue.shift()
    if (!id) {
      this.releaseIfIdle()
      return
    }
    this.current = id
    let yielded = false
    try {
      yielded = (await this.process(id)) === 'yield'
    } catch (e) {
      console.error(e)
      const live = library.get().books.find(b => b.id === id)
      // 识别途中用户点了暂停或删除了书，就不标记为出错
      if (live?.ocr?.status === 'running' && !this.cancelled.has(id)) {
        const error = e instanceof Error ? e.message : '识别失败'
        await this.setOcr(id, { status: 'error', error }).catch(err => {
          // 连状态都存不进去：至少在界面上显示出错，不要一直显示"识别中"
          console.error(err)
          patchBookLocal(id, { ocr: { ...live.ocr!, status: 'error', error } })
          this.listeners.forEach(fn => fn(id))
        })
      }
    } finally {
      this.current = null
      this.cancelled.delete(id)
      if (yielded) {
        // 让优先的书先识别，这本排在它后面
        const i = this.priority ? this.queue.indexOf(this.priority) : -1
        this.queue.splice(i + 1, 0, id)
      } else if (this.priority === id && library.get().books.find(b => b.id === id)?.ocr?.status !== 'running') {
        this.priority = null
      }
      this.pump()
    }
  }

  private stopped(id: string): boolean {
    return this.cancelled.has(id) || library.get().books.find(b => b.id === id)?.ocr?.status !== 'running'
  }

  /**
   * 识别一本书剩下的页面。
   * untilText：导入时用，识别出第一段文字就停下（其余交给后台）。
   * 返回 'yield' 表示先让位给优先的书，之后接着识别。
   */
  async process(
    id: string,
    options: { untilText?: boolean; onPage?: (done: number, total: number) => void } = {},
  ): Promise<'yield' | void> {
    const meta = await db.getBook(id)
    if (!meta?.ocr || meta.ocr.status === 'done') return
    const file = await db.getFile(id)
    if (!file) throw new Error('原始 PDF 不在本机，无法继续识别（可以重新导入）')
    const content: BookContent = (await db.getContent(id)) ?? { id, blocks: [], heads: {}, toc: [], sections: [], pages: [] }
    content.pages ??= []
    this.active++
    setWakeLock(true, 'ocr')
    let pdf: PdfDocument | null = null
    try {
      // 文件只在这里用，不必再复制一份（大文件省一半内存）
      pdf = await openPdf(file.data, { copy: false })
      const outline = await readOutline(pdf)
      const repeated = await sampleRepeatedLines(pdf).catch(() => new Set<string>())
      let ocr: OcrInfo = { ...meta.ocr }
      // 最近 4 页的页首页尾短行（页眉通常单双页交替）
      let edges = Array.isArray(ocr.edges?.[0]) ? ocr.edges.slice(0, 4) : []
      // 上一页是正文才和它接起来（空白页、只有图片说明的插图页不接）
      const lastStart = content.pages[ocr.done - 1]
      let prevIsText = !(lastStart != null && lastStart < content.blocks.length && isPlatePage(content.blocks.slice(lastStart)))
      for (let p = ocr.done; p < ocr.pages; p++) {
        if (this.cancelled.has(id)) return
        if (!options.untilText) {
          if (this.stopped(id)) return
          if (this.priority && this.priority !== id && this.queue.includes(this.priority)) return 'yield'
        }
        options.onPage?.(p, ocr.pages)

        const raw = await this.recognizeWithRetry(id, pdf, p, ocr, repeated)
        if (!raw) return
        const titles = outline.filter(item => item.page === p).map(item => item.title)
        const paragraphs = applyOutlineTitles(stripRunningHeads(raw, edges.flat(), titles), titles)
          .map(t => normalizeText(t))
          .filter(Boolean)
        edges = [edgeKeys(raw), ...edges].slice(0, 4)
        const plate = isPlatePage(paragraphs)
        appendPage(content, p, paragraphs, titles, prevIsText && !plate)
        prevIsText = paragraphs.length > 0 && !plate
        rebuildOcrContent(content, outline)

        const finished = p + 1 >= ocr.pages
        ocr = { ...ocr, done: p + 1, status: finished ? 'done' : ocr.status, edges: finished ? undefined : edges }
        const totalChars = content.blocks.reduce((sum, b) => sum + b.length, 0)
        const saved = await db.saveOcrProgress(id, content, { ocr, totalChars }, content.toc[0]?.title)
        // 书在识别这一页的时候被删除了
        if (!saved || this.cancelled.has(id)) return
        patchBookLocal(id, { ocr: saved.ocr, totalChars: saved.totalChars, chapter: saved.chapter })
        extendLoadedBook(id, content)
        this.listeners.forEach(fn => fn(id))
        // 全部识别完，原始 PDF 不再需要，释放存储空间
        if (finished) await db.deleteFile(id).catch(() => {})
        if (options.untilText && content.blocks.length) return
      }
    } finally {
      pdf?.destroy()
      this.active--
      queueMicrotask(() => this.releaseIfIdle())
    }
  }

  /** 识别一页，失败时稍等再试；等待期间被暂停或删除返回 null */
  private async recognizeWithRetry(id: string, pdf: PdfDocument, page: number, ocr: OcrInfo, ignore: Set<string>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.recognizePage(pdf, page, ocr, ignore)
      } catch (e) {
        if (attempt >= RETRY_DELAYS.length || permanentError(e instanceof Error ? e.message : '')) throw e
        console.warn('识别失败，稍后重试', e)
        await sleep(RETRY_DELAYS[attempt])
        if (this.stopped(id)) return null
      }
    }
  }

  /** 没有识别任务时，关闭屏幕常亮并释放识别引擎的内存 */
  private releaseIfIdle() {
    if (this.active > 0 || this.current || this.queue.length) return
    setWakeLock(false, 'ocr')
    releaseLocalOcr()
  }

  private async recognizePage(pdf: PdfDocument, index: number, ocr: OcrInfo, ignore: Set<string>): Promise<string[]> {
    // 这一页本身有文字层（扫描版里夹着的文字页）就直接用
    const text = await pageParagraphs(pdf, index, ignore)
    const joined = text.join('\n')
    if (joined.length >= 20 && !isGarbled(joined)) {
      while (text.length && isPageNumber(text[0])) text.shift()
      while (text.length && isPageNumber(text[text.length - 1])) text.pop()
      return text
    }
    if (ocr.engine === 'cloud' && typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('云端识别：没有网络，联网后会自动继续')
    }
    const canvas = await renderPage(pdf, index)
    try {
      return ocrTextToParagraphs(await recognizeCanvas(canvas, ocr.engine, ocr.lang))
    } finally {
      // 及时释放画布内存（iOS 对画布总内存有限制）
      canvas.width = 0
      canvas.height = 0
    }
  }
}

export const ocrRunner = new OcrRunner()
