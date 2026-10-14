// 扫描版 PDF 的后台识别：逐页识别、逐页保存，识别完一页就能接着听
import { buildSections, type BookContent, type TocEntry } from '../core/book'
import { detectChapters } from '../core/chapters'
import { normalizeText } from '../core/text'
import * as db from '../db'
import type { BookMeta, OcrInfo } from '../db'
import { extendLoadedBook, library, patchBookLocal } from '../library'
import { pageParagraphs, renderPage } from '../parsers/pdf'
import { setWakeLock } from '../tts/audio'
import { recognizeCanvas, releaseLocalOcr } from './engines'
import { ocrTextToParagraphs } from './text'

type Listener = (bookId: string) => void

/** 根据已识别的段落重新生成目录和分段：识别出章节就用章节，否则每 10 页一个目录项 */
export function rebuildOcrContent(content: BookContent) {
  const hits = detectChapters(content.blocks)
  content.heads = {}
  for (const h of hits) content.heads[h.index] = h.level + 2
  let toc: TocEntry[] = hits.map(h => ({ title: content.blocks[h.index], b: h.index, level: h.level }))
  if (toc.length < 2) {
    toc = []
    const pages = content.pages ?? []
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

class OcrRunner {
  private queue: string[] = []
  private current: string | null = null
  private listeners = new Set<Listener>()
  /** 正在进行中的识别任务数（后台队列 + 导入时的首页识别） */
  private active = 0

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
    if (!this.isRunning(id)) this.queue.push(id)
    this.pump()
  }

  /** App 启动时继续之前没识别完的书 */
  resumeAll() {
    for (const b of library.get().books) if (b.ocr?.status === 'running') this.start(b.id)
  }

  async pause(id: string) {
    this.queue = this.queue.filter(x => x !== id)
    await this.setOcr(id, { status: 'paused' })
  }

  async resume(id: string) {
    await this.setOcr(id, { status: 'running', error: undefined })
    this.start(id)
  }

  private async setOcr(id: string, patch: Partial<OcrInfo>) {
    const meta = library.get().books.find(b => b.id === id) ?? (await db.getBook(id))
    if (!meta?.ocr) return
    const ocr = { ...meta.ocr, ...patch }
    patchBookLocal(id, { ocr })
    await db.updateBook(id, { ocr })
    this.listeners.forEach(fn => fn(id))
  }

  private async pump() {
    if (this.current) return
    const id = this.queue.shift()
    if (!id) {
      this.releaseIfIdle()
      return
    }
    this.current = id
    try {
      await this.process(id)
    } catch (e) {
      console.error(e)
      await this.setOcr(id, { status: 'error', error: e instanceof Error ? e.message : '识别失败' })
    } finally {
      this.current = null
      this.pump()
    }
  }

  /**
   * 识别一本书剩下的页面。
   * untilText：导入时用，识别出第一段文字就停下（其余交给后台）。
   */
  async process(id: string, options: { untilText?: boolean; onPage?: (done: number, total: number) => void } = {}) {
    const meta = await db.getBook(id)
    if (!meta?.ocr || meta.ocr.status === 'done') return
    const file = await db.getFile(id)
    if (!file) throw new Error('原始 PDF 不在本机，无法继续识别（可以重新导入）')
    const content = (await db.getContent(id)) ?? { id, blocks: [], heads: {}, toc: [], sections: [], pages: [] }
    content.pages ??= []
    const { openPdf } = await import('../parsers/pdf')
    const pdf = await openPdf(file.data)
    this.active++
    setWakeLock(true, 'ocr')
    let ocr: OcrInfo = { ...meta.ocr }
    try {
      for (let p = ocr.done; p < ocr.pages; p++) {
        // 用户暂停或删除了这本书
        const live = library.get().books.find(b => b.id === id)
        if (!options.untilText && (!live || live.ocr?.status !== 'running')) return
        options.onPage?.(p, ocr.pages)

        const paragraphs = await this.recognizePage(pdf, p, ocr)
        content.pages[p] = content.blocks.length
        for (const text of paragraphs) {
          const t = normalizeText(text)
          if (t) content.blocks.push(t)
        }
        rebuildOcrContent(content)
        // 识别这一页期间用户可能点了暂停：以最新状态为准，不要覆盖
        const liveStatus = library.get().books.find(b => b.id === id)?.ocr?.status ?? ocr.status
        const finished = p + 1 >= ocr.pages
        ocr = { ...ocr, done: p + 1, status: finished ? 'done' : liveStatus === 'paused' ? 'paused' : ocr.status }
        const totalChars = content.blocks.reduce((sum, b) => sum + b.length, 0)
        const patch: Partial<BookMeta> = { ocr, totalChars }
        if (!meta.chapter && content.toc.length) patch.chapter = content.toc[0].title
        await db.saveContent(content)
        await db.updateBook(id, patch)
        patchBookLocal(id, patch)
        extendLoadedBook(id, content)
        this.listeners.forEach(fn => fn(id))
        if (options.untilText && content.blocks.length) return
      }
    } finally {
      pdf.destroy()
      this.active--
      if (!this.current || this.current === id) queueMicrotask(() => this.releaseIfIdle())
    }
  }

  /** 没有识别任务时，关闭屏幕常亮并释放识别引擎的内存 */
  private releaseIfIdle() {
    if (this.active > 0 || this.current || this.queue.length) return
    setWakeLock(false, 'ocr')
    releaseLocalOcr()
  }

  private async recognizePage(pdf: Awaited<ReturnType<typeof import('../parsers/pdf')['openPdf']>>, index: number, ocr: OcrInfo) {
    // 这一页本身有文字层（扫描版里夹着的文字页）就直接用
    const text = await pageParagraphs(pdf, index)
    if (text.join('').length >= 20) return text
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
