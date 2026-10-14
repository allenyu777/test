import { describe, expect, it } from 'vitest'
import { Book, type BookContent } from '../src/core/book'
import { createSource } from '../src/player'

const book = (blocks: string[]): Book =>
  new Book({ id: 'x', blocks, heads: {}, toc: [{ title: '第一章', b: 0, level: 0 }], sections: [{ title: '第一章', start: 0, end: blocks.length }], pages: [] } as BookContent)

describe('segment source', () => {
  it('remembers the last sentence it passed, including ones that cannot be spoken', () => {
    const b = book(['第一段文字。', '参考：https://example.com/a/b'])
    const source = createSource(b, { b: 0, o: 0 }, 0, () => null)
    const texts: string[] = []
    for (let seg = source.next(); seg; seg = source.next()) texts.push(seg.text)
    expect(texts.join('')).not.toContain('example.com')
    // 续读位置在最后一句之后（不会回到已读过的句子）
    expect(source.last).not.toBeNull()
    expect(b.next(source.last!.pos)).toBeNull()
  })
  it('stops before the chapter limit', () => {
    const b = book(['一。', '二。', '三。'])
    const source = createSource(b, { b: 0, o: 0 }, 0, () => 2)
    const texts: string[] = []
    for (let seg = source.next(); seg; seg = source.next()) texts.push(seg.text)
    expect(texts).toEqual(['一。', '二。'])
    expect(source.last?.pos.b).toBe(1)
  })
})
