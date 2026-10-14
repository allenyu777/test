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
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<Schema>('tingshu', 1, {
      upgrade(database) {
        database.createObjectStore('books', { keyPath: 'id' })
        database.createObjectStore('contents', { keyPath: 'id' })
        const notes = database.createObjectStore('notes', { keyPath: 'id' })
        notes.createIndex('bookId', 'bookId')
        database.createObjectStore('audio', { keyPath: 'id' })
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

export async function updateBook(id: string, patch: Partial<BookMeta>) {
  const d = await db()
  const tx = d.transaction('books', 'readwrite')
  const current = await tx.store.get(id)
  if (current) await tx.store.put({ ...current, ...patch })
  await tx.done
}

export async function getContent(id: string) {
  return (await db()).get('contents', id)
}

export async function deleteBook(id: string) {
  const d = await db()
  const notes = await d.getAllFromIndex('notes', 'bookId', id)
  const tx = d.transaction(['books', 'contents', 'notes', 'audio'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('contents').delete(id)
  for (const n of notes) {
    await tx.objectStore('notes').delete(n.id)
    if (n.audioId) await tx.objectStore('audio').delete(n.audioId)
  }
  await tx.done
}

export async function listNotes(bookId: string): Promise<Note[]> {
  const notes = await (await db()).getAllFromIndex('notes', 'bookId', bookId)
  return notes.sort((a, b) => a.b - b.b || a.o - b.o || a.createdAt - b.createdAt)
}

export async function listAllNotes(): Promise<Note[]> {
  return (await db()).getAll('notes')
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
