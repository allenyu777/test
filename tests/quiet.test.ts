import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Book, BookBuilder, finalizeBook } from '../src/core/book'
import { findQuietBlocks } from '../src/core/quiet'
import { parseFile } from '../src/parsers'
import { extractBlocks, parseMarkup } from '../src/parsers/dom'
import { fileFrom } from './helpers'

const quietText = (blocks: string[]) => findQuietBlocks(blocks).map(i => blocks[i])

describe('table of contents pages', () => {
  it('scanned contents page with leader dots', () => {
    const blocks = [
      '目录',
      '序言……………………………………………………1',
      '第一章 光绪初年的灾荒图景………………………………15',
      '第一节 旱灾…………………………………………17',
      '第二节 霜灾、雹灾与水灾.............................24',
      '后记 ……………………………… 301',
      '序言',
      '光绪初年，华北发生了一场罕见的大旱灾，史称“丁戊奇荒”。',
    ]
    expect(quietText(blocks)).toEqual(blocks.slice(0, 6))
  })
  it('entries with page numbers but no dots, OCR joined lines', () => {
    const blocks = [
      '第一章 光绪初年的灾荒图景 15',
      '第二章 清政府的救灾措施 63',
      '第三章 民间社会的救济…………98 第四章 灾后重建…………150',
      '第一章 光绪初年的灾荒图景',
      '光绪三年，山西全省大旱。',
    ]
    expect(quietText(blocks)).toEqual(blocks.slice(0, 3))
  })
  it('an EPUB contents page without page numbers', () => {
    const blocks = ['目 录', '前言', '第一章 开端', '第二章 结局', '后记', '前言', '这是一本关于灾荒的书，写了很多年。']
    expect(quietText(blocks)).toEqual(blocks.slice(0, 5))
  })
  it('English contents', () => {
    const blocks = ['Contents', 'Preface . . . . . . . . ix', 'Chapter 1 The River . . . . . 1', 'Chapter 2 The Mill . . . . . 23', 'Preface', 'It was a long year.']
    expect(quietText(blocks)).toEqual(blocks.slice(0, 4))
  })
  it('printed contents lines are not taken as chapters', () => {
    const parsed = {
      title: 'T',
      author: '',
      lang: 'zh',
      blocks: ['目录', '第一章 开端……1', '第二章 结局……9', '第一章 开端', '春天来了。', '第二章 结局', '故事结束了。'],
      heads: {},
      toc: [],
    }
    const content = finalizeBook('b', parsed)
    expect(content.toc.map(t => t.b)).toEqual([3, 5])
    expect(content.quiet).toEqual([0, 1, 2])
    const book = new Book(content)
    expect(book.speakableFrom({ b: 0, o: 0 })).toEqual({ b: 3, o: 0 })
    book.skipQuiet = false
    expect(book.speakableFrom({ b: 0, o: 0 })).toEqual({ b: 0, o: 0 })
  })
})

describe('copyright pages', () => {
  it('Chinese CIP page', () => {
    const blocks = [
      '丁戊奇荒',
      '郝平 著',
      '图书在版编目（CIP）数据',
      '丁戊奇荒：光绪初年山西灾荒与救济研究/郝平著．—北京：北京大学出版社，2012.6',
      'ISBN 978-7-301-20641-6',
      'Ⅰ．①丁… Ⅱ．①郝… Ⅲ．①自然灾害—研究—山西省—清后期 Ⅳ．①X432',
      '责任编辑：王立刚',
      '出版发行：北京大学出版社',
      '开本：650毫米×980毫米 16开本 21印张 300千字',
      '2012年6月第1版 2012年6月第1次印刷',
      '定价：45.00元',
      '版权所有，侵权必究',
      '序言',
      '光绪初年，华北发生了一场罕见的大旱灾。',
    ]
    expect(quietText(blocks)).toEqual(blocks.slice(0, 12))
  })
  it('English copyright page', () => {
    const blocks = ['Copyright © 2012 by Jane Doe', 'All rights reserved.', 'ISBN 978-0-14-312345-6', 'Printed in the United States of America', 'Chapter 1', 'The river ran fast that spring.']
    expect(quietText(blocks)).toEqual(blocks.slice(0, 4))
  })
  it('a single mention in the text is not a copyright page', () => {
    const blocks = ['他翻到书的最后一页，看到定价：三元五角。', '这本书他读了很多遍。']
    expect(quietText(blocks)).toEqual([])
  })
})

describe('figures and tables', () => {
  it('captions, number rows and sources', () => {
    const blocks = [
      '各地粮价上涨情况见下表。',
      '表1-2 光绪三年山西各地粮价（文/石）',
      '太原 1200 3500 6000 8000',
      '大同 1100 3200 5800 7600',
      '资料来源：《山西通志》卷八十二。',
      '从表中可以看出，粮价普遍上涨了五倍以上。',
      '图3 光绪三年山西旱灾分布示意图',
      '旱灾几乎遍及全省。',
    ]
    expect(quietText(blocks)).toEqual([blocks[1], blocks[2], blocks[3], blocks[4], blocks[6]])
  })
  it('ordinary sentences about figures and numbers are read', () => {
    const blocks = ['图1显示了粮价的变化，涨幅很大。', '那一年是1877年，他23岁。', '表3中的数字说明了问题。', 'Figure 2 shows the river in 1877, which flooded twice.']
    expect(quietText(blocks)).toEqual([])
  })
  it('EPUB tables and figure captions', () => {
    const doc = parseMarkup(
      '<html><body><h1>第一章</h1><p>粮价如下。</p><figure><img src="a.png"/><figcaption>山西地图</figcaption></figure><table><tr><td>太原</td><td>1200</td></tr></table><p>粮价很高。</p></body></html>',
      false,
    )
    const builder = new BookBuilder()
    extractBlocks(doc, builder)
    expect(builder.quiet.map(i => builder.blocks[i])).toEqual(['山西地图', '太原', '1200'])
  })
})

describe('no false alarms in ordinary books', () => {
  for (const name of ['gbk-novel.txt', 'big5-novel.txt', 'wrapped-english.txt']) {
    it(name, async () => {
      const parsed = await parseFile(fileFrom(new Uint8Array(readFileSync(`tests/fixtures/${name}`)), name))
      expect(quietText(parsed.blocks)).toEqual([])
    })
  }
})

describe('body text with spaced numbers (text layer of a traditional PDF)', () => {
  it('is not a table row', () => {
    const blocks = [
      '在中國農曆新年時，人們很看重算命大師對來年的預測，希望新的一年比過去的一年更好。',
      '2012 年 1 月 23 日午夜，全世界的中國人迎來了 12 年一度的龍年。儘管龍——這個神話中的動物——象徵著力量、權威和好運。',
      '2 月 4 日，網絡上出現一份疑似針對前重慶公安局長王立軍的精神狀況診斷書，來源似乎是解放軍第三軍醫大學第三附屬醫院。',
    ]
    expect(findQuietBlocks(blocks)).toEqual([])
  })
})
