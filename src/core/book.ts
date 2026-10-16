// 书籍内容模型：所有格式最终都转换成"段落数组 + 目录"
import { detectChapters } from './chapters'
import { findQuietBlocks } from './quiet'
import { noteNumber } from '../parsers/notes'
import { isSpeakable, normalizeText, splitSentences, type Sentence } from './text'

/** 阅读位置：段落序号 + 句子在段落内的起始偏移 */
export interface Pos {
  b: number
  o: number
}

export interface TocEntry {
  title: string
  /** 指向的段落序号 */
  b: number
  level: number
}

/** 渲染分段（一次只渲染一段，避免超长章节卡顿） */
export interface SectionRange {
  start: number
  end: number
  title: string
}

export interface ParsedBook {
  title: string
  author: string
  lang: string
  blocks: string[]
  /** 段落序号 → 标题级别（1-6） */
  heads: Record<number, number>
  /** 脚注、注释段落的序号（显示，但默认不朗读） */
  notes?: number[]
  /** 表格、图片说明等只看不听的段落（解析时就能确定的） */
  quiet?: number[]
  toc: TocEntry[]
  cover?: Blob | null
}

export interface BookContent {
  id: string
  blocks: string[]
  heads: Record<number, number>
  toc: TocEntry[]
  sections: SectionRange[]
  /** PDF：每一页第一个段落的序号（扫描版逐页识别时使用） */
  pages?: number[]
  /** 脚注、注释段落的序号（从小到大；显示，但默认不朗读） */
  notes?: number[]
  /** 目录页、版权页、图表说明等只看不听的段落（从小到大） */
  quiet?: number[]
}

export class BookBuilder {
  blocks: string[] = []
  heads: Record<number, number> = {}
  notes: number[] = []
  quiet: number[] = []

  get length() {
    return this.blocks.length
  }

  /** 添加一个段落，返回其序号；空段落返回 -1。kind：脚注 / 只看不听的段落（表格、图片说明） */
  add(raw: string, head?: number, kind?: 'note' | 'quiet'): number {
    const text = normalizeText(raw)
    if (!text) return -1
    const index = this.blocks.length
    this.blocks.push(text)
    if (head) this.heads[index] = head
    if (kind === 'note') this.notes.push(index)
    else if (kind === 'quiet') this.quiet.push(index)
    return index
  }
}

const MAX_SECTION_CHARS = 12000

/** 整理目录：排序、去重、补全；没有目录时从标题或正文里识别章节 */
export function finalizeToc(blocks: string[], heads: Record<number, number>, toc: TocEntry[], skip?: Set<number>): TocEntry[] {
  const n = blocks.length
  let entries = toc
    .filter(t => t.b >= 0 && t.title.trim())
    .map(t => ({ title: normalizeText(t.title), b: Math.min(t.b, n - 1), level: Math.max(0, t.level) }))
  // 去掉重复（同一位置同一标题）
  const seen = new Set<string>()
  entries = entries.filter(t => {
    const key = `${t.b}:${t.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  // 保持书本目录顺序，但如果整体乱序则按位置排序
  if (entries.some((t, i) => i > 0 && t.b < entries[i - 1].b)) {
    entries = entries.map((t, i) => ({ t, i })).sort((x, y) => x.t.b - y.t.b || x.i - y.i).map(x => x.t)
  }
  if (entries.length >= 2 || (entries.length === 1 && n < 50)) return entries

  // 用 h1-h3 标题生成目录
  const headIdx = Object.keys(heads).map(Number).filter(i => heads[i] <= 3).sort((a, b) => a - b)
  if (headIdx.length >= 2 && headIdx.length <= n / 2) {
    const minLevel = Math.min(...headIdx.map(i => heads[i]))
    return headIdx
      .filter(i => blocks[i].length <= 80)
      .map(i => ({ title: blocks[i], b: i, level: heads[i] - minLevel }))
  }
  // 从正文识别"第X章"之类的标题
  const hits = detectChapters(blocks, skip)
  if (hits.length) {
    for (const h of hits) heads[h.index] = h.level + 2
    return hits.map(h => ({ title: blocks[h.index], b: h.index, level: h.level }))
  }
  return entries
}

/** 根据目录切分渲染分段，过长的再按字数切开 */
export function buildSections(blocks: string[], toc: TocEntry[]): SectionRange[] {
  const n = blocks.length
  const starts = new Map<number, string>()
  for (const t of toc) if (!starts.has(t.b)) starts.set(t.b, t.title)
  if (!starts.has(0)) starts.set(0, '')
  const sorted = [...starts.keys()].sort((a, b) => a - b)
  const sections: SectionRange[] = []
  sorted.forEach((start, i) => {
    const end = i + 1 < sorted.length ? sorted[i + 1] : n
    if (end <= start) return
    const title = starts.get(start) || (i === 0 ? '开始' : `第 ${i + 1} 部分`)
    let chars = 0
    let partStart = start
    let part = 1
    for (let b = start; b < end; b++) {
      chars += blocks[b].length
      if (chars >= MAX_SECTION_CHARS && b + 1 < end) {
        sections.push({ start: partStart, end: b + 1, title: part > 1 ? `${title}（${part}）` : title })
        partStart = b + 1
        chars = 0
        part++
      }
    }
    sections.push({ start: partStart, end, title: part > 1 ? `${title}（${part}）` : title })
  })
  return sections
}

/** 没有任何目录信息时，用分段生成一个简易目录 */
function syntheticToc(blocks: string[], sections: SectionRange[]): TocEntry[] {
  return sections.map((s, i) => {
    const preview = blocks[s.start].slice(0, 16)
    return { title: `第 ${i + 1} 部分 · ${preview}`, b: s.start, level: 0 }
  })
}

export function finalizeBook(id: string, parsed: ParsedBook): BookContent {
  const { blocks, heads } = parsed
  if (!blocks.length) throw new Error('没有在文件中找到可以朗读的文字')
  const notes = parsed.notes ?? []
  const quiet = [...new Set([...(parsed.quiet ?? []), ...findQuietBlocks(blocks, notes)])].sort((a, b) => a - b)
  let toc = finalizeToc(blocks, heads, parsed.toc, new Set([...notes, ...quiet]))
  const sections = buildSections(blocks, toc)
  if (!toc.length && sections.length > 1) toc = syntheticToc(blocks, sections)
  return { id, blocks, heads, toc, sections, ...(notes.length ? { notes } : {}), ...(quiet.length ? { quiet } : {}) }
}

/** 运行时的书籍对象：提供位置换算、分句缓存、前后句导航 */
export class Book {
  blocks!: string[]
  toc!: TocEntry[]
  sections!: SectionRange[]
  heads!: Record<number, number>
  pages?: number[]
  /** 脚注段落 */
  noteBlocks: Set<number> = new Set()
  /** 目录页、版权页、图表说明等只看不听的段落 */
  quietBlocks: Set<number> = new Set()
  /** 朗读时跳过脚注 */
  skipNotes = true
  /** 朗读时跳过目录页、版权页、图表 */
  skipQuiet = true
  /** cum[i] = 第 i 段之前的总字数 */
  cum!: Float64Array
  totalChars!: number
  private cache: Map<number, Sentence[]> = new Map()

  constructor(content: BookContent) {
    this.replace(content)
  }

  /**
   * 换成新的正文（扫描版 PDF 识别出新页面后调用）。
   * 只允许在末尾追加段落，已有段落不变，因此阅读位置和笔记仍然有效。
   */
  replace(content: BookContent) {
    // 以累计字数表的长度为准（调用方可能已经往同一个数组里追加了段落）
    const oldLength = this.cum ? this.cum.length - 1 : 0
    // 末尾是上一页的脚注时，跨页接上的半句话加在脚注前面那一段
    let lastBody = oldLength - 1
    while (lastBody > 0 && this.noteBlocks.has(lastBody)) lastBody--
    this.noteBlocks = new Set(content.notes)
    this.quietBlocks = new Set(content.quiet)
    this.blocks = content.blocks
    this.toc = content.toc
    this.sections = content.sections
    this.heads = content.heads
    this.pages = content.pages
    const cum = new Float64Array(this.blocks.length + 1)
    // 识别下一页时，可能把跨页的句子接到原来最后一段后面，所以最后一段也重新计算
    const keep = this.cum && oldLength <= this.blocks.length ? Math.max(0, lastBody) : 0
    if (keep) cum.set(this.cum.subarray(0, keep + 1))
    for (let i = keep; i < this.blocks.length; i++) cum[i + 1] = cum[i] + this.blocks[i].length
    for (const b of [...this.cache.keys()]) if (b >= keep) this.cache.delete(b)
    this.cum = cum
    this.totalChars = cum[this.blocks.length]
  }

  /** 段落所在的 PDF 页码（从 1 开始）；不是 PDF 时返回 0 */
  pageOf(b: number): number {
    const pages = this.pages
    if (!pages?.length) return 0
    let lo = 0
    let hi = pages.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pages[mid] <= b) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }

  isNote(b: number): boolean {
    return this.noteBlocks.has(b)
  }

  /**
   * 正文第 b 段里编号为 n 的注释：先找后面最近的编号相同的脚注（同一页的脚注、章末注），
   * 没有再往前找。找不到返回 -1
   */
  findNote(b: number, n: number): number {
    const notes = [...this.noteBlocks].sort((x, y) => x - y)
    const after = notes.find(i => i > b && noteNumber(this.blocks[i]) === n)
    if (after != null) return after
    for (let k = notes.length - 1; k >= 0; k--) if (notes[k] < b && noteNumber(this.blocks[notes[k]]) === n) return notes[k]
    return -1
  }

  isQuiet(b: number): boolean {
    return this.quietBlocks.has(b)
  }

  /** 朗读时跳过的段落 */
  skipped(b: number): boolean {
    return (this.skipNotes && this.noteBlocks.has(b)) || (this.skipQuiet && this.quietBlocks.has(b))
  }

  sentences(b: number): Sentence[] {
    let s = this.cache.get(b)
    if (!s) {
      const text = this.blocks[b] ?? ''
      s = splitSentences(text)
      if (!s.length && text) s = [{ o: 0, e: text.length }]
      // 还没识别出来的段落不缓存
      if (b < this.blocks.length) this.cache.set(b, s)
    }
    return s
  }

  /** 位置所在句子的序号 */
  sentenceIndex(pos: Pos): number {
    const list = this.sentences(pos.b)
    let idx = 0
    for (let i = 0; i < list.length; i++) {
      if (list[i].o <= pos.o) idx = i
      else break
    }
    return idx
  }

  sentenceText(pos: Pos): string {
    const list = this.sentences(pos.b)
    const s = list[this.sentenceIndex(pos)]
    return s ? this.blocks[pos.b].slice(s.o, s.e) : ''
  }

  /** 规范化位置，使其指向某个句子的开头 */
  clamp(pos: Pos | null | undefined): Pos {
    if (!pos || !this.blocks.length) return { b: 0, o: 0 }
    const b = Math.max(0, Math.min(this.blocks.length - 1, Math.floor(pos.b)))
    const list = this.sentences(b)
    if (!list.length) return { b, o: 0 }
    return { b, o: list[this.sentenceIndex({ b, o: pos.o })].o }
  }

  /** 下一句（跳过无法朗读的分隔符），到书末返回 null */
  next(pos: Pos, speakableOnly = true): Pos | null {
    let b = pos.b
    let list = this.sentences(b)
    let i = this.sentenceIndex(pos) + 1
    for (;;) {
      while (i < list.length) {
        const s = list[i]
        if (!speakableOnly) return { b, o: s.o }
        if (this.skipped(b)) break
        if (isSpeakable(this.blocks[b].slice(s.o, s.e))) return { b, o: s.o }
        i++
      }
      b++
      if (b >= this.blocks.length) return null
      list = this.sentences(b)
      i = 0
    }
  }

  prev(pos: Pos): Pos | null {
    let b = pos.b
    let i = this.sentenceIndex(pos) - 1
    for (;;) {
      const list = this.sentences(b)
      while (i >= 0 && !this.skipped(b)) {
        const s = list[i]
        if (isSpeakable(this.blocks[b].slice(s.o, s.e))) return { b, o: s.o }
        i--
      }
      b--
      if (b < 0) return null
      i = this.sentences(b).length - 1
    }
  }

  /** 当前位置若不可朗读（如分隔符），前进到下一个可朗读的句子 */
  speakableFrom(pos: Pos): Pos | null {
    const p = this.clamp(pos)
    const text = this.sentenceText(p)
    return isSpeakable(text) && !this.skipped(p.b) ? p : this.next(p)
  }

  charOffset(pos: Pos): number {
    return (this.cum[pos.b] ?? 0) + pos.o
  }

  percent(pos: Pos): number {
    if (!this.totalChars) return 0
    return Math.min(100, (this.charOffset(pos) / this.totalChars) * 100)
  }

  /** 按全书字数比例定位 */
  posAtPercent(percent: number): Pos {
    return this.posAtChar((percent / 100) * this.totalChars)
  }

  /** 按全书字数偏移定位到所在句子 */
  posAtChar(target: number): Pos {
    let lo = 0
    let hi = this.blocks.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.cum[mid] <= target) lo = mid
      else hi = mid - 1
    }
    return this.clamp({ b: lo, o: Math.max(0, target - this.cum[lo]) })
  }

  sectionIndex(b: number): number {
    let lo = 0
    let hi = this.sections.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.sections[mid].start <= b) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** 当前所在目录项（最后一个起点不晚于 b 的条目） */
  tocIndex(b: number): number {
    let idx = -1
    for (let i = 0; i < this.toc.length; i++) {
      if (this.toc[i].b <= b) {
        if (idx < 0 || this.toc[i].b >= this.toc[idx].b) idx = i
      }
    }
    return idx
  }

  chapterTitle(b: number): string {
    const i = this.tocIndex(b)
    if (i >= 0) return this.toc[i].title
    return this.sections[this.sectionIndex(b)]?.title ?? ''
  }

  /** 当前章节（目录项）的段落范围 */
  chapterRange(b: number): { start: number; end: number } {
    const i = this.tocIndex(b)
    if (i < 0) {
      const next = this.toc.find(t => t.b > b)
      return { start: 0, end: next ? next.b : this.blocks.length }
    }
    const start = this.toc[i].b
    let end = this.blocks.length
    for (const t of this.toc) if (t.b > start && t.b < end) end = t.b
    return { start, end }
  }

  charsBetween(fromB: number, toB: number): number {
    return this.cum[Math.min(toB, this.blocks.length)] - this.cum[Math.max(0, fromB)]
  }
}
