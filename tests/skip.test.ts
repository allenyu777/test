import { describe, expect, it } from 'vitest'
import { Book, finalizeBook } from '../src/core/book'
import { charsForSeconds, estimateSeconds } from '../src/core/text'

// 每句 11 个字
const sentence = (n: number) => `第${String(n).padStart(2, '0')}句话说到了这里。`
const book = new Book(
  finalizeBook('b', {
    title: 'T',
    author: '',
    lang: 'zh',
    blocks: [
      [1, 2, 3, 4, 5].map(sentence).join(''),
      '〔1〕光绪《代州志》卷十二，纪三，大事记，这条注释很长很长很长很长。',
      [6, 7, 8, 9, 10].map(sentence).join(''),
    ],
    heads: {},
    notes: [1],
    toc: [],
  }),
)
const at = (n: number) => (n <= 5 ? { b: 0, o: (n - 1) * 11 } : { b: 2, o: (n - 6) * 11 })

describe('skipping by time', () => {
  it('converts seconds to characters by language and speed', () => {
    expect(charsForSeconds(15, 'zh', 1)).toBe(65)
    expect(charsForSeconds(15, 'zh', 2)).toBe(130)
    expect(estimateSeconds(charsForSeconds(10, 'en', 1.5), 'en', 1.5)).toBeCloseTo(10)
  })
  it('moves forward by enough sentences, skipping footnotes', () => {
    expect(book.sentenceText(at(1))).toBe(sentence(1))
    // 25 字：跳过第 1、2 句，落在第 3 句（累计到第 3 句结束时超过 25）
    expect(book.skipChars(at(1), 25)).toEqual(at(3))
    // 跨过脚注：脚注的字不算
    expect(book.skipChars(at(4), 25)).toEqual(at(6))
    // 至少前进一句
    expect(book.skipChars(at(1), 3)).toEqual(at(2))
    // 到书末
    expect(book.skipChars(at(9), 100)).toBeNull()
  })
  it('moves back by enough sentences, at least one, not past the start', () => {
    expect(book.skipChars(at(8), -20)).toEqual(at(6))
    expect(book.skipChars(at(7), -25)).toEqual(at(4))
    expect(book.skipChars(at(3), -1)).toEqual(at(2))
    expect(book.skipChars(at(2), -100)).toEqual(at(1))
    expect(book.skipChars(at(1), -100)).toEqual(at(1))
  })
})
