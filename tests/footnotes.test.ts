import { describe, expect, it } from 'vitest'
import { Book, BookBuilder, finalizeBook, type BookContent } from '../src/core/book'
import { speechText } from '../src/core/text'
import { createSource } from '../src/player'
import { appendPage } from '../src/ocr/runner'
import { assignParagraphs, splitFootnotes, type OcrLine } from '../src/ocr/layout'
import { ocrTextToParagraphs } from '../src/ocr/text'
import { linesToText } from '../src/ocr/layout'
import { noteRefRanges, notesToText, splitTrailingNotes, stripNoteRefs } from '../src/parsers/notes'
import { linesToParagraphs } from '../src/parsers/pdf'
import page from './fixtures/ocr-footnotes.json'

describe('note numbers in the text', () => {
  it('are found for showing as small superscripts, with the stray space before the punctuation', () => {
    const text = '易钱九百余文”〔3〕 。“省北……七百”[5〕 。降至一千二百左右。(2]'
    const refs = noteRefRanges(text).map(([a, b]) => text.slice(a, b))
    expect(refs).toEqual(['〔3〕 ', '[5〕 ', '(2]'])
    // 段首的编号、列举不算
    expect(noteRefRanges('〔1〕民国《临县志》。')).toEqual([])
    expect(noteRefRanges('一为市场：（1）农业，（2）商业')).toEqual([])
  })
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
  it('a table stays where it was on the page, between the body paragraphs around it', () => {
    const content: BookContent = { id: 'b', blocks: ['上一页。'], heads: {}, toc: [], sections: [], pages: [0] }
    appendPage(content, 1, ['表格前面的话。', '表格后面的话。'], [], true, [], ['表2-4 统计表', '1875 1 永宁'], [1, 1])
    expect(content.blocks).toEqual(['上一页。', '表格前面的话。', '表2-4 统计表', '1875 1 永宁', '表格后面的话。'])
    expect(content.captions).toEqual([2, 3])
  })
})

import { findRuleLines } from '../src/ocr/rules'
import rulePage from './fixtures/ocr-footnotes-rule.json'

/** 白底图片，画上几块"文字"和横线 */
function image(width: number, height: number, draw: (fill: (x0: number, y0: number, x1: number, y1: number) => void) => void) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  draw((x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3)
  })
  return { data, width, height }
}

describe('footnote rule line in the page image', () => {
  it('finds a short line on the left with blank space around it', () => {
    const img = image(1000, 400, fill => {
      // 正文：一个个字
      for (let x = 100; x < 900; x += 40) fill(x, 50, x + 30, 80)
      fill(100, 150, 330, 152)
      for (let x = 100; x < 600; x += 30) fill(x, 200, x + 22, 222)
    })
    expect(findRuleLines(img, 1000, 1000)).toEqual([{ y: 1151, x0: 100, x1: 330 }])
  })
  it('ignores dashes inside a line of text, long table borders and thick bars', () => {
    const img = image(1000, 400, fill => {
      for (let x = 100; x < 400; x += 40) fill(x, 50, x + 30, 80)
      fill(400, 64, 520, 66)
      for (let x = 520; x < 900; x += 40) fill(x, 50, x + 30, 80)
      fill(50, 150, 950, 152)
      fill(100, 250, 300, 280)
    })
    expect(findRuleLines(img, 0, 1000)).toEqual([])
  })
})

describe('footnotes below a rule line (notes as tall as the body in OCR)', () => {
  const lines = rulePage.lines as OcrLine[]
  it('uses the rule line', () => {
    expect(splitFootnotes(lines, rulePage.pageHeight).notes).toEqual([])
    const { body, notes } = splitFootnotes(lines, rulePage.pageHeight, [{ y: 1720, x0: 130, x1: 420 }])
    expect(body).toHaveLength(2)
    expect(ocrTextToParagraphs(notesToText(notes))).toEqual([
      '〔1〕《申报》1879年7月21日。',
      expect.stringMatching(/^\[2 \] Mike Davis.*London,New York,2001\.p\.76\.$/),
      '[3] Ibid,p.78.',
    ])
  })
  it('a centered separator or a line high up the page is not a footnote rule', () => {
    expect(splitFootnotes(lines, rulePage.pageHeight, [{ y: 1720, x0: 600, x1: 900 }]).notes).toEqual([])
    expect(splitFootnotes(lines, rulePage.pageHeight, [{ y: 1720, x0: 130, x1: 1500 }]).notes).toEqual([])
  })
})

import { dropMarginLines, splitFigures } from '../src/ocr/layout'
import figurePage from './fixtures/ocr-figure-page.json'

describe('figures and figure notes on a scanned page (real PaddleOCR result, p. 94)', () => {
  const lines = dropMarginLines(figurePage.lines as OcrLine[], figurePage.pageHeight)
  it('takes the chart labels, the caption and every indented note item', () => {
    const { body, figures } = splitFigures(lines)
    expect(body).toEqual([])
    const parts = figures[0].map(p => ocrTextToParagraphs(p).join(''))
    expect(parts[0]).toMatch(/^60/)
    expect(parts[1]).toBe('图2-4山西与直隶、上海粮价波动趋势之对比')
    expect(parts.slice(2).map(p => p.replace(/\s/g, '').slice(0, 6))).toEqual(['说明：1.荣', '2.直隶地区', '3.上海米价', '4.由于各地'])
    // 每条说明是完整的一段（原来按行断开："……价格的绝对水平仍然" / "不是完全可比的。"）
    expect(parts[5]).toBe('4.由于各地的斗、石并不相等，尽管进行了单位换算，价格的绝对水平仍然不是完全可比的。')
    expect(parts[2]).toContain('一斗麦=40斤')
    expect(parts[2].endsWith('格为左侧纵轴指数。')).toBe(true)
  })
  it('body text after the notes (back at the left margin) stays body text', () => {
    const last = lines[lines.length - 1]
    const step = 68
    const body = [0, 1, 2].map(i => ({
      ...last,
      text: i === 0 ? '光绪三年，山西全省大旱，粮价飞涨，饥民遍野，各地纷纷开仓赈济。' : '巡抚曾国荃奏请朝廷拨款赈灾，并动员绅商捐输，以济急需。',
      x0: i === 0 ? 200 : 120,
      x1: 1490,
      y0: last.y0 + step * (i + 1),
      y1: last.y1 + step * (i + 1),
    }))
    const { body: kept } = splitFigures([...lines, ...body])
    expect(kept.map(l => l.text.slice(0, 4))).toEqual(['光绪三年', '巡抚曾国', '巡抚曾国'])
  })
  it('a sentence that merely mentions a figure is not a caption', () => {
    const row = { ...lines[lines.length - 1], text: '图2-4显示，光绪三年粮价暴涨了数倍。', x0: 120, x1: 1490 }
    expect(splitFigures([row]).figures).toEqual([])
  })
})

import tablePage from './fixtures/ocr-table-page.json'
import { findTableLines } from '../src/ocr/rules'

describe('tables on a scanned page (real PaddleOCR result, p. 100)', () => {
  // 测试图片是拼出来的：表格下面贴了另一页的正文（去掉那一页的页眉）
  const lines = dropMarginLines(tablePage.lines as OcrLine[], tablePage.pageHeight).filter(l => !l.text.startsWith('第一章'))
  // 表格的横线：标题下、每一行之间、表格底边
  const ruled = [328, 404, 478, 560, 703, 978, 1065].map(y => ({ y, x0: 170, x1: 1480 }))
  const texts = (ls: OcrLine[]) => ls.map(l => l.text.slice(0, 4))

  it('every cell between the ruled lines is skipped, with the caption above', () => {
    const { body, figures } = splitFigures(lines, ruled)
    expect(figures).toHaveLength(1)
    expect(figures[0][0]).toMatch(/^表2-4/)
    expect(figures[0].join(' ')).toContain('安邑、左云')
    expect(figures[0].join(' ')).toContain('楼、静乐')
    expect(texts(body)).toEqual(texts(lines.filter(l => l.y0 > 1300)))
    expect(body.length).toBeGreaterThan(0)
  })
  it('without the ruled lines, rows under a table caption that are not sentences are the table', () => {
    const { body, figures } = splitFigures(lines)
    expect(figures).toHaveLength(1)
    expect(figures[0].join(' ')).toContain('安邑、左云')
    expect(texts(body)).toEqual(texts(lines.filter(l => l.y0 > 1300)))
  })
  it('a header rule above body text does not turn the body into a table', () => {
    const prose = lines.filter(l => l.y0 > 1300)
    const { body, figures } = splitFigures(prose, [{ y: 1300, x0: 60, x1: 1440 }, { y: 2100, x0: 60, x1: 1440 }])
    expect(figures).toEqual([])
    expect(body).toHaveLength(prose.length)
  })
})

describe('finding table lines in the page image', () => {
  const W = 400
  const H = 300
  const img = () => ({ data: new Uint8ClampedArray(W * H * 4).fill(255), width: W, height: H })
  const fill = (im: ReturnType<typeof img>, x0: number, x1: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) im.data.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3)
  }
  it('finds long thin lines and ignores text and short rules', () => {
    const im = img()
    fill(im, 20, 380, 50, 52) // 表格边框
    fill(im, 20, 380, 120, 121)
    fill(im, 20, 100, 200, 201) // 脚注线
    for (let x = 20; x < 380; x += 12) fill(im, x, x + 8, 80, 95) // 一行字
    fill(im, 20, 380, 250, 290) // 色块
    expect(findTableLines(im, 0, W).map(l => l.y)).toEqual([51, 120])
  })
})

import { groupsToLines as toLines } from '../src/ocr/layout'

describe('a small caption beside a narrow column of body text (p. 297)', () => {
  const box = (text: string, x: number, y: number, w: number, h: number) => ({ text, x, y, w, h })
  const groups = [
    [box('信接替自己的', 100, 100, 330, 46)],
    [box('機會。周永康', 100, 160, 330, 46), box('周永康退休後還不滿一個月，其親信四川省委', 470, 166, 700, 30)],
    [box('退休後還不滿', 100, 220, 330, 46), box('副書記李春城就落馬了。', 470, 226, 380, 30)],
    [box('一個月，習近', 100, 280, 330, 46)],
    [box('平領導下的新班子就展開了對他的親信、四川省委副書記李', 100, 340, 1070, 46)],
  ]
  it('keeps the caption out of the body text, which reads on without it', () => {
    const lines = assignParagraphs(toLines(groups))
    const { body, figures } = splitFigures(lines)
    expect(figures).toEqual([['周永康退休後還不滿一個月，其親信四川省委副書記李春城就落馬了。']])
    expect(linesToText(body).replace(/\s+/g, '')).toBe('信接替自己的機會。周永康退休後還不滿一個月，習近平領導下的新班子就展開了對他的親信、四川省委副書記李')
  })
})

describe('photo edges are not table borders (p. 62)', () => {
  it('body text in a narrow column beside a photo stays body text', () => {
    const row = (y: number, text: string, x0 = 230, x1 = 550) => ({ text, para: 0, x0, y0: y, x1, y1: y + 40 })
    const lines = [
      row(300, '市司法局發去明傳'),
      row(370, '電報，稱重慶警方'),
      row(440, '有錄音錄像證明，'),
      row(510, '李莊在家辦案件過'),
      row(800, '12 月 12 日夜，李莊在北京被重慶警方秘密抓捕，警察將他押回重慶。', 230, 1360),
    ]
    // 照片的上下边（只在照片的左右范围内）
    const edges = [342, 347, 432, 440, 499].map(y => ({ y, x0: 631, x1: 1363 }))
    const { figures, body } = splitFigures(lines as OcrLine[], edges)
    expect(figures).toEqual([])
    expect(body).toHaveLength(5)
  })
})
