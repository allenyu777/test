// 备份与恢复：书籍、进度、笔记、录音打包成一个 ZIP，可在换手机/换浏览器时迁移
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { BookContent } from './core/book'
import * as db from './db'
import type { BookMeta, Note } from './db'
import { formatDate } from './notes/export'
import { refreshLibrary } from './library'

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

export async function restoreBackup(file: File): Promise<{ books: number; notes: number; skipped: number }> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()))
  if (!files['backup.json']) throw new Error('这不是听书的备份文件')
  const manifest = JSON.parse(strFromU8(files['backup.json'])) as BackupManifest
  if (manifest.app !== 'tingshu') throw new Error('这不是听书的备份文件')

  const existing = new Map((await db.listBooks()).map(b => [b.id, b]))
  const restored = new Set(existing.keys())
  let books = 0
  let skipped = 0
  for (const meta of manifest.books) {
    const cover = files[`covers/${meta.id}`]
    const contentFile = files[`contents/${meta.id}.json`]
    const current = existing.get(meta.id)
    if (current) {
      // 已有这本书：保留较新的阅读进度
      if ((meta.lastReadAt ?? 0) > (current.lastReadAt ?? 0)) {
        await db.updateBook(meta.id, { pos: meta.pos, percent: meta.percent, chapter: meta.chapter, lastReadAt: meta.lastReadAt, rate: meta.rate, voice: meta.voice })
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
    await db.saveBook(full, content)
    restored.add(meta.id)
    books++
  }

  const types = new Map(manifest.audio.map(a => [a.id, a.type]))
  let notes = 0
  for (const note of manifest.notes) {
    if (!restored.has(note.bookId)) continue
    if (note.audioId && files[`audio/${note.audioId}`]) {
      await db.saveAudio({ id: note.audioId, data: files[`audio/${note.audioId}`].slice().buffer, type: types.get(note.audioId) ?? 'audio/mp4' })
    }
    await db.saveNote(note)
    notes++
  }
  await refreshLibrary()
  return { books, notes, skipped }
}
