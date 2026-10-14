import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Book, buildSections, type BookContent, type TocEntry } from '../src/core/book'
import type { BookMeta } from '../src/db'

vi.mock('../src/db', async importOriginal => ({ ...(await importOriginal<typeof import('../src/db')>()), updateBook: async () => {} }))

const { player } = await import('../src/player')

// 第一章 0-9，第二卷（只有卷名）10，第二章 11-30，第三章 31-40
function makeBook(): { meta: BookMeta; book: Book } {
  const blocks: string[] = []
  const toc: TocEntry[] = []
  const chapter = (title: string, n: number, level = 1) => {
    toc.push({ title, b: blocks.length, level })
    blocks.push(title)
    for (let i = 1; i < n; i++) blocks.push(`${title}第${i}段。这里是正文。`)
  }
  chapter('第一章', 10)
  chapter('第二卷', 1, 0)
  chapter('第二章', 20)
  chapter('第三章', 10)
  const content: BookContent = { id: 'x', blocks, heads: {}, toc, sections: buildSections(blocks, toc) }
  const meta = { id: 'x', title: '测试', author: '', lang: 'zh', format: 'txt', fileName: 'x.txt', fileSize: 1, addedAt: 1, lastReadAt: 0, totalChars: 1, pos: { b: 0, o: 0 }, percent: 0, chapter: '' } as BookMeta
  return { meta, book: new Book(content) }
}

// 连续朗读读到某一句（引擎报告的位置）
const playTo = (b: number) => (player as any).onSentence((player as any).engine, { b, o: 0 })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  const { meta, book } = makeBook()
  player.close()
  player.open(meta, book)
})
afterEach(() => vi.useRealTimers())

describe('chapter memory', () => {
  it('returns to the place in a chapter after jumping to another one', () => {
    player.seek({ b: 20, o: 0 }, false)
    player.seek({ b: 35, o: 0 }, false)
    expect(player.chapterTarget(11)).toMatchObject({ pos: { b: 20, o: 0 }, resumed: true })
  })

  it('keeps the place when a mis-tapped volume title plays on into the chapter', () => {
    player.seek({ b: 20, o: 0 }, false)
    player.seek({ b: 10, o: 0 }, false)
    vi.advanceTimersByTime(5000)
    playTo(11)
    playTo(12)
    expect(player.chapterTarget(11)).toMatchObject({ pos: { b: 20, o: 0 }, resumed: true })
  })

  it('keeps the place after 上一章 twice and 下一章', () => {
    player.seek({ b: 20, o: 0 }, false)
    player.skipChapter(-1)
    player.skipChapter(-1)
    expect(player.state.pos.b).toBe(10)
    player.skipChapter(1)
    expect(player.state.pos).toEqual({ b: 20, o: 0 })
  })

  it('follows a real re-listen after a while', () => {
    player.seek({ b: 20, o: 0 }, false)
    player.seek({ b: 11, o: 0 }, false)
    vi.advanceTimersByTime(100_000)
    playTo(16)
    expect(player.chapterResume(11)).toEqual({ b: 16, o: 0 })
  })

  it('forgets a chapter that was listened through', () => {
    player.seek({ b: 5, o: 0 }, false)
    playTo(9)
    playTo(10)
    expect(player.chapterResume(0)).toBeNull()
    expect(player.chapterTarget(0)).toMatchObject({ pos: { b: 0, o: 0 }, resumed: false })
  })

  it('forgets everything on reset', () => {
    player.seek({ b: 20, o: 0 }, false)
    player.clearChapterMarks('x')
    expect(player.chapterResume(11)).toBeNull()
  })
})
