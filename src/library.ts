// 书架：导入、删除、加载书籍
import { Book, finalizeBook, type BookContent } from './core/book'
import { baseLang, detectLang } from './core/text'
import * as db from './db'
import type { BookMeta } from './db'
import { parseFile } from './parsers'
import { ScannedPdfError } from './parsers/pdf'
import { createStore } from './store'

export interface ImportState {
  name: string
  index: number
  total: number
  progress: number
  message: string
}

export const library = createStore<{ books: BookMeta[]; loaded: boolean; importing: ImportState | null }>({
  books: [],
  loaded: false,
  importing: null,
})

export async function refreshLibrary() {
  const books = await db.listBooks()
  library.set({ books, loaded: true })
}

/** 只更新内存中的书架（进度保存很频繁，避免反复读库） */
export function patchBookLocal(id: string, patch: Partial<BookMeta>) {
  library.set(s => ({ books: s.books.map(b => (b.id === id ? { ...b, ...patch } : b)) }))
}

export async function updateBookMeta(id: string, patch: Partial<BookMeta>) {
  patchBookLocal(id, patch)
  await db.updateBook(id, patch)
}

/** 把封面缩小，减少存储和书架渲染开销 */
async function shrinkCover(blob: Blob): Promise<{ data: ArrayBuffer; type: string } | null> {
  try {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('cover'))
      img.src = url
    })
    const scale = Math.min(1, 480 / img.naturalHeight, 320 / img.naturalWidth)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const out = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86))
    if (!out) return null
    return { data: await out.arrayBuffer(), type: 'image/jpeg' }
  } catch {
    return null
  }
}

export interface ImportOptions {
  /**
   * 遇到扫描版 PDF 时调用：询问用户并开始文字识别，返回新建的书；返回 null 表示跳过。
   * setProgress 用来更新导入进度提示。
   */
  onScanned?: (
    file: File,
    scanned: ScannedPdfError,
    setProgress: (progress: number, message: string) => void,
  ) => Promise<BookMeta | null>
}

export async function importFiles(files: File[], options: ImportOptions = {}): Promise<BookMeta[]> {
  const added: BookMeta[] = []
  const errors: string[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const base: ImportState = { name: file.name, index: i, total: files.length, progress: 0, message: '正在读取文件…' }
    library.set({ importing: base })
    try {
      const parsed = await parseFile(file, (progress, message) =>
        library.set({ importing: { ...base, progress, message: message ?? base.message } }),
      )
      library.set({ importing: { ...base, progress: 1, message: '正在保存…' } })
      const id = db.uid()
      const content = finalizeBook(id, parsed)
      const cover = parsed.cover ? await shrinkCover(parsed.cover) : null
      // 声明的语言为空、"und"，或与正文明显不符（如中文书标成 en）时，以正文识别为准
      const detected = detectLang(content.blocks.slice(0, 200).join('\n'))
      let lang = baseLang(parsed.lang)
      const cjk = ['zh', 'ja', 'ko']
      if (!lang || ['und', 'mul', 'zxx', 'mis'].includes(lang) || (cjk.includes(detected) && !cjk.includes(lang))) {
        lang = detected
      }
      const book = new Book(content)
      const meta: BookMeta = {
        id,
        title: parsed.title || file.name,
        author: parsed.author,
        lang,
        format: parsed.format,
        fileName: file.name,
        fileSize: file.size,
        addedAt: Date.now(),
        lastReadAt: 0,
        totalChars: book.totalChars,
        pos: book.speakableFrom({ b: 0, o: 0 }) ?? { b: 0, o: 0 },
        percent: 0,
        chapter: content.toc[0]?.title ?? '',
        cover: cover?.data ?? null,
        coverType: cover?.type,
      }
      await db.saveBook(meta, content)
      added.push(meta)
    } catch (e) {
      if (e instanceof ScannedPdfError && options.onScanned) {
        try {
          // 先收起导入进度，让用户选择识别方式
          library.set({ importing: null })
          const meta = await options.onScanned(file, e, (progress, message) =>
            library.set({ importing: { ...base, progress, message } }),
          )
          if (meta) added.push(meta)
        } catch (err) {
          console.error(err)
          errors.push(`${file.name}：${err instanceof Error ? err.message : '识别失败'}`)
        }
        continue
      }
      console.error(e)
      errors.push(`${file.name}：${e instanceof Error ? e.message : '解析失败'}`)
    }
  }
  library.set({ importing: null })
  await refreshLibrary()
  if (errors.length) throw new Error(errors.join('\n'))
  return added
}

export async function removeBook(id: string) {
  await db.deleteBook(id)
  if (cached?.meta.id === id) cached = null
  library.set(s => ({ books: s.books.filter(b => b.id !== id) }))
}

let cached: { meta: BookMeta; book: Book } | null = null

export async function loadBook(id: string): Promise<{ meta: BookMeta; book: Book } | null> {
  if (cached?.meta.id === id) {
    const fresh = library.get().books.find(b => b.id === id)
    if (fresh) cached.meta = fresh
    return cached
  }
  const [meta, content] = await Promise.all([db.getBook(id), db.getContent(id)])
  if (!meta || !content) return null
  cached = { meta, book: new Book(content) }
  return cached
}

/** 扫描版识别出新页面后，更新已加载的书（阅读页和播放器用的是同一个 Book 对象） */
export function extendLoadedBook(id: string, content: BookContent) {
  if (cached?.meta.id !== id) return
  cached.book.replace({
    ...content,
    blocks: content.blocks.slice(),
    heads: { ...content.heads },
    toc: content.toc.slice(),
    sections: content.sections.slice(),
    pages: content.pages?.slice(),
    notes: content.notes?.slice(),
    quiet: content.quiet?.slice(),
  })
  const fresh = library.get().books.find(b => b.id === id)
  if (fresh) cached.meta = fresh
}

const coverUrls = new Map<string, string>()

export function coverUrl(meta: BookMeta): string | null {
  if (!meta.cover) return null
  let url = coverUrls.get(meta.id)
  if (!url) {
    url = URL.createObjectURL(new Blob([meta.cover], { type: meta.coverType || 'image/jpeg' }))
    coverUrls.set(meta.id, url)
  }
  return url
}
