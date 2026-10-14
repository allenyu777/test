// 备份与恢复：书籍、进度、笔记、录音打包成一个 ZIP，可在换手机/换浏览器时迁移
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { Book, type BookContent } from './core/book'
import * as db from './db'
import type { BookMeta, Note } from './db'
import { formatDate } from './notes/export'
import { refreshLibrary } from './library'
import { player } from './player'

interface BackupManifest {
  app: 'tingshu'
  version: 1
  createdAt: number
  books: Omit<BookMeta, 'cover'>[]
  notes: Note[]
  audio: { id: string; type: string }[]
}

export async function createBackup(includeBooks: boolean): Promise<File> {
  const books = await db.listBooks()
  const notes = await db.listAllNotes()
  const audio = await db.listAudio()
  const files: Record<string, Uint8Array> = {}
  const manifest: BackupManifest = {
    app: 'tingshu',
    version: 1,
    createdAt: Date.now(),
    books: books.map(({ cover: _cover, ...rest }) => rest),
    notes,
    audio: audio.map(a => ({ id: a.id, type: a.type })),
  }
  for (const b of books) if (b.cover) files[`covers/${b.id}`] = new Uint8Array(b.cover)
  for (const a of audio) files[`audio/${a.id}`] = new Uint8Array(a.data)
  if (includeBooks) {
    for (const c of await db.listContents()) files[`contents/${c.id}.json`] = strToU8(JSON.stringify(c))
  }
  files['backup.json'] = strToU8(JSON.stringify(manifest))
  const zip = zipSync(files, { level: 6 })
  return new File([zip as Uint8Array<ArrayBuffer>], `听书备份-${formatDate(Date.now(), false)}.zip`, { type: 'application/zip' })
}

/** 按笔记引用的原文，在本机这本书里找到对应位置（找不到就保持原位） */
function relocate(book: Book, note: Note): Pick<Note, 'b' | 'o'> {
  const needle = note.quote.slice(0, 40)
  if (!needle) return { b: Math.min(note.b, book.blocks.length - 1), o: 0 }
  let best: { b: number; o: number } | null = null
  for (let b = 0; b < book.blocks.length; b++) {
    const o = book.blocks[b].indexOf(needle)
    if (o >= 0 && (!best || Math.abs(b - note.b) < Math.abs(best.b - note.b))) best = { b, o }
  }
  return best ?? book.clamp({ b: note.b, o: note.o })
}

export async function restoreBackup(file: File): Promise<{ books: number; notes: number; skipped: number }> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  if (!files['backup.json']) throw new Error('这不是听书的备份文件')
  const manifest = JSON.parse(strFromU8(files['backup.json'])) as BackupManifest
  if (manifest.app !== 'tingshu') throw new Error('这不是听书的备份文件')

  const localBooks = await db.listBooks()
  const existing = new Map(localBooks.map(b => [b.id, b]))
  // 备份里的书 id → 本机对应的书 id（重新导入的同一本书 id 不同，按文件名+大小或书名+字数匹配）
  const idMap = new Map<string, string>()
  const findLocal = (meta: BackupManifest['books'][number]) =>
    existing.get(meta.id) ??
    localBooks.find(b => b.fileName === meta.fileName && b.fileSize === meta.fileSize) ??
    localBooks.find(b => b.title === meta.title && b.totalChars === meta.totalChars)
  let books = 0
  let skipped = 0
  const progressUpdated: string[] = []
  // 同一本书重新导入后，段落划分可能不同：按书 id 记下本机的正文，用来换算位置
  const remapped = new Map<string, Book>()
  for (const meta of manifest.books) {
    const cover = files[`covers/${meta.id}`]
    const contentFile = files[`contents/${meta.id}.json`]
    const current = findLocal(meta)
    if (current) {
      idMap.set(meta.id, current.id)
      // 本机这本还在文字识别中：正文不完整，无法按比例换算位置，保留本机进度
      const partial = !!current.ocr && current.ocr.status !== 'done' && current.id !== meta.id
      if (partial) {
        books++
        continue
      }
      let local: Book | null = null
      if (current.id !== meta.id) {
        const content = await db.getContent(current.id)
        if (content) {
          local = new Book(content)
          remapped.set(current.id, local)
        }
      }
      // 已有这本书：保留较新的阅读进度
      if ((meta.lastReadAt ?? 0) > (current.lastReadAt ?? 0)) {
        const pos = local ? local.posAtPercent(meta.percent) : meta.pos
        await db.updateBook(current.id, {
          pos,
          percent: meta.percent,
          chapter: meta.chapter,
          lastReadAt: meta.lastReadAt,
          rate: meta.rate,
          voice: meta.voice,
          finished: meta.finished,
        })
        progressUpdated.push(current.id)
      }
      books++
      continue
    }
    if (!contentFile) {
      skipped++
      continue
    }
    const content = JSON.parse(strFromU8(contentFile)) as BookContent
    const full: BookMeta = { ...meta, cover: cover ? cover.slice().buffer : null }
    // 备份时还没识别完的书：原始 PDF 不在备份里，已识别的部分可以听，剩下的要重新导入
    if (full.ocr && full.ocr.status !== 'done') {
      full.ocr = { ...full.ocr, status: 'error', error: '原始 PDF 不在本机，请重新导入以继续识别' }
    }
    await db.saveBook(full, content)
    idMap.set(meta.id, meta.id)
    books++
  }

  const types = new Map(manifest.audio.map(a => [a.id, a.type]))
  let notes = 0
  for (const original of manifest.notes) {
    const bookId = idMap.get(original.bookId)
    if (!bookId) continue
    const note: Note = { ...original, bookId }
    const local = remapped.get(bookId)
    if (local) Object.assign(note, relocate(local, note))
    // 本机上更新过的笔记不被旧备份覆盖
    const current = await db.getNote(note.id)
    if (current && current.updatedAt >= note.updatedAt) continue
    if (note.audioId && files[`audio/${note.audioId}`]) {
      await db.saveAudio({ id: note.audioId, data: files[`audio/${note.audioId}`].slice().buffer, type: types.get(note.audioId) ?? 'audio/mp4' })
    }
    if (current?.audioId && current.audioId !== note.audioId) await db.deleteAudio(current.audioId)
    await db.saveNote(note)
    notes++
  }
  await refreshLibrary()
  // 正在打开的书如果恢复了更新的进度，让播放器也跳过去（不再重新保存）
  const loaded = player.meta
  if (loaded && progressUpdated.includes(loaded.id) && player.state.status !== 'playing') {
    const fresh = await db.getBook(loaded.id)
    if (fresh) player.reloadMeta(fresh)
  }
  return { books, notes, skipped }
}
