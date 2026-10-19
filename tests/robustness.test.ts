import { describe, expect, it } from 'vitest'
import { finalizeBook } from '../src/core/book'
import { parseFile } from '../src/parsers'
import { decodeText } from '../src/parsers/encoding'
import { textToParagraphs } from '../src/parsers/txt'
import { fileFrom, makeZip } from './helpers'

const IND = String.fromCharCode(0x3000, 0x3000)

describe('robust text decoding', () => {
  it('keeps UTF-8 when a file has one bad byte', () => {
    const good = new TextEncoder().encode('这是一本中文小说，内容很长。'.repeat(50))
    const bytes = new Uint8Array(good.length + 1)
    bytes.set(good.subarray(0, 30), 0)
    bytes[30] = 0xff
    bytes.set(good.subarray(30), 31)
    const text = decodeText(bytes)
    expect(text).toContain('这是一本中文小说')
  })

  it('keeps UTF-8 when the last character is cut off', () => {
    const good = new TextEncoder().encode('结尾被截断的文字。'.repeat(20))
    expect(decodeText(good.subarray(0, good.length - 1))).toContain('结尾被截断的文字')
  })
})

describe('TXT paragraphs', () => {
  it('splits a whole book written on one line', () => {
    const para = '这是一个很长的段落，里面有很多句子。'.repeat(20)
    const line = Array.from({ length: 30 }, () => IND + para).join('')
    const paras = textToParagraphs(line)
    expect(paras.length).toBeGreaterThanOrEqual(30)
    for (const p of paras) expect(p.length).toBeLessThanOrEqual(3100)
  })

  it('rejoins hard-wrapped Chinese paragraphs with indents', () => {
    const para = '天色渐渐暗了下来，他终于来到了京城，城门口站着许多守卫，街上的行人来来往往，好不热闹。'
    const wrap = (s: string) => {
      const out: string[] = []
      for (let i = 0; i < s.length; i += 20) out.push(s.slice(i, i + 20))
      return out
    }
    const lines: string[] = ['第一章 开始']
    for (let i = 0; i < 6; i++) {
      const w = wrap(para)
      lines.push(IND + w[0], ...w.slice(1))
    }
    const paras = textToParagraphs(lines.join('\n'))
    expect(paras[0]).toBe('第一章 开始')
    expect(paras.slice(1)).toEqual(Array(6).fill(para))
  })

  it('leaves normal one-paragraph-per-line novels alone', () => {
    const lines = ['第一章 开始', ...Array.from({ length: 12 }, (_, i) => IND + `第${i}段。他走在路上。`)]
    expect(textToParagraphs(lines.join('\n')).length).toBe(13)
  })
})

describe('DOCX', () => {
  it('reads text boxes only once', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
    const docx = makeZip({
      'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:r><w:t>正文一段。</w:t></w:r><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:txbxContent><w:p><w:r><w:t>文本框</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent><w:p><w:r><w:t>文本框</w:t></w:r></w:p></w:txbxContent></mc:Fallback></mc:AlternateContent></w:r></w:p>
</w:body></w:document>`,
    })
    const parsed = await parseFile(fileFrom(docx, 'box.docx'))
    expect(parsed.blocks).toEqual(['正文一段。文本框'])
    expect(finalizeBook('x', parsed).blocks.length).toBe(1)
  })
})

import { makeWav } from '../src/tts/audio'

describe('silence used to keep audio alive', () => {
  it('is truly silent 16-bit PCM', async () => {
    const blob = makeWav(5)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const view = new DataView(bytes.buffer)
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF')
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(5 * 8000 * 2)
    expect(bytes.slice(44).every(b => b === 0)).toBe(true)
  })
})
