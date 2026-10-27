import { describe, expect, it } from 'vitest'
import { ocrTextToParagraphs } from '../src/ocr/text'

describe('OCR text', () => {
  it('removes spaces between Chinese characters and joins wrapped lines', () => {
    const raw = '第 三 章 远 行\n\n清晨 的 阳光 照 进 小 屋 ， 窗 外 的 鸟 儿\n开始 歌唱 。\n\nIt was a dark and stor-\nmy night.\n\n12\n'
    expect(ocrTextToParagraphs(raw)).toEqual(['第三章远行', '清晨的阳光照进小屋，窗外的鸟儿开始歌唱。', 'It was a dark and stormy night.'])
  })
  it('only drops page numbers at the top or bottom of a page', () => {
    expect(ocrTextToParagraphs('- 7 -\n\n那一年是\n\n1984\n\n我们搬了家。\n\n8')).toEqual(['那一年是', '1984', '我们搬了家。'])
  })
})

import { garbleRatio, guessOcrLang, isGarbled } from '../src/parsers/garble'
import { tidyChinese } from '../src/ocr/text'

describe('Chinese OCR punctuation', () => {
  it('turns half-width punctuation between Chinese characters into full-width', () => {
    expect(tidyChinese('這是第 1 段文字。清晨的陽光照進小屋 , 窗外的鳥兒開始歌唱 . 她說 : 好 ! 真的 ?')).toBe('這是第1段文字。清晨的陽光照進小屋，窗外的鳥兒開始歌唱。她說：好！真的？')
  })
  it('keeps English punctuation and spacing', () => {
    expect(tidyChinese('Hello, world. It costs 3.5 dollars')).toBe('Hello, world. It costs 3.5 dollars')
  })
})

describe('garbled text detection', () => {
  it('flags text from broken PDF font mappings', () => {
    expect(isGarbled('Ↄÿ≣oள२!217! ≣≣≣¥!221! ⊿F§7!233! ŋ<≣≣ǰŇ!261! ŋƅ≣≣ĂυƄ≣≣Ň!297!')).toBe(true)
    expect(isGarbled('≧ஈʈʅƆ७≧ஊஅƈ≨ஈஈஈஊ≨Ƈʆ≨≨८ↇƋஉʉʉஈƈↈ஋ஈ஋Ɔƈஆ३')).toBe(true)
  })
  it('accepts normal Chinese, English and accented text', () => {
    expect(isGarbled('清晨的陽光照進小屋，窗外的鳥兒開始歌唱。「你好！」她說——然後笑了……')).toBe(false)
    expect(isGarbled('It was the best of times, it was the worst of times; café, naïve, Straße.')).toBe(false)
    expect(garbleRatio('第二章 太子黨 105')).toBe(0)
  })
  it('guesses traditional or simplified Chinese', () => {
    expect(guessOcrLang('何頻 & 黃聞光：中國權貴的死亡遊戲 第二章 太子黨')).toBe('chi_tra')
    expect(guessOcrLang('中国权贵的死亡游戏 第二章 太子党')).toBe('chi_sim')
    expect(guessOcrLang('A Tale of Two Cities, Chapter One, the period')).toBe('eng')
  })
})

import { appendPage, applyOutlineTitles, rebuildOcrContent } from '../src/ocr/runner'
import { continuesAcrossPage, edgeKeys, isPlatePage, stripRunningHeads } from '../src/ocr/text'
import type { BookContent } from '../src/core/book'

describe('outline titles', () => {
  it('replaces a misread chapter heading with the bookmark title', () => {
    expect(applyOutlineTitles(['aa 亞第章權貴', '這是第1段文字。'], ['第一章 權貴'])).toEqual(['第一章 權貴', '這是第1段文字。'])
  })
  it('leaves unrelated paragraphs alone', () => {
    expect(applyOutlineTitles(['清晨的陽光照進小屋。', '窗外的鳥兒開始歌唱。'], ['第一章 權貴'])).toEqual(['清晨的陽光照進小屋。', '窗外的鳥兒開始歌唱。'])
  })
})

describe('running headers', () => {
  it('drops a header that already appeared at the top of recent pages', () => {
    const recent = edgeKeys(['中國權貴的死亡遊戲', '第一段文字。', '12'])
    expect(stripRunningHeads(['中國權貴的死亡遊戲 13', '第二段文字。'], recent)).toEqual(['第二段文字。'])
  })
  it('keeps chapter headings that only look like the previous one', () => {
    for (const [a, b] of [
      ['Chapter 2', 'Chapter 3'],
      ['Chapter One', 'Chapter Two'],
      ['CHAPTER XII', 'CHAPTER XIII'],
      ['第12章', '第13章'],
      ['第一百零一回', '第一百零二回'],
    ]) {
      expect(stripRunningHeads([b, '正文。'], edgeKeys([a, '正文。']))).toEqual([b, '正文。'])
    }
  })
  it('drops a chapter-title running header with its page number', () => {
    const recent = edgeKeys(['第一章 風起 22', '正文。'])
    expect(stripRunningHeads(['第一章 風起 23', '個不停。'], recent)).toEqual(['個不停。'])
    expect(stripRunningHeads(['第一章 風起', '23', '個不停。'], edgeKeys(['第一章 風起', '正文。']))).toEqual(['個不停。'])
  })
  it('handles page numbers glued to a Chinese header after OCR cleanup', () => {
    const prev = ocrTextToParagraphs('第 一 章 風 起 21\n\n正 文 。')
    expect(stripRunningHeads(ocrTextToParagraphs('第 一 章 風 起 23\n\n個 不 停 。'), edgeKeys(prev))).toEqual(['個不停。'])
    expect(stripRunningHeads(['鲁迅全集 23', '正文。'], edgeKeys(['22 鲁迅全集', '正文。']))).toEqual(['正文。'])
  })
  it('tolerates a misread character in a chapter running header', () => {
    expect(stripRunningHeads(['CHAPTER 3 · THE ST0RM 49', 'Text.'], edgeKeys(['CHAPTER 3 · THE STORM 47', 'Text.']))).toEqual(['Text.'])
    expect(stripRunningHeads(['第一章風起雲湧的年伐', '正文。'], edgeKeys(['第一章風起雲湧的年代', '正文。']))).toEqual(['正文。'])
  })
  it('keeps numbered entry headings', () => {
    for (const [a, b] of [
      ['Day 11', 'Day 12'],
      ['SCENE II', 'SCENE III'],
      ['Sonnet XVIII', 'Sonnet XIX'],
      ['1943年3月3日', '1943年3月5日'],
      ['Saturday, 20 June 1942', 'Sunday, 21 June 1942'],
      ['第3讲', '第4讲'],
    ]) {
      expect(stripRunningHeads([b, '正文。'], edgeKeys([a, '正文。']))).toEqual([b, '正文。'])
    }
  })
  it('keeps section numbers and years under a removed header', () => {
    expect(stripRunningHeads(['48 THE FISHERMAN\'S SON', 'III', 'In the spring the boats went out.'], edgeKeys(["THE FISHERMAN'S SON 46", 'x.']))).toEqual([
      'III',
      'In the spring the boats went out.',
    ])
    expect(stripRunningHeads(['往事並不如煙', '1949', '那一年。'], edgeKeys(['往事並不如煙', '正文。']))).toEqual(['1949', '那一年。'])
  })
  it('keeps headers seen for the first time, sentences and bookmark titles', () => {
    expect(stripRunningHeads(['第三章 風波', '正文。'], [])).toEqual(['第三章 風波', '正文。'])
    expect(stripRunningHeads(['好。', '正文。'], ['好'])).toEqual(['好。', '正文。'])
    expect(stripRunningHeads(['第三章 風波', '正文。'], ['第三章風波'], ['第三章 風波'])).toEqual(['第三章 風波', '正文。'])
  })
})

describe('pages joined mid-sentence', () => {
  it('detects a sentence that continues on the next page', () => {
    expect(continuesAcrossPage('清晨的阳光照进小屋，窗外的鸟儿开始歌唱，她推开门走了出去，沿着河', '边一直往前走。')).toBe(true)
    expect(continuesAcrossPage('清晨的阳光照进小屋，窗外的鸟儿开始歌唱，她推开门走了出去。', '第二天早上。')).toBe(false)
    expect(continuesAcrossPage('清晨的阳光照进小屋，窗外的鸟儿开始歌唱，她推开门走了出去，沿着河', '第四章 远行')).toBe(false)
  })
  it('joins the halves into one paragraph and points the page at it', () => {
    const content: BookContent = { id: 'x', blocks: [], heads: {}, toc: [], sections: [], pages: [] }
    appendPage(content, 0, ['第一章 開始', '清晨的陽光照進小屋，窗外的鳥兒開始歌唱，她推開門走了出去，沿著'])
    appendPage(content, 1, ['河邊一直往前走。', '天黑了。'])
    expect(content.blocks).toEqual(['第一章 開始', '清晨的陽光照進小屋，窗外的鳥兒開始歌唱，她推開門走了出去，沿著河邊一直往前走。', '天黑了。'])
    expect(content.pages).toEqual([0, 2])
  })
  it('does not join a first-time header with a page number or a picture caption', () => {
    expect(continuesAcrossPage('Mr. Dursley was a big, beefy man, although he did have a', 'THE BOY WHO LIVED 3')).toBe(false)
    const long = '心裡想著昨天發生的事情，她推開門走了出去，沿著'
    expect(continuesAcrossPage(long, '圖3 1936年冬，作者（左二）與紅軍戰士在延安窯洞前合影')).toBe(false)
    expect(isPlatePage(['圖3 1936年冬，作者（左二）與紅軍戰士在延安窯洞前合影'])).toBe(true)
    expect(isPlatePage(['河邊一直往前走，天已經黑了下來。'])).toBe(false)
  })
  it('does not join headings, bookmark titles or across a blank page', () => {
    const long = '清晨的陽光照進小屋，窗外的鳥兒開始歌唱，她推開門走了出去，沿著'
    expect(continuesAcrossPage(long, '一、問題的提出')).toBe(false)
    expect(continuesAcrossPage(long, '2. Methods and data')).toBe(false)
    expect(continuesAcrossPage('Chapter One: The Boy Who Lived', 'Mr. and Mrs. Dursley, of number four, Privet Drive, were proud')).toBe(false)
    const content: BookContent = { id: 'x', blocks: [long], heads: {}, toc: [], sections: [], pages: [0] }
    appendPage(content, 1, ['The Early Years of the Republic', '正文。'], ['The Early Years of the Republic'])
    expect(content.blocks[1]).toBe('The Early Years of the Republic')
    appendPage(content, 2, [])
    appendPage(content, 3, ['河邊一直往前走的時候，天已經黑了下來。'], [], false)
    expect(content.blocks.length).toBe(4)
    expect(content.pages).toEqual([0, 1, 3, 3])
  })
})

describe('OCR table of contents', () => {
  it('points a bookmark at its heading when the chapter starts mid-page', () => {
    const content: BookContent = { id: 'x', blocks: [], heads: {}, toc: [], sections: [], pages: [] }
    appendPage(content, 0, ['序言的最后一段。', '第一章 權貴', '正文開始。'])
    appendPage(content, 1, ['第二頁的內容。'])
    rebuildOcrContent(content, [{ title: '第一章 權貴', page: 0, level: 0 }])
    expect(content.toc).toEqual([{ title: '第一章 權貴', b: 1, level: 0 }])
    expect(content.heads[1]).toBe(1)
  })
})

import { dropRepeatedLines, repeatedLineKeys } from '../src/parsers/pdf'

describe('PDF watermarks', () => {
  const first = ['春天来了', '夏天到了', '秋风起了', '冬雪落了', '清晨出门', '中午吃饭', '傍晚散步', '夜里读书']
  const page = (n: number) => [
    { text: `${first[n - 1]}，内容各不相同` },
    { text: `${first[(n + 2) % 8]}，第二行` },
    { text: '这是第1段文字。清晨的阳光照进小屋' },
    { text: '这是第2段文字。清晨的阳光照进小屋' },
    { text: `${first[8 - n]}，又是一行` },
    { text: '扫描全能王 创建' },
  ]
  const pages = Array.from({ length: 8 }, (_, i) => page(i + 1))
  it('drops lines repeated at the top or bottom of most pages', () => {
    const keys = repeatedLineKeys(pages)
    expect(dropRepeatedLines(pages[0], keys).map(l => l.text)).toEqual([
      '春天来了，内容各不相同',
      '冬雪落了，第二行',
      '这是第1段文字。清晨的阳光照进小屋',
      '这是第2段文字。清晨的阳光照进小屋',
      '夜里读书，又是一行',
    ])
  })
  it('never treats garbled lines as a watermark', () => {
    const garbled = Array.from({ length: 6 }, () => [{ text: '≧ஈʈʅƆ७≧ஊஅƈ≨ஈஈஈஊ≨Ƈʆ≨≨८ↇƋஉʉʉ' }])
    expect(repeatedLineKeys(garbled).size).toBe(0)
  })
})

import { dropMarginLines, linesToText, type OcrLine } from '../src/ocr/layout'
import pageLines from './fixtures/ocr-page-lines.json'

describe('page header and footer by position', () => {
  // 用户那一页（丁戊奇荒）的识别结果：页眉"2 丁戊奇荒"被识别成乱码，而且被斑点拉宽
  const real = pageLines as OcrLine[]
  const pageHeight = 2260
  const body = (y: number, text = '这是一行正文，排得满满的，一共有二十多个字呢。还有。', para = 1): OcrLine => ({ text, para, x0: 120, x1: 1020, y0: y, y1: y + 28 })

  it('drops the running header even when misread and widened by specks', () => {
    const kept = dropMarginLines(real, pageHeight)
    expect(kept.map(l => l.text)).not.toContain(real[0].text)
    expect(kept).toHaveLength(real.length - 1)
    expect(ocrTextToParagraphs(linesToText(kept))[0].startsWith('另一本书')).toBe(true)
  })
  it('keeps a body line that starts the page and a big chapter title', () => {
    const lines = [body(230, '的方法。', 0), body(280), body(329), body(378)]
    lines[0].x1 = 300
    expect(dropMarginLines(lines, pageHeight)).toHaveLength(4)
    const title: OcrLine = { text: '第三章 灾荒', para: 0, x0: 400, x1: 700, y0: 150, y1: 210 }
    expect(dropMarginLines([title, body(330), body(379), body(428)], pageHeight)).toHaveLength(4)
  })
  it('drops a page number at the bottom but not the last short line of text', () => {
    const folio: OcrLine = { text: '23', para: 9, x0: 560, x1: 590, y0: 2050, y1: 2075 }
    const lines = [body(1800), body(1849), body(1898, '最后一行。', 2), folio]
    lines[2].x1 = 300
    expect(dropMarginLines(lines, pageHeight).map(l => l.text)).toEqual(lines.slice(0, 3).map(l => l.text))
  })
})

import { assignParagraphs } from '../src/ocr/layout'

describe('paragraphs from line positions', () => {
  const line = (y: number, text: string, x0 = 120, x1 = 1020) => ({ text, x0, x1, y0: y, y1: y + 28 })
  it('starts a paragraph at an indented line or after a short line', () => {
    const paras = assignParagraphs([
      line(100, '接上一页的正文，一直写到这一行的末尾都没有空出来的地方'),
      line(149, '这一段到这里结束了。', 120, 500),
      line(198, '新的一段开头缩进了两个字，所以是新的一段，后面还有很多字', 176),
      line(247, '这一行接着上一行，还是同一段，一直写到这一行的末尾为止啊'),
      line(296, '最后一行。', 120, 300),
    ]).map(l => l.para)
    expect(paras).toEqual([0, 0, 1, 1, 1])
  })
  it('starts a paragraph after a large vertical gap', () => {
    const paras = assignParagraphs([
      line(100, '正文写满了这一整行的文字，没有任何缩进也没有空出来的地方'),
      line(149, '正文写满了这一整行的文字，没有任何缩进也没有空出来的地方'),
      line(400, '隔了很远的另一部分，也写满了这一整行的文字没有任何空出来'),
    ]).map(l => l.para)
    expect(paras).toEqual([0, 0, 1])
  })
  it('keeps a block quote indented as a whole together (first line 4 chars in, the rest 2 chars in)', () => {
    // 整段引文缩进两个字，原来每一行都被当成了新的一段（"价则或涨或" / "落，粜则……"）
    const paras = assignParagraphs([
      line(100, '正文写满了这一整行的文字，没有任何缩进也没有空出来的地方'),
      line(149, '引文的前一段到这里结束了：', 120, 560),
      line(198, '粮价之涨落无定也。黄河一带口岸，如保德碛石之类', 248, 1010),
      line(247, '下游之粜既闭，上游之来源亦塞，不得已又自行开禁，价则或涨或', 184, 1010),
      line(296, '落，粜则时闭时开，商贾为之裹足，民食因之益困。以上各条皆古', 184, 1010),
      line(345, '今未有之惨变，然不拔本塞源，恐后此之惨变更有甚于此前', 184, 1010),
      line(394, '者矣。〔4〕', 184, 360),
      line(443, '说明处于交易前沿的市场地带对粮食供求是极其敏感的。', 120, 900),
      line(492, '粮食紧缺时价格上涨，一旦供应充足就会下跌。在辽州，光绪', 176),
    ]).map(l => l.para)
    expect(paras).toEqual([0, 0, 1, 1, 1, 1, 1, 2, 3])
  })
  it('keeps lines of a narrow column beside a photo in one paragraph', () => {
    // 原书第 35 页：左边的正文绕着照片排，每行都只写到一半宽
    const paras = assignParagraphs([
      line(100, '蒙古族也好，漢族', 176, 560),
      line(149, '也罷，王立軍確是在蒙', 120, 560),
      line(198, '古傳統中成長起來的。', 120, 560),
      line(247, '十幾歲的時候，他曾入', 120, 560),
      line(296, '選過内蒙古少年拳擊', 120, 560),
      line(345, '隊，武藝高強。1977 年', 120, 560),
      line(394, '一個 300 萬人口的城市', 120, 560),
      line(443, '鐵嶺期間，他曾兩次參加嚴格的入學考試，希望能進一所軍校，可是未能考上。', 120, 1020),
      line(492, '軍和在鐵法市商業局工作的肖淑麗結了婚。', 120, 700),
      line(541, '王立軍的警察生涯開始於 1984 年，他被當地公安局招募', 176, 1020),
    ]).map(l => l.para)
    expect(paras).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
  })
  it('consecutive one-line paragraphs that fill the line are still separate', () => {
    const paras = assignParagraphs([
      line(100, '正文写满了这一整行的文字，没有任何缩进也没有空出来的地方'),
      line(149, '第一段只有一行，写满了这一整行的文字，没有空出来的地方', 176),
      line(198, '第二段也只有一行，写满了这一整行的文字，没有空出来的地', 176),
      line(247, '第三段的第一行写满了这一整行的文字，没有空出来的地方啊', 176),
      line(296, '第三段的第二行。', 120, 400),
    ]).map(l => l.para)
    expect(paras).toEqual([0, 1, 2, 3, 3])
  })
})

import { groupsToLines, type OcrBox } from '../src/ocr/layout'

describe('layout review cases', () => {
  const pageHeight = 2260
  const full = (y: number, text = '这是一行正文，排得满满的，一共有二十多个字呢。还有字。', para = 1): OcrLine => ({ text, para, x0: 120, x1: 1020, y0: y, y1: y + 28 })

  it('keeps a short real line at the top edge after a scene break', () => {
    const lines = [{ ...full(120, '这一夜，谁也没有睡着。'), x1: 420 }, full(260), full(309), full(358)]
    expect(dropMarginLines(lines, pageHeight)).toHaveLength(4)
  })
  it('keeps a one-line footnote at the bottom', () => {
    const note: OcrLine = { text: '①见《山西通志》卷八十二，光绪十八年刻本。', para: 9, x0: 120, x1: 640, y0: 2000, y1: 2022 }
    const lines = [full(1700), full(1749), full(1798), note]
    expect(dropMarginLines(lines, pageHeight)).toContain(note)
  })
  it('drops a numbered header on a page with a single body line', () => {
    const header: OcrLine = { text: '第三章 灾荒与社会 45', para: 0, x0: 700, x1: 1020, y0: 110, y1: 136 }
    const kept = dropMarginLines([header, full(220, '刻有当时的粮价，是研究这段历史的珍贵材料。')], pageHeight)
    expect(kept.map(l => l.text)).toEqual(['刻有当时的粮价，是研究这段历史的珍贵材料。'])
  })
  it('splits two columns and reads the left column first', () => {
    const box = (text: string, x: number, y: number): OcrBox => ({ text, x, y, w: 380, h: 28 })
    const groups: OcrBox[][] = []
    for (let i = 0; i < 6; i++) groups.push([box(`左${i}行文字`, 100, 200 + i * 50), box(`右${i}行文字`, 560, 200 + i * 50)])
    const lines = groupsToLines(groups)
    expect(lines.map(l => l.text)).toEqual([0, 1, 2, 3, 4, 5].map(i => `左${i}行文字`).concat([0, 1, 2, 3, 4, 5].map(i => `右${i}行文字`)))
    // 换栏时开始新的一段
    const paras = assignParagraphs(lines)
    expect(paras[6].para).toBeGreaterThan(paras[5].para)
  })
  it('keeps a single-column line with a wide gap in one piece', () => {
    const lines = groupsToLines([[{ text: '第一章', x: 300, y: 100, w: 120, h: 40 }, { text: '风起', x: 600, y: 100, w: 80, h: 40 }]])
    expect(lines.map(l => l.text)).toEqual(['第一章 风起'])
  })
  it('finds indents when most paragraphs are short', () => {
    // 两行一段的对话：大多数整行都是缩进的首行
    const lines: Omit<OcrLine, 'para'>[] = []
    let y = 100
    for (let i = 0; i < 6; i++) {
      lines.push({ text: '“回家吧。”他头也不回地说，天快黑了，再不走就赶不上', x0: 176, x1: 1020, y0: y, y1: y + 28 })
      lines.push({ text: '最后一班车了，你要是不走我可就先走了啊，到时候别怪我', x0: 120, x1: 1020, y0: y + 49, y1: y + 77 })
      y += 98
    }
    expect(new Set(assignParagraphs(lines).map(l => l.para)).size).toBe(6)
  })
})

describe('header with specks read as a full stop', () => {
  it('still drops a numbered header whose specks became a trailing period', () => {
    const header: OcrLine = { text: '2 了 丁 戊 麻 荒 .', para: 0, x0: 116, x1: 954, y0: 113, y1: 146 }
    const body = [232, 280, 329, 378].map(y => ({ text: '这是一行正文，排得满满的，一共有二十多个字呢。还有字。', para: 1, x0: 119, x1: 1020, y0: y, y1: y + 27 }))
    expect(dropMarginLines([header, ...body], 2260)).toHaveLength(4)
  })
})
