import { describe, expect, it } from 'vitest'
import { Book, finalizeBook } from '../src/core/book'
import { bookNotesMarkdown, bookNotesText } from '../src/notes/export'
import { markNumber, NOTE_REF, noteNumber } from '../src/parsers/notes'
import { addListening, dayKey, formatListen, listenStats, mergeStats, summarize, trackListening } from '../src/stats'
import { createStore } from '../src/store'
import type { BookMeta, Note } from '../src/db'

describe('tapping a note number', () => {
  it('reads the number of a reference and of a note', () => {
    expect(['〔7〕', '[ 7]', '[7）', '⑦', '⁷', '¹²'].map(markNumber)).toEqual([7, 7, 7, 7, 7, 12])
    expect(['〔1〕民国《临县志》', '[ 1] "Report by', '② 光绪', '¹ Smith', '12. 同上', '注3 同上', '1878年大旱'].map(noteNumber)).toEqual([1, 1, 2, 1, 12, 3, null])
    expect([...'伤稼”〔7〕。饥民①，饿殍²。'.matchAll(NOTE_REF)].map(m => m[0])).toEqual(['〔7〕', '①', '²'])
  })
  it('finds the note with the same number after the paragraph, else before', () => {
    const content = finalizeBook('b', {
      title: 'T',
      author: '',
      lang: 'zh',
      blocks: ['正文〔1〕。', '〔1〕旧的注释。', '正文〔1〕又一处〔2〕。', '〔1〕民国《临县志》。', '〔2〕光绪《代州志》。', '正文〔3〕。'],
      heads: {},
      notes: [1, 3, 4],
      toc: [],
    })
    const book = new Book(content)
    expect(book.findNote(2, 1)).toBe(3)
    expect(book.findNote(2, 2)).toBe(4)
    expect(book.findNote(5, 2)).toBe(4)
    expect(book.findNote(5, 3)).toBe(-1)
  })
})

describe('highlights and bookmarks in exports', () => {
  const book = { title: '丁戊奇荒', author: '郝平' } as BookMeta
  const base = { bookId: 'b', b: 0, o: 0, chapter: '第一章', createdAt: 0, updatedAt: 0, text: '' }
  const notes: Note[] = [
    { ...base, id: '1', quote: '饥民遍野，饿殍载道。', kind: 'highlight' },
    { ...base, id: '2', quote: '光绪三年灾荒达到顶峰。', kind: 'bookmark' },
    { ...base, id: '3', quote: '人命不如鸡犬。', text: '触目惊心' },
  ]
  it('markdown', () => {
    const md = bookNotesMarkdown(book, notes)
    expect(md).toContain('> 饥民遍野，饿殍载道。')
    expect(md).toContain('*划线 · ')
    expect(md).toContain('🔖 书签：光绪三年灾荒达到顶峰。')
    expect(md).toContain('触目惊心')
  })
  it('plain text', () => {
    const txt = bookNotesText(book, notes)
    expect(txt).toContain('🔖 书签：光绪三年灾荒达到顶峰。')
    expect(txt).toContain('—— 划线 · ')
  })
})

describe('listening stats', () => {
  it('summarizes today, the week and the streak', () => {
    const now = new Date(2026, 9, 16, 21)
    const day = (offset: number) => dayKey(new Date(2026, 9, 16 - offset))
    const stats = { days: { [day(0)]: 1500, [day(1)]: 600, [day(2)]: 3600, [day(4)]: 900, [day(9)]: 7200 }, books: {} }
    const sum = summarize(stats, now)
    expect(sum.today).toBe(1500)
    expect(sum.week).toBe(1500 + 600 + 3600 + 900)
    expect(sum.total).toBe(1500 + 600 + 3600 + 900 + 7200)
    expect(sum.streak).toBe(3)
    expect(sum.last7.map(d => d.seconds)).toEqual([0, 0, 900, 0, 3600, 600, 1500])
    expect(sum.last7[6].label).toBe('今天')
    // 今天还没听：从昨天算起
    expect(summarize({ days: { [day(1)]: 600, [day(2)]: 600 }, books: {} }, now).streak).toBe(2)
  })
  it('formats durations', () => {
    expect(formatListen(59)).toBe('0 分钟')
    expect(formatListen(23 * 60)).toBe('23 分钟')
    expect(formatListen(3600)).toBe('1 小时')
    expect(formatListen(3900)).toBe('1 小时 5 分')
  })
  it('counts only playing time, per book', () => {
    listenStats.set({ days: {}, books: {} })
    let t = 1_000_000
    const realNow = Date.now
    Date.now = () => t
    try {
      const store = createStore({ status: 'idle', bookId: 'a' as string | null })
      trackListening(store)
      store.set({ status: 'playing' })
      t += 90_000
      store.set({ status: 'paused' })
      t += 600_000
      store.set({ status: 'playing', bookId: 'b' })
      t += 30_000
      store.set({ status: 'idle' })
    } finally {
      Date.now = realNow
    }
    expect(listenStats.get().books).toEqual({ a: 90, b: 30 })
    expect(Object.values(listenStats.get().days).reduce((x, y) => x + y, 0)).toBe(120)
  })
  it('restoring a backup twice does not double the time', () => {
    listenStats.set({ days: { '2026-10-15': 100 }, books: { a: 100 } })
    const backup = { days: { '2026-10-15': 300, '2026-10-14': 50 }, books: { old: 300 } }
    mergeStats(backup, id => (id === 'old' ? 'a' : undefined))
    mergeStats(backup, id => (id === 'old' ? 'a' : undefined))
    expect(listenStats.get()).toEqual({ days: { '2026-10-15': 300, '2026-10-14': 50 }, books: { a: 300 } })
    addListening('a', 10, new Date(2026, 9, 14))
    expect(listenStats.get().days['2026-10-14']).toBe(60)
  })
})
