import { describe, expect, it } from 'vitest'
import { Book, BookBuilder, finalizeBook, type BookContent } from '../src/core/book'
import { speechText } from '../src/core/text'
import { createSource } from '../src/player'
import { appendPage } from '../src/ocr/runner'
import { assignParagraphs, splitFootnotes, type OcrLine } from '../src/ocr/layout'
import { ocrTextToParagraphs } from '../src/ocr/text'
import { linesToText } from '../src/ocr/layout'
import { notesToText, splitTrailingNotes, stripNoteRefs } from '../src/parsers/notes'
import { linesToParagraphs } from '../src/parsers/pdf'
import page from './fixtures/ocr-footnotes.json'

describe('note numbers in the text', () => {
  it('are not read aloud', () => {
    expect(stripNoteRefs('村秋旱伤稼”〔7〕。崞县')).toBe('村秋旱伤稼”。崞县')
    // 识别时括号常认错一半
    expect(stripNoteRefs('村秋旱伤稼”[7）。')).toBe('村秋旱伤稼”。')
    expect(stripNoteRefs('见于记载[3,4]，又')).toBe('见于记载，又')
    expect(stripNoteRefs('饥民遍野①，饿殍载道²。')).toBe('饥民遍野，饿殍载道。')
    expect(stripNoteRefs('as noted.³ Then')).toBe('as noted. Then')
  })
  it('keeps enumerations and ordinary numbers', () => {
    expect(stripNoteRefs('分为三类：（1）农业；（2）手工业')).toBe('分为三类：（1）农业；（2）手工业')
    expect(stripNoteRefs('包括：①农业；②手工业')).toBe('包括：①农业；②手工业')
    expect(stripNoteRefs('〔1〕民国《临县志》')).toBe('〔1〕民国《临县志》')
    expect(stripNoteRefs('光绪三年（1877）大旱')).toBe('光绪三年（1877）大旱')
    expect(stripNoteRefs('面积 25 km²')).toBe('面积 25 km²')
  })
  it('are read when the reader wants notes', () => {
    expect(speechText('伤稼”〔7〕。', true)).toBe('伤稼”。')
    expect(speechText('伤稼”〔7〕。')).toBe('伤稼”〔7〕。')
    expect(speechText('¹小草也绿了。', true)).toBe('小草也绿了。')
  })
})

describe('footnotes at the bottom of a scanned page', () => {
  const lines = page.lines as OcrLine[]
  it('are separated from the body (real PaddleOCR result)', () => {
    const { body, notes } = splitFootnotes(lines, page.pageHeight)
    expect(body.map(l => l.text.slice(0, 4))).toEqual(['村秋旱伤', '不同程度', '说，也是', '的霜灾明', '光绪三年'])
    const items = ocrTextToParagraphs(notesToText(notes))
    expect(items).toHaveLength(7)
    expect(items[5]).toContain('转引自中国气象灾害大典山')
    expect(items[5]).toContain('气象出版社2005年版')
    // 正文重新分段：段落里的换行不再被当成新的一段
    expect(ocrTextToParagraphs(linesToText(body))).toHaveLength(2)
  })
  it('leaves pages without footnotes alone', () => {
    const body = lines.slice(0, 5)
    expect(splitFootnotes(body, page.pageHeight).body).toBe(body)
    // 小一号的引文、没有编号：不是脚注
    const quote = lines.slice(5).map(l => ({ ...l, text: l.text.replace(/^\S{1,3}[〕\]}）)]\s*/, '') }))
    expect(splitFootnotes([...body, ...quote], page.pageHeight).notes).toEqual([])
  })
  it('does not mistake a chapter opening for footnotes', () => {
    const title: OcrLine = { text: '第二章 赈灾', para: 0, x0: 500, y0: 900, x1: 900, y1: 980 }
    const body = assignParagraphs(
      [1100, 1180, 1260, 1340].map(y => ({ text: '1. 光绪三年灾荒达到顶峰之后，粮食普遍歉收、绝收，各地粮价普遍', x0: 115, y0: y, x1: 1500, y1: y + 42 })),
    )
    expect(splitFootnotes([title, ...body], 2205).notes).toEqual([])
  })
})

describe('footnotes from cloud OCR (text only)', () => {
  it('are split off when the body refers to them', () => {
    const paras = ['伤稼”〔7〕。崞县夏旱。', '光绪三年灾荒达到顶峰之后，各地粮价普遍', '〔6〕民国二十五年稿本《大同县志》，转引自', '象大典山西省卷》。', '〔7〕光绪《代州志》。']
    expect(splitTrailingNotes(paras)).toEqual({ body: paras.slice(0, 2), notes: paras.slice(2) })
  })
  it('keeps numbered paragraphs that nothing refers to', () => {
    const paras = ['下面分三点说明。', '①农业歉收。', '②粮价高涨。']
    expect(splitTrailingNotes(paras).notes).toEqual([])
  })
})

describe('footnotes in text PDFs', () => {
  const line = (text: string, y: number, size = 10.5, right = 400) => ({ text, x: 50, right, y, size })
  it('become note paragraphs after the paragraph that crosses the page', () => {
    const body = (y: number) => line('正文内容正文内容正文内容正文内容正文内容正文内容正文内容', y)
    const page1 = [
      body(700),
      body(680),
      line('光绪三年灾荒达到顶峰之后，粮食普遍歉收、绝收，各地粮价普遍', 660),
      line('〔1〕民国《临县志》，卷十七，荒年记。', 120, 9, 300),
      line('〔2〕民国二十五年稿本《大同县志》，转引自中国气象灾害大典', 100, 9),
      line('山西省卷。', 85, 9, 120),
    ]
    const page2 = [line('高涨，饥民遍野，饿殍载道。', 700, 10.5, 200), body(680)]
    const builder = new BookBuilder()
    linesToParagraphs([page1, page2], builder)
    const notes = builder.notes.map(i => builder.blocks[i])
    expect(notes).toEqual(['〔1〕民国《临县志》，卷十七，荒年记。', '〔2〕民国二十五年稿本《大同县志》，转引自中国气象灾害大典山西省卷。'])
    const joined = builder.blocks.findIndex(b => b.includes('普遍高涨'))
    expect(joined).toBeGreaterThan(-1)
    expect(builder.notes[0]).toBe(joined + 1)
  })
  it('a page that is all small print (an endnotes page) stays as it is', () => {
    const builder = new BookBuilder()
    linesToParagraphs([[line('注释', 700, 12, 100), line('1. 民国《临县志》，卷十七，荒年记。', 680, 9), line('2. 光绪《太谷县志》。', 660, 9)]], builder)
    expect(builder.notes).toEqual([])
  })
})

describe('listening skips footnotes', () => {
  const parsed = {
    title: 'T',
    author: '',
    lang: 'zh',
    blocks: ['村秋旱伤稼”〔1〕。天镇有旱。', '〔1〕光绪《代州志》卷十二。', '光绪三年灾荒达到顶峰。'],
    heads: {},
    notes: [1],
    toc: [],
  }
  it('skips note paragraphs and note numbers, unless asked to read them', () => {
    const book = new Book(finalizeBook('b', parsed))
    const read = () => {
      const src = createSource(book, { b: 0, o: 0 }, 1000, () => null)
      const out: string[] = []
      for (let seg = src.next(); seg; seg = src.next()) out.push(...seg.sentences.map(s => s.text))
      return out
    }
    expect(read()).toEqual(['村秋旱伤稼”。', '天镇有旱。', '光绪三年灾荒达到顶峰。'])
    expect(book.next({ b: 0, o: book.sentences(0)[1].o })).toEqual({ b: 2, o: 0 })
    expect(book.prev({ b: 2, o: 0 })).toEqual({ b: 0, o: book.sentences(0)[1].o })
    // 点了脚注开始播放：从后面的正文开始
    expect(book.speakableFrom({ b: 1, o: 0 })).toEqual({ b: 2, o: 0 })
    book.skipNotes = false
    expect(read()).toContain('〔1〕光绪《代州志》卷十二。')
    expect(read()[0]).toBe('村秋旱伤稼”〔1〕。')
  })
  it('a sentence continued on the next scanned page joins the paragraph before the notes', () => {
    const content: BookContent = { id: 'b', blocks: [], heads: {}, toc: [], sections: [], pages: [] }
    appendPage(content, 0, ['光绪三年灾荒达到顶峰之后，粮食普遍歉收、绝收，各地粮价普遍'], [], true, ['〔1〕民国《临县志》。'])
    const book = new Book({ ...content, blocks: content.blocks.slice(), notes: content.notes?.slice() })
    expect(book.sentences(0)).toHaveLength(1)
    appendPage(content, 1, ['高涨，饥民遍野。', '除此而外。'])
    expect(content.blocks).toEqual(['光绪三年灾荒达到顶峰之后，粮食普遍歉收、绝收，各地粮价普遍高涨，饥民遍野。', '〔1〕民国《临县志》。', '除此而外。'])
    expect(content.notes).toEqual([1])
    expect(content.pages).toEqual([0, 2])
    book.replace({ ...content, blocks: content.blocks.slice(), notes: content.notes?.slice() })
    // 接上去的那一段重新分句、重新计算字数
    expect(book.sentenceText({ b: 0, o: 0 })).toContain('高涨，饥民遍野。')
    expect(book.totalChars).toBe(content.blocks.join('').length)
  })
})
