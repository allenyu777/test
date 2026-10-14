// IndexedDB 存储：书籍信息、正文、笔记、语音笔记音频
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { BookContent, Pos } from './core/book'
import type { VoiceChoice } from './settings'

export interface BookMeta {
  id: string
  title: string
  author: string
  lang: string
  format: string
  fileName: string
  fileSize: number
  addedAt: number
  lastReadAt: number
  totalChars: number
  pos: Pos
  percent: number
  chapter: string
  cover?: ArrayBuffer | null
  coverType?: string
  voice?: VoiceChoice | null
  rate?: number | null
  finished?: boolean
  /** 扫描版 PDF 的文字识别进度 */
  ocr?: OcrInfo | null
  /** 每一章上次读到的位置（按章节开头的段落号记），跳到别的章节再回来时接着读 */
  chapterPos?: Record<string, ChapterMark>
}

export interface ChapterMark {
  b: number
  o: number
  /** 记下的时间 */
  t: number
  /** 从这个时间起暂时保留这个位置（位置往回移动时，见 Player.rememberChapter） */
  h?: number
}

export type OcrEngine = 'local' | 'cloud'
export type OcrLang = 'chi_sim' | 'chi_tra' | 'eng' | 'chi_sim+eng'

export interface OcrInfo {
  pages: number
  done: number
  engine: OcrEngine
  lang: OcrLang
  status: 'running' | 'paused' | 'done' | 'error'
  error?: string
  /** 最近几页（新的在前）页首页尾的短行，用来认出页眉 */
  edges?: string[][]
}

/** 原始文件（扫描版 PDF 识别过程中需要） */
export interface FileRecord {
  id: string
  data: ArrayBuffer
  type: string
  name: string
}

export interface Note {
  id: string
  bookId: string
  b: number
  o: number
  quote: string
  text: string
  chapter: string
  createdAt: number
  updatedAt: number
  audioId?: string
  audioType?: string
  audioDuration?: number
}

export interface AudioRecord {
  id: string
  data: ArrayBuffer
  type: string
}

interface Schema extends DBSchema {
  books: { key: string; value: BookMeta }
  contents: { key: string; value: BookContent }
  notes: { key: string; value: Note; indexes: { bookId: string } }
  audio: { key: string; value: AudioRecord }
  files: { key: string; value: FileRecord }
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>('tingshu', 2, {
      // iOS 在后台可能关闭数据库连接；下次使用时重新打开
      terminated() {
        dbPromise = null
      },
      blocking() {
        dbPromise?.then(d => d.close())
        dbPromise = null
      },
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore('books', { keyPath: 'id' })
          database.createObjectStore('contents', { keyPath: 'id' })
          const notes = database.createObjectStore('notes', { keyPath: 'id' })
          notes.createIndex('bookId', 'bookId')
          database.createObjectStore('audio', { keyPath: 'id' })
        }
        if (oldVersion < 2) database.createObjectStore('files', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

export async function listBooks(): Promise<BookMeta[]> {
  return (await db()).getAll('books')
}

export async function getBook(id: string) {
  return (await db()).get('books', id)
}

export async function saveBook(meta: BookMeta, content?: BookContent) {
  const d = await db()
  const tx = d.transaction(content ? ['books', 'contents'] : ['books'], 'readwrite')
  await tx.objectStore('books').put(meta)
  if (content) await tx.objectStore('contents').put(content)
  await tx.done
}

async function writeBookPatch(id: string, patch: Partial<BookMeta>) {
  const d = await db()
  const tx = d.transaction('books', 'readwrite')
  const current = await tx.store.get(id)
  if (current) await tx.store.put({ ...current, ...patch })
  await tx.done
}

/** 写入数据库；iOS 在后台关掉连接后第一次写入会失败，这时重新打开数据库再试一次（失败的事务什么都不会写入） */
async function retryStale<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    const name = (e as DOMException)?.name
    if (name !== 'InvalidStateError' && name !== 'UnknownError' && name !== 'TransactionInactiveError') throw e
    dbPromise = null
    return op()
  }
}

/** 更新书籍信息（进度保存很频繁） */
export async function updateBook(id: string, patch: Partial<BookMeta>) {
  await retryStale(() => writeBookPatch(id, patch))
}

export async function saveContent(content: BookContent) {
  await (await db()).put('contents', content)
}

export async function getContent(id: string) {
  return (await db()).get('contents', id)
}

export async function deleteBook(id: string) {
  const d = await db()
  const notes = await d.getAllFromIndex('notes', 'bookId', id)
  const tx = d.transaction(['books', 'contents', 'notes', 'audio', 'files'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('contents').delete(id)
  await tx.objectStore('files').delete(id)
  for (const n of notes) {
    await tx.objectStore('notes').delete(n.id)
    if (n.audioId) await tx.objectStore('audio').delete(n.audioId)
  }
  await tx.done
}

/**
 * 保存一页识别结果：正文和书籍信息在同一个事务里写入。
 * 书已被删除时什么都不写，返回 null；用户在识别途中点了暂停时保留暂停状态。
 */
export async function saveOcrProgress(
  id: string,
  content: BookContent,
  patch: Partial<BookMeta>,
  /** 还没有当前章节时用这个（不覆盖播放器记下的章节） */
  defaultChapter?: string,
): Promise<BookMeta | null> {
  return retryStale(() => writeOcrProgress(id, content, patch, defaultChapter))
}

async function writeOcrProgress(id: string, content: BookContent, patch: Partial<BookMeta>, defaultChapter?: string) {
  const d = await db()
  const tx = d.transaction(['books', 'contents'], 'readwrite')
  const books = tx.objectStore('books')
  const current = await books.get(id)
  if (!current) {
    await tx.done
    return null
  }
  let ocr = patch.ocr ?? current.ocr
  if (ocr && current.ocr?.status === 'paused' && ocr.status === 'running') ocr = { ...ocr, status: 'paused' }
  const next: BookMeta = { ...current, ...patch, ocr }
  if (!next.chapter && defaultChapter) next.chapter = defaultChapter
  await books.put(next)
  await tx.objectStore('contents').put(content)
  await tx.done
  return next
}

/** 只改识别状态（在事务里与最新的记录合并） */
export function patchOcr(id: string, patch: Partial<OcrInfo>): Promise<OcrInfo | null> {
  return retryStale(() => writeOcrPatch(id, patch))
}

async function writeOcrPatch(id: string, patch: Partial<OcrInfo>): Promise<OcrInfo | null> {
  const d = await db()
  const tx = d.transaction('books', 'readwrite')
  const current = await tx.store.get(id)
  if (!current?.ocr) {
    await tx.done
    return null
  }
  const ocr = { ...current.ocr, ...patch }
  await tx.store.put({ ...current, ocr })
  await tx.done
  return ocr
}

export async function saveFile(record: FileRecord) {
  await (await db()).put('files', record)
}

export async function getFile(id: string) {
  return (await db()).get('files', id)
}

export async function deleteFile(id: string) {
  await (await db()).delete('files', id)
}

export async function listNotes(bookId: string): Promise<Note[]> {
  const notes = await (await db()).getAllFromIndex('notes', 'bookId', bookId)
  return notes.sort((a, b) => a.b - b.b || a.o - b.o || a.createdAt - b.createdAt)
}

export async function listAllNotes(): Promise<Note[]> {
  return (await db()).getAll('notes')
}

export async function getNote(id: string) {
  return (await db()).get('notes', id)
}

export async function saveNote(note: Note) {
  await (await db()).put('notes', note)
}

export async function deleteNote(note: Note) {
  const d = await db()
  const tx = d.transaction(['notes', 'audio'], 'readwrite')
  await tx.objectStore('notes').delete(note.id)
  if (note.audioId) await tx.objectStore('audio').delete(note.audioId)
  await tx.done
}

export async function saveAudio(record: AudioRecord) {
  await (await db()).put('audio', record)
}

export async function getAudio(id: string) {
  return (await db()).get('audio', id)
}

export async function deleteAudio(id: string) {
  await (await db()).delete('audio', id)
}

export async function listAudio(): Promise<AudioRecord[]> {
  return (await db()).getAll('audio')
}

export async function listContents(): Promise<BookContent[]> {
  return (await db()).getAll('contents')
}

/** 申请持久化存储，避免 iOS 在空间紧张时清理数据 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    return est ? { usage: est.usage ?? 0, quota: est.quota ?? 0 } : null
  } catch {
    return null
  }
}
