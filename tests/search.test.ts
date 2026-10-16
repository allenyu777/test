import { describe, expect, it } from 'vitest'
import { searchBook, snippet } from '../src/core/search'

describe('full-book search', () => {
  const blocks = ['光绪三年，山西大旱。光绪四年又旱。', '《申报》1878年5月29日载。', 'The River Mill, by Jane DOE.', '第二章 光绪初年的灾荒图景']
  it('finds every occurrence in order', () => {
    expect(searchBook(blocks, '光绪')).toEqual([
      { b: 0, start: 0, end: 2 },
      { b: 0, start: 10, end: 12 },
      { b: 3, start: 4, end: 6 },
    ])
  })
  it('ignores case and full-width letters and digits, and surrounding spaces', () => {
    expect(searchBook(blocks, ' river mill ')).toEqual([{ b: 2, start: 4, end: 14 }])
    expect(searchBook(blocks, 'doe')).toHaveLength(1)
    expect(searchBook(blocks, '１８７８')).toEqual([{ b: 1, start: 4, end: 8 }])
    expect(searchBook(['ＡＢＣ公司'], 'abc')).toEqual([{ b: 0, start: 0, end: 3 }])
  })
  it('limits the number of results and handles empty queries', () => {
    expect(searchBook(['旱'.repeat(500)], '旱', 300)).toHaveLength(300)
    expect(searchBook(blocks, '   ')).toEqual([])
    expect(searchBook(blocks, '洪水')).toEqual([])
  })
  it('shows a little context around the match', () => {
    const text = '一二三四五六七八九十'.repeat(6) + '丁戊奇荒' + '甲乙丙丁戊己庚辛壬癸'.repeat(6)
    const [hit] = searchBook([text], '丁戊奇荒')
    const s = snippet(text, hit)
    expect(s.match).toBe('丁戊奇荒')
    expect(s.pre.startsWith('…')).toBe(true)
    expect(s.pre.length).toBe(17)
    expect(s.post.endsWith('…')).toBe(true)
    expect(snippet('丁戊奇荒', { b: 0, start: 0, end: 4 })).toEqual({ pre: '', match: '丁戊奇荒', post: '' })
  })
})
