import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Book, finalizeBook } from '../src/core/book'
import { decodeText } from '../src/parsers/encoding'
import { mobiEncryption, parseFile, sniffFormat } from '../src/parsers'
import { groupLines, linesToParagraphs, stripHeadersFooters } from '../src/parsers/pdf'
import { BookBuilder } from '../src/core/book'
import { titleFromFileName } from '../src/parsers/txt'
import { fileFrom, makeEpub, makeMobi, makeZip } from './helpers'

const fixture = (name: string) => new Uint8Array(readFileSync(`${process.cwd()}/tests/fixtures/${name}`))

describe('encoding', () => {
  it('decodes GBK and Big5 text', () => {
    expect(decodeText(fixture('gbk-novel.txt'))).toContain('天色渐渐暗了下来')
    expect(decodeText(fixture('big5-novel.txt'))).toContain('這是一個繁體中文的測試文件')
  })
  it('decodes UTF-16 with BOM', () => {
    const s = '你好，世界'
    const buf = new Uint8Array(2 + s.length * 2)
    buf[0] = 0xff
    buf[1] = 0xfe
    for (let i = 0; i < s.length; i++) {
      buf[2 + i * 2] = s.charCodeAt(i) & 0xff
      buf[3 + i * 2] = s.charCodeAt(i) >> 8
    }
    expect(decodeText(buf)).toBe(s)
  })
})

describe('TXT', () => {
  it('parses a GBK novel with chapters', async () => {
    const parsed = await parseFile(fileFrom(fixture('gbk-novel.txt'), '《测试小说》作者：张三.txt'))
    expect(parsed.title).toBe('测试小说')
    expect(parsed.author).toBe('张三')
    expect(parsed.lang).toBe('zh')
    const content = finalizeBook('t1', parsed)
    expect(content.toc.map(t => t.title)).toEqual(['内容简介', '第一章 初到京城', '第二章 风雨欲来', '第三章 尘埃落定'])
    expect(content.blocks).toContain('“这里就是京城吗？”他问道。')
  })

  it('joins hard-wrapped English paragraphs', async () => {
    const parsed = await parseFile(fileFrom(fixture('wrapped-english.txt'), 'tale.txt'))
    expect(parsed.lang).toBe('en')
    const content = finalizeBook('t2', parsed)
    expect(content.toc.map(t => t.title)).toEqual(['CHAPTER I', 'CHAPTER II'])
    const para = content.blocks.find(b => b.startsWith('It was the best'))!
    expect(para).toContain('age of wisdom, it was')
    expect(para.endsWith('epoch of incredulity.')).toBe(true)
  })

  it('extracts title and author from file names', () => {
    expect(titleFromFileName('《三体》作者：刘慈欣.txt')).toEqual({ title: '三体', author: '刘慈欣' })
    expect(titleFromFileName('《活着》余华.txt')).toEqual({ title: '活着', author: '余华' })
    expect(titleFromFileName('斗破苍穹_全本.txt').title).toBe('斗破苍穹')
  })
})

describe('EPUB', () => {
  const epub = makeEpub({
    'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:1234</dc:identifier>
    <dc:title>测试之书</dc:title>
    <dc:creator>李四</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`,
    'OEBPS/nav.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head>
<body><nav epub:type="toc"><ol>
  <li><a href="text/ch1.xhtml">第一章 开端</a>
    <ol><li><a href="text/ch1.xhtml#s2">第二节 转折</a></li></ol></li>
  <li><a href="text/ch%202.xhtml">第二章 结局</a></li>
</ol></nav></body></html>`,
    'OEBPS/text/ch1.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>第一章</title><style>p{}</style></head>
<body>
  <h1>第一章 开端</h1>
  <p>　　春天来了，<ruby>燕<rt>yàn</rt></ruby>子飞回来了。<a epub:type="noteref" href="#n1">[1]</a>小草也绿了。</p>
  <p>第二段
  文字。</p>
  <h2 id="s2">第二节 转折</h2>
  <p>天气突然变冷了。<br/>大家都穿上了棉衣。</p>
  <aside epub:type="footnote" id="n1"><p>这是一个脚注。</p></aside>
</body></html>`,
    'OEBPS/text/ch 2.xhtml': `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head>
<body><h1>第二章 结局</h1><p>故事结束了&#12290;</p></body></html>`,
  })

  it('extracts blocks, headings and TOC', async () => {
    const parsed = await parseFile(fileFrom(epub, 'test.epub'))
    expect(parsed.format).toBe('epub')
    expect(parsed.title).toBe('测试之书')
    expect(parsed.author).toBe('李四')
    expect(parsed.lang).toBe('zh-CN')
    expect(parsed.blocks).toEqual([
      '第一章 开端',
      // 注释编号显示成上标、脚注显示成小字，朗读时都跳过
      '春天来了，燕子飞回来了。¹小草也绿了。',
      '第二段文字。',
      '第二节 转折',
      '天气突然变冷了。',
      '大家都穿上了棉衣。',
      '这是一个脚注。',
      '第二章 结局',
      '故事结束了。',
    ])
    expect(parsed.notes).toEqual([6])
    expect(parsed.heads[0]).toBe(1)
    expect(parsed.heads[3]).toBe(2)
    expect(parsed.toc).toEqual([
      { title: '第一章 开端', b: 0, level: 0 },
      { title: '第二节 转折', b: 3, level: 1 },
      { title: '第二章 结局', b: 7, level: 0 },
    ])
    const book = new Book(finalizeBook('e1', parsed))
    expect(book.chapterTitle(4)).toBe('第二节 转折')
    expect(book.sections.length).toBe(3)
  })
})

describe('MOBI', () => {
  it('parses a MOBI6 file with an HTML table of contents', async () => {
    const html = `<html><head><guide><reference type="toc" title="Contents" filepos="@toc" /></guide></head><body>
<a id="@toc"></a><p>Contents</p>
<p><a filepos="@c1">Chapter One</a></p>
<p><a filepos="@c2">Chapter Two</a></p>
<mbp:pagebreak/>
<a id="@c1"></a><h2>Chapter One</h2><p>It was a dark and stormy night. 风雨交加。</p>
<mbp:pagebreak/>
<a id="@c2"></a><h2>Chapter Two</h2><p>${'Morning came at last. '.repeat(300)}</p>
</body></html>`
    const bytes = makeMobi({ title: 'Stormy Night', author: 'Jane Doe', html })
    const parsed = await parseFile(fileFrom(bytes, 'stormy.mobi'))
    expect(parsed.format).toBe('mobi')
    expect(parsed.title).toBe('Stormy Night')
    expect(parsed.author).toBe('Jane Doe')
    expect(parsed.blocks).toContain('It was a dark and stormy night. 风雨交加。')
    const c1 = parsed.blocks.indexOf('Chapter One', 3)
    const c2 = parsed.blocks.indexOf('Chapter Two', 3)
    expect(parsed.toc.map(t => [t.title, t.b])).toEqual([
      ['Chapter One', c1],
      ['Chapter Two', c2],
    ])
  })
})

describe('FB2', () => {
  it('parses FictionBook sections', async () => {
    const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><author><first-name>Ivan</first-name><last-name>Petrov</last-name></author>
<book-title>Winter Tale</book-title><lang>en</lang></title-info></description>
<body>
<section><title><p>Chapter 1</p></title><p>Snow fell softly.</p><p>The night was <emphasis>quiet</emphasis>.</p></section>
<section><title><p>Chapter 2</p></title><p>Spring arrived.</p></section>
</body></FictionBook>`
    const parsed = await parseFile(fileFrom(fb2, 'winter.fb2'))
    expect(parsed.format).toBe('fb2')
    expect(parsed.title).toBe('Winter Tale')
    expect(parsed.author).toBe('Ivan Petrov')
    expect(parsed.blocks).toEqual(['Chapter 1', 'Snow fell softly.', 'The night was quiet.', 'Chapter 2', 'Spring arrived.'])
    expect(parsed.toc.map(t => [t.title, t.b])).toEqual([
      ['Chapter 1', 0],
      ['Chapter 2', 3],
    ])
  })
})

describe('DOCX', () => {
  it('uses heading styles as chapters', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    const docx = makeZip({
      'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>第一部分</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">这是正文，</w:t></w:r><w:r><w:t>第二句。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>第二部分</w:t></w:r></w:p>
<w:p><w:r><w:t>更多的正文。</w:t><w:br/><w:t>换行之后。</w:t></w:r></w:p>
</w:body></w:document>`,
      'word/styles.xml': `<?xml version="1.0"?><w:styles ${W}>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/></w:style>
</w:styles>`,
      'docProps/core.xml': `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>我的文档</dc:title><dc:creator>王五</dc:creator></cp:coreProperties>`,
    })
    const parsed = await parseFile(fileFrom(docx, 'doc.docx'))
    expect(parsed.format).toBe('docx')
    expect(parsed.title).toBe('我的文档')
    expect(parsed.author).toBe('王五')
    expect(parsed.blocks).toEqual(['第一部分', '这是正文，第二句。', '第二部分', '更多的正文。', '换行之后。'])
    const content = finalizeBook('d1', parsed)
    expect(content.toc.map(t => t.title)).toEqual(['第一部分', '第二部分'])
  })
})

describe('HTML and Markdown', () => {
  it('parses HTML with headings', async () => {
    const html = '<html lang="en"><head><title>Essay</title><meta name="author" content="Ann"></head><body><h1>Intro</h1><p>Hello <b>world</b>.</p><script>x()</script><h1>End</h1><p>Bye.</p></body></html>'
    const parsed = await parseFile(fileFrom(html, 'essay.html'))
    expect(parsed.title).toBe('Essay')
    expect(parsed.author).toBe('Ann')
    expect(parsed.blocks).toEqual(['Intro', 'Hello world.', 'End', 'Bye.'])
    expect(finalizeBook('h1', parsed).toc.map(t => t.b)).toEqual([0, 2])
  })
  it('parses Markdown', async () => {
    const md = '# 标题\n\n第一段 **加粗** 和 [链接](http://x)。\n\n## 小节\n\n- 列表项\n\n```\ncode\n```\n'
    const parsed = await parseFile(fileFrom(md, 'note.md'))
    expect(parsed.title).toBe('标题')
    expect(parsed.blocks).toEqual(['标题', '第一段 加粗 和 链接。', '小节', '列表项', 'code'])
  })
})

describe('PDF text assembly', () => {
  const item = (str: string, x: number, y: number, width: number, hasEOL = true) => ({
    str,
    transform: [12, 0, 0, 12, x, y],
    width,
    height: 12,
    hasEOL,
  })

  it('merges lines into paragraphs and drops page numbers', () => {
    const page1 = groupLines([
      item('第一章 起点', 72, 760, 80),
      item('　　这是第一段的第一行文字，它会一直延续到', 72, 730, 400),
      item('第二行。', 72, 712, 50),
      item('　　这是第二段，内容很短，但是一直写到了行尾这里', 72, 694, 400),
      item('还没有结束', 72, 676, 400),
      item('1', 300, 40, 6),
    ])
    const page2 = groupLines([
      item('跨页继续的文字。', 72, 760, 100),
      item('2', 300, 40, 6),
    ])
    const builder = new BookBuilder()
    const starts = linesToParagraphs(stripHeadersFooters([page1, page2]), builder)
    expect(builder.blocks).toEqual([
      '第一章 起点',
      '这是第一段的第一行文字，它会一直延续到第二行。',
      '这是第二段，内容很短，但是一直写到了行尾这里还没有结束跨页继续的文字。',
    ])
    expect(builder.heads[0]).toBe(2)
    expect(starts).toEqual([0, 2])
  })
})

describe('Book navigation', () => {
  it('moves between sentences and computes progress', async () => {
    const parsed = await parseFile(fileFrom('第一句。第二句！\n* * *\n第三句？', 'a.txt'))
    const book = new Book(finalizeBook('n1', parsed))
    let pos = book.speakableFrom({ b: 0, o: 0 })!
    expect(book.sentenceText(pos)).toBe('第一句。')
    pos = book.next(pos)!
    expect(book.sentenceText(pos)).toBe('第二句！')
    pos = book.next(pos)!
    expect(book.sentenceText(pos)).toBe('第三句？')
    expect(book.next(pos)).toBeNull()
    expect(book.sentenceText(book.prev(pos)!)).toBe('第二句！')
    expect(book.percent({ b: 2, o: 0 })).toBeCloseTo((8 + 5) / 17 * 100, 1)
    expect(book.posAtPercent(80)).toEqual({ b: 2, o: 0 })
  })
})

describe('choosing any file on iPhone', () => {
  it('refuses photos, audio and other binary files instead of reading them as text', () => {
    // 照片开头：JPEG 标记加上 EXIF 数据（里面有很多 0 字节）
    const jpeg = new Uint8Array(512)
    jpeg.set([0xff, 0xd8, 0xff, 0xe1, 0x01, 0xfe, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a])
    for (let i = 16; i < 512; i++) jpeg[i] = (i * 37) % 7 === 0 ? 0 : (i * 91) % 251
    expect(sniffFormat(jpeg, 'IMG_0001.JPG')).toBe('unsupported')
    expect(sniffFormat(jpeg, 'something')).toBe('unsupported')
    expect(sniffFormat(new TextEncoder().encode('{\\rtf1 hello}'), 'notes.rtf')).toBe('unsupported')
  })
  it('still reads text, UTF-16 text and books', () => {
    expect(sniffFormat(new TextEncoder().encode('第一章 开始\n正文。'), 'book')).toBe('txt')
    const utf16 = new Uint8Array([...'Chapter One. It was a dark and stormy night.'].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8]))
    expect(sniffFormat(utf16, 'book.dat')).toBe('txt')
    // 扩展名是 .txt 的总是按文本读（中文 UTF-16）
    const zh = new Uint8Array([0xff, 0xfe, ...[...'第一章 开始，正文。'].flatMap(c => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])])
    expect(sniffFormat(zh, 'book.txt')).toBe('txt')
    const mobi = makeMobi({ title: 'T', author: 'A', html: '<p>Hello.</p>' })
    expect(sniffFormat(mobi, 'x.azw3')).toBe('mobi')
  })
  it('detects DRM-encrypted MOBI files', () => {
    const mobi = makeMobi({ title: 'T', author: 'A', html: '<p>Hello.</p>' })
    expect(mobiEncryption(mobi)).toBe(0)
    const locked = mobi.slice()
    const record0 = new DataView(locked.buffer).getUint32(78)
    new DataView(locked.buffer).setUint16(record0 + 12, 2)
    expect(mobiEncryption(locked)).toBe(2)
  })
})
