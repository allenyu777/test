import { describe, expect, it } from 'vitest'
import { ocrTextToParagraphs } from '../src/ocr/text'

describe('OCR text', () => {
  it('removes spaces between Chinese characters and joins wrapped lines', () => {
    const raw = '第 三 章 远 行\n\n清晨 的 阳光 照 进 小 屋 ， 窗 外 的 鸟 儿\n开始 歌唱 。\n\n12\n\nIt was a dark and stor-\nmy night.\n'
    expect(ocrTextToParagraphs(raw)).toEqual(['第三章远行', '清晨的阳光照进小屋，窗外的鸟儿开始歌唱。', 'It was a dark and stormy night.'])
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

import { applyOutlineTitles } from '../src/ocr/runner'

describe('outline titles', () => {
  it('replaces a misread chapter heading with the bookmark title', () => {
    expect(applyOutlineTitles(['aa 亞第章權貴', '這是第1段文字。'], ['第一章 權貴'])).toEqual(['第一章 權貴', '這是第1段文字。'])
  })
  it('leaves unrelated paragraphs alone', () => {
    expect(applyOutlineTitles(['清晨的陽光照進小屋。', '窗外的鳥兒開始歌唱。'], ['第一章 權貴'])).toEqual(['清晨的陽光照進小屋。', '窗外的鳥兒開始歌唱。'])
  })
})
