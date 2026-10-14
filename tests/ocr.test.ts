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
import { continuesAcrossPage, edgeKeys, stripRunningHeads } from '../src/ocr/text'
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
