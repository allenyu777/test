import { describe, expect, it } from 'vitest'
import { Book, finalizeBook } from '../src/core/book'
import { isTitleBlock, placeToc } from '../src/core/tocplace'
import { rebuildOcrContent } from '../src/ocr/runner'
import type { BookContent } from '../src/core/book'

describe('placing contents entries on their headings', () => {
  it('matches headings despite spaces, punctuation and an OCR slip', () => {
    expect(isTitleBlock('第一节 知难而退鲍源深', '第一节 知难而退鲍源深')).toBe(true)
    expect(isTitleBlock('第一节知难而退鮑源深', '第一节 知难而退鲍源深')).toBe(true)
    expect(isTitleBlock('绪 论', '绪论')).toBe(true)
    expect(isTitleBlock('第一节 知难而退鲍源深。山西巡抚鲍源深已年逾六旬，内外交迫。', '第一节 知难而退鲍源深')).toBe(false)
    expect(isTitleBlock('第二节 因灾蒙冤林寿图', '第一节 知难而退鲍源深')).toBe(false)
  })

  // 书签只有页码：第三章和它的第一节都指到页首
  const blocks = [
    '……鼠患更是雪上加霜。',
    '第三章 高层官员与灾荒救济',
    '面对如此重大的灾情，主要官员的态度和认识以及所采取紧急应对的措施，对于减轻灾荒影响具有重要意义。',
    '曾国荃上下沟通，左右应对，调动各方力量。',
    '第一节知难而退鮑源深',
    '鲍源深于光绪元年出任山西巡抚。',
  ]
  const toc = [
    { title: '第三节 多灾并发：瘟疫、狼灾、鼠患', b: 0, level: 1 },
    { title: '第三章 高层官员与灾荒救济', b: 1, level: 0 },
    { title: '第一节 知难而退鲍源深', b: 1, level: 1 },
  ]
  it('moves an entry from the top of the page to its heading', () => {
    const { toc: placed, titled } = placeToc(blocks, toc)
    expect(placed.map(t => t.b)).toEqual([0, 1, 4])
    expect([...titled.keys()]).toEqual([1, 4])
  })
  it('the chapter opening now belongs to the chapter, not to its first section', () => {
    const book = new Book(finalizeBook('b', { title: 'T', author: '', lang: 'zh', blocks, heads: {}, toc }))
    expect(book.chapterTitle(2)).toBe('第三章 高层官员与灾荒救济')
    expect(book.chapterTitle(5)).toBe('第一节 知难而退鲍源深')
    expect(book.chapterRange(2)).toEqual({ start: 1, end: 4 })
    // 找到的标题按标题样式显示
    expect(book.heads[4]).toBeGreaterThan(0)
  })
  it('fixes books imported before, when they are opened', () => {
    const old: BookContent = { id: 'b', blocks, heads: {}, toc, sections: [{ start: 0, end: blocks.length, title: '' }] }
    const book = new Book(old)
    expect(book.chapterTitle(2)).toBe('第三章 高层官员与灾荒救济')
    expect(book.toc[2].b).toBe(4)
    // 保存的内容不变
    expect(old.toc[2].b).toBe(1)
  })
  it('scanned PDFs with bookmarks', () => {
    const content: BookContent = { id: 'b', blocks: blocks.slice(), heads: {}, toc: [], sections: [], pages: [0, 1] }
    rebuildOcrContent(content, [
      { title: '第三节 多灾并发：瘟疫、狼灾、鼠患', page: 0, level: 1 },
      { title: '第三章 高层官员与灾荒救济', page: 1, level: 0 },
      { title: '第一节 知难而退鲍源深', page: 1, level: 1 },
    ])
    expect(content.toc.map(t => t.b)).toEqual([0, 1, 4])
  })
  it('leaves entries alone when no heading is found nearby', () => {
    const plain = ['正文一。', '正文二。', '正文三。']
    const entries = [
      { title: '第 1 页', b: 0, level: 0 },
      { title: '第 11 页', b: 2, level: 0 },
    ]
    expect(placeToc(plain, entries).toc).toEqual(entries)
  })
})
