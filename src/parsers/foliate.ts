// 借助 foliate-js 解析 EPUB / MOBI / AZW3 / FB2，再统一提取成段落
import { unzipSync, unzlibSync } from 'fflate'
import { BookBuilder, type ParsedBook, type TocEntry } from '../core/book'
import { detectLang } from '../core/text'
import { extractBlocks, hasParserError } from './dom'
import { decodeText, sniffDeclaredEncoding } from './encoding'
import type { FoliateBook, FoliateTocItem } from 'foliate-js/epub.js'

export type Progress = (ratio: number, message?: string) => void

const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0))

function langString(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(langString).filter(Boolean).join('、')
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.name === 'string' || typeof obj.name === 'object') return langString(obj.name)
    const first = Object.values(obj)[0]
    return langString(first)
  }
  return String(value)
}

async function loadDocument(
  section: FoliateBook['sections'][number],
  loadRaw?: (section: FoliateBook['sections'][number]) => string | null,
): Promise<Document | null> {
  try {
    const doc = await section.createDocument()
    if (doc && !hasParserError(doc)) return doc
  } catch {
    // 继续尝试下面的兜底方式
  }
  // XHTML 不规范时，退回到宽松的 HTML 解析：优先直接读原文
  const raw = loadRaw?.(section)
  if (raw) return new DOMParser().parseFromString(raw, 'text/html')
  try {
    const url = await section.load?.()
    if (!url) return null
    const text = await (await fetch(url)).text()
    return new DOMParser().parseFromString(text, 'text/html')
  } catch {
    return null
  } finally {
    ;(section as { unload?: () => void }).unload?.()
  }
}

export async function extractFoliateBook(
  book: FoliateBook,
  fallbackTitle: string,
  onProgress?: Progress,
  loadRaw?: (section: FoliateBook['sections'][number]) => string | null,
): Promise<ParsedBook> {
  // 展平目录
  const flat: { title: string; href: string; level: number; order: number }[] = []
  const walk = (items: FoliateTocItem[] | null | undefined, level: number) => {
    for (const item of items ?? []) {
      if (item.href) flat.push({ title: (item.label ?? '').trim(), href: item.href, level, order: flat.length })
      walk(item.subitems, level + 1)
    }
  }
  walk(book.toc, 0)

  const bySection = new Map<number, { entry: (typeof flat)[number]; anchor: (doc: Document) => unknown }[]>()
  for (const entry of flat) {
    try {
      const resolved = await book.resolveHref(entry.href)
      if (!resolved || resolved.index == null || resolved.index < 0) continue
      const list = bySection.get(resolved.index) ?? []
      list.push({ entry, anchor: resolved.anchor })
      bySection.set(resolved.index, list)
    } catch {
      // 忽略无法解析的目录项
    }
  }

  const builder = new BookBuilder()
  const toc: (TocEntry & { order: number })[] = []
  const total = book.sections.length
  for (let i = 0; i < total; i++) {
    const section = book.sections[i]
    const targets = bySection.get(i) ?? []
    if (section.linear === 'no' && !targets.length) continue
    const start = builder.length
    const doc = await loadDocument(section, loadRaw)
    if (!doc) continue
    const marks = new Map<Element, number>()
    const anchored = targets.map(({ entry, anchor }) => {
      let el: Element | null = null
      try {
        const a = anchor(doc)
        if (a && typeof a === 'object') el = a as Element
      } catch {
        el = null
      }
      if (el) marks.set(el, -1)
      return { entry, el }
    })
    extractBlocks(doc.body ?? doc.documentElement, builder, marks)
    for (const { entry, el } of anchored) {
      const b = el ? marks.get(el) ?? start : start
      toc.push({ title: entry.title, level: entry.level, b: b >= 0 ? b : start, order: entry.order })
    }
    if (i % 4 === 3) {
      onProgress?.(i / total, `正在解析 ${i + 1}/${total}`)
      await yieldToUI()
    }
  }
  toc.sort((a, b) => a.order - b.order)

  const meta = book.metadata ?? {}
  let cover: Blob | null = null
  try {
    cover = (await book.getCover?.()) ?? null
  } catch {
    cover = null
  }
  const langMeta = langString(meta.language)
  const sampleText = builder.blocks.slice(0, 200).join('\n')
  return {
    title: langString(meta.title) || fallbackTitle,
    author: langString(meta.author),
    lang: langMeta || detectLang(sampleText),
    blocks: builder.blocks,
    heads: builder.heads,
    notes: builder.notes,
    toc: toc.map(({ title, b, level }) => ({ title, b, level })),
    cover,
  }
}

const MEDIA_RE = /\.(jpe?g|png|gif|webp|bmp|svg|ttf|otf|woff2?|mp3|m4a|mp4|ogg|oga|wav|webm|avif|tiff?)$/i

/** 没有 UTF-8 标记的 ZIP，fflate 按单字节解码文件名；还原成 UTF-8 或 GBK */
function redecodeName(name: string): string | null {
  if (!/[\x80-\xff]/.test(name) || /[^\x00-\xff]/.test(name)) return null
  const raw = Uint8Array.from(name, c => c.charCodeAt(0))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(raw)
    } catch {
      return null
    }
  }
}

function zipLoader(data: Uint8Array) {
  const files = unzipSync(data, { filter: f => !MEDIA_RE.test(f.name) })
  for (const key of Object.keys(files)) {
    const alt = redecodeName(key)
    if (alt && !files[alt]) files[alt] = files[key]
  }
  const find = (name: string): Uint8Array | undefined => {
    if (files[name]) return files[name]
    try {
      const decoded = decodeURI(name)
      if (files[decoded]) return files[decoded]
    } catch {
      // 不是合法的 URI 编码
    }
    const encoded = encodeURI(name)
    if (files[encoded]) return files[encoded]
    // 大小写不一致的情况
    const lower = name.toLowerCase()
    const key = Object.keys(files).find(k => k.toLowerCase() === lower)
    return key ? files[key] : undefined
  }
  const loadMedia = (name: string): Uint8Array | undefined => {
    let decoded = name
    try {
      decoded = decodeURI(name)
    } catch {
      decoded = name
    }
    const extra = unzipSync(data, {
      filter: f => f.name === name || f.name === decoded || redecodeName(f.name) === decoded,
    })
    return Object.values(extra)[0]
  }
  return {
    files,
    loadText: (name: string) => {
      const f = find(name)
      if (!f) return null
      return decodeText(f, sniffDeclaredEncoding(f))
    },
    loadBlob: (name: string) => {
      const f = find(name) ?? (MEDIA_RE.test(name) ? loadMedia(name) : undefined)
      return f ? new Blob([f as Uint8Array<ArrayBuffer>]) : null
    },
    getSize: (name: string) => find(name)?.length ?? 0,
  }
}

export async function parseEpub(buffer: ArrayBuffer, fallbackTitle: string, onProgress?: Progress): Promise<ParsedBook> {
  const { EPUB } = await import('foliate-js/epub.js')
  const loader = zipLoader(new Uint8Array(buffer))
  if (!loader.files['META-INF/container.xml']) throw new Error('这不是有效的 EPUB 文件')
  // 字体去混淆需要 SHA-1；非 HTTPS 环境没有 crypto.subtle，返回空值避免整本书导入失败
  const sha1 = async (str: string) =>
    globalThis.crypto?.subtle
      ? new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str)))
      : new Uint8Array(20)
  const book = await new EPUB({ ...loader, sha1 }).init()
  try {
    return await extractFoliateBook(book, fallbackTitle, onProgress, section =>
      typeof section.id === 'string' ? loader.loadText(section.id) : null,
    )
  } finally {
    book.destroy?.()
  }
}

export async function parseMobi(file: Blob, fallbackTitle: string, onProgress?: Progress): Promise<ParsedBook> {
  const { MOBI, isMOBI } = await import('foliate-js/mobi.js')
  if (!(await isMOBI(file))) throw new Error('无法识别的 Kindle 文件（可能是 Topaz 格式或已损坏）')
  const mobi = new MOBI({ unzlib: unzlibSync })
  const book = await mobi.open(file)
  if (mobi.headers?.palmdoc?.encryption) {
    throw new Error('这本书受 DRM 加密保护，无法读取。请使用无 DRM 的版本。')
  }
  return extractFoliateBook(book, fallbackTitle, onProgress)
}

export async function parseFb2(file: Blob, fallbackTitle: string, onProgress?: Progress): Promise<ParsedBook> {
  const { makeFB2 } = await import('foliate-js/fb2.js')
  const book = await makeFB2(file)
  try {
    return await extractFoliateBook(book, fallbackTitle, onProgress)
  } finally {
    book.destroy?.()
  }
}

export async function parseFbz(buffer: ArrayBuffer, fallbackTitle: string, onProgress?: Progress): Promise<ParsedBook> {
  const files = unzipSync(new Uint8Array(buffer), { filter: f => /\.fb2$/i.test(f.name) })
  const first = Object.values(files)[0]
  if (!first) throw new Error('压缩包里没有找到 FB2 文件')
  return parseFb2(new Blob([first as Uint8Array<ArrayBuffer>]), fallbackTitle, onProgress)
}
