import { describe, expect, it } from 'vitest'
import { detectLang, normalizeText, splitSentences, speechText } from '../src/core/text'
import { chapterLevel, detectChapters } from '../src/core/chapters'

const parts = (text: string) => splitSentences(text).map(s => text.slice(s.o, s.e))

describe('splitSentences', () => {
  it('splits Chinese sentences and keeps closing quotes', () => {
    expect(parts('他说：“你好。”她笑了！真的吗？是的……走吧。')).toEqual([
      '他说：“你好。”',
      '她笑了！',
      '真的吗？',
      '是的……',
      '走吧。',
    ])
  })

  it('splits English sentences but not abbreviations or initials', () => {
    expect(parts('Mr. Smith met J. K. Rowling. It was 3.14 p.m. exactly! "Really?" she asked.')).toEqual([
      'Mr. Smith met J. K. Rowling.',
      'It was 3.14 p.m. exactly!',
      '"Really?"',
      'she asked.',
    ])
  })

  it('breaks very long sentences at commas', () => {
    const long = '这是一个非常长的句子，'.repeat(20) + '结束。'
    const result = parts(long)
    expect(result.length).toBeGreaterThan(1)
    expect(result.join('')).toBe(long)
    for (const s of result) expect(s.length).toBeLessThanOrEqual(90)
  })

  it('handles text without terminators', () => {
    expect(parts('第一章 风起云涌')).toEqual(['第一章 风起云涌'])
  })
})

describe('text helpers', () => {
  it('normalizes whitespace between CJK characters', () => {
    expect(normalizeText('　　中文\n 中文 English  words')).toBe('中文中文 English words')
  })
  it('detects language', () => {
    expect(detectLang('这是一段中文文字，用来测试语言识别。')).toBe('zh')
    expect(detectLang('This is an English sentence for testing.')).toBe('en')
    expect(detectLang('これは日本語のテキストです。ひらがなとカタカナ。')).toBe('ja')
  })
  it('cleans speech text', () => {
    expect(speechText('见 https://example.com 网站***')).toBe('见 网站')
  })
})

describe('chapters', () => {
  it('recognizes chapter headings', () => {
    expect(chapterLevel('第一章 风起')).toBe(1)
    expect(chapterLevel('第十二回　宴桃园豪杰三结义')).toBe(1)
    expect(chapterLevel('第三卷 天下')).toBe(0)
    expect(chapterLevel('楔子')).toBe(1)
    expect(chapterLevel('Chapter 3: The Return')).toBe(1)
    expect(chapterLevel('CHAPTER IV')).toBe(1)
    expect(chapterLevel('第三节课上，老师说了一个故事。')).toBe(-1)
    expect(chapterLevel('第一次见到他的时候')).toBe(-1)
    expect(chapterLevel('Chapter and verse were quoted by everyone in the room.')).toBe(-1)
  })
  it('skips a table-of-contents block', () => {
    const blocks = ['目录', '第一章 甲', '第二章 乙', '第三章 丙', '正文开始', '第一章 甲', '内容', '第二章 乙', '内容', '第三章 丙', '内容']
    expect(detectChapters(blocks).map(h => h.index)).toEqual([5, 7, 9])
  })
})
