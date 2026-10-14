import { describe, expect, it } from 'vitest'
import { ocrTextToParagraphs } from '../src/ocr/text'

describe('OCR text', () => {
  it('removes spaces between Chinese characters and joins wrapped lines', () => {
    const raw = '第 三 章 远 行\n\n清晨 的 阳光 照 进 小 屋 ， 窗 外 的 鸟 儿\n开始 歌唱 。\n\n12\n\nIt was a dark and stor-\nmy night.\n'
    expect(ocrTextToParagraphs(raw)).toEqual(['第三章远行', '清晨的阳光照进小屋，窗外的鸟儿开始歌唱。', 'It was a dark and stormy night.'])
  })
})
