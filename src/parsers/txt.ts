// TXT / Markdown 解析
import { BookBuilder, type ParsedBook } from '../core/book'
import { chapterLevel } from '../core/chapters'
import { cjkRatio, detectLang } from '../core/text'

/** 从文件名中提取书名和作者，例如《三体》作者：刘慈欣.txt */
export function titleFromFileName(name: string): { title: string; author: string } {
  let base = name.replace(/\.[^.]+$/, '').trim()
  let author = ''
  const authorMatch = base.match(/[（(\[【]?\s*(?:作者|著者)\s*[:：]\s*([^）)\]】]+)[）)\]】]?/)
  if (authorMatch) {
    author = authorMatch[1].trim()
    base = base.replace(authorMatch[0], '').trim()
  }
  const quoted = base.match(/《([^》]+)》/)
  if (quoted) {
    if (!author) {
      const rest = base.replace(quoted[0], '').replace(/^[\s_\-—·]+|[\s_\-—·]+$/g, '')
      if (rest && rest.length <= 20 && !/全本|完本|精校|校对|txt|版/i.test(rest)) author = rest
    }
    base = quoted[1]
  }
  base = base.replace(/[_\s]*(全本|完本|精校版?|校对版?|全集|TXT|txt)[_\s]*$/g, '').trim()
  return { title: base || name, author }
}

function findAuthor(lines: string[]): string {
  for (const line of lines.slice(0, 30)) {
    const m = line.match(/^\s*(?:作者|著者|author|by)\s*[:：]\s*(.{1,30})$/i)
    if (m) return m[1].trim()
  }
  return ''
}

/**
 * 把纯文本拆成段落。
 * 若文本是"空行分段、行内硬换行"（如古腾堡英文书），会把同一段的行合并。
 */
const MAX_LINE = 3000
const SENTENCE_END_RE = /[。！？!?…”」』]\s*$/

/** 没有换行的超长"行"（整本书一行）按段首缩进或句末切开，避免一个段落几十万字 */
function splitLongLine(line: string): string[] {
  if (line.length <= MAX_LINE) return [line]
  const out: string[] = []
  for (const piece of line.split(/(?=\u3000\u3000)|\s{4,}/)) {
    if (piece.length <= MAX_LINE) {
      out.push(piece)
      continue
    }
    let start = 0
    const re = /[。！？!?…]+[”」』"']?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(piece))) {
      const end = m.index + m[0].length
      if (end - start >= 500) {
        out.push(piece.slice(start, end))
        start = end
      }
    }
    if (start < piece.length) out.push(piece.slice(start))
  }
  return out
}

/**
 * 中文硬换行文本：段首有缩进，段内每行在固定宽度处断开（行很长且不以句末标点结尾）。
 * 把这种行接回同一段。
 */
function joinIndentedWrapped(lines: string[]): string[] | null {
  const nonBlank = lines.filter(l => l.trim())
  if (nonBlank.length < 10) return null
  const indentedRe = /^(\u3000|\s{2,})/
  const indented = nonBlank.filter(l => indentedRe.test(l)).length / nonBlank.length
  if (indented < 0.05 || indented > 0.7) return null
  const lengths = nonBlank.map(l => l.trim().length).sort((a, b) => a - b)
  const p90 = lengths[Math.floor(lengths.length * 0.9)] ?? 0
  if (p90 < 10) return null
  const isFull = (l: string) => l.trim().length >= p90 * 0.85 && !SENTENCE_END_RE.test(l)
  // 非缩进行中，大多数紧跟在一个"写满且没结束"的行后面
  let follow = 0
  let total = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim() || indentedRe.test(line)) continue
    total++
    if (lines[i - 1].trim() && isFull(lines[i - 1])) follow++
  }
  if (total < 5 || follow / total < 0.6) return null

  const out: string[] = []
  let cur = ''
  let curIsHead = false
  let prev = ''
  for (const line of lines) {
    if (!line.trim()) {
      if (cur) out.push(cur)
      cur = ''
      prev = ''
      continue
    }
    const t = line.trim()
    const isHead = chapterLevel(t) >= 0
    const startNew =
      !cur || indentedRe.test(line) || !isFull(prev) || isHead || curIsHead || cur.length + t.length > MAX_LINE
    if (startNew) {
      if (cur) out.push(cur)
      cur = t
      curIsHead = isHead
    } else cur += t
    prev = line
  }
  if (cur) out.push(cur)
  return out
}

export function textToParagraphs(text: string): string[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap(splitLongLine)
  const nonBlank = lines.filter(l => l.trim())
  if (!nonBlank.length) return []
  const blank = lines.length - nonBlank.length

  // 统计空行分隔的块
  const groups: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim()) current.push(line)
    else if (current.length) {
      groups.push(current)
      current = []
    }
  }
  if (current.length) groups.push(current)
  // 大部分行都属于多行的块，且行都不长，说明是硬换行排版
  const inMultiLine = groups.filter(g => g.length >= 2).reduce((sum, g) => sum + g.length, 0)
  const lengths = nonBlank.map(l => l.trim().length).sort((a, b) => a - b)
  const p90 = lengths[Math.floor(lengths.length * 0.9)] ?? 0
  // 硬换行的文本，大多数行在句子中间断开，并且行首没有段落缩进
  const endsSentence = nonBlank.filter(l => /[。！？.!?"”’'」』…:：)）]\s*$/.test(l)).length / nonBlank.length
  const indented = nonBlank.filter(l => /^(\u3000|\s{2,})/.test(l)).length / nonBlank.length
  const wrapped =
    blank / lines.length > 0.08 &&
    inMultiLine / nonBlank.length >= 0.6 &&
    p90 <= 100 &&
    endsSentence < 0.5 &&
    indented < 0.3

  const cjk = cjkRatio(text.slice(0, 20000)) > 0.3
  if (!wrapped) {
    const joined = cjk ? joinIndentedWrapped(lines) : null
    return joined ?? nonBlank.map(l => l.trim())
  }

  return groups.map(group => {
    let out = ''
    for (const raw of group) {
      const line = raw.trim()
      if (!out) out = line
      else if (cjk) out += line
      else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line
      else out += ' ' + line
    }
    return out
  })
}

export function parseTxt(text: string, fileName: string): ParsedBook {
  const paragraphs = textToParagraphs(text)
  const builder = new BookBuilder()
  for (const p of paragraphs) builder.add(p)
  const meta = titleFromFileName(fileName)
  return {
    title: meta.title,
    author: meta.author || findAuthor(paragraphs),
    lang: detectLang(paragraphs.slice(0, 300).join('\n')),
    blocks: builder.blocks,
    heads: builder.heads,
    toc: [],
  }
}

/** Markdown：# 标题作为章节，去掉常见的标记符号 */
export function parseMarkdown(text: string, fileName: string): ParsedBook {
  const builder = new BookBuilder()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let inCode = false
  const flush = () => {
    if (para.length) builder.add(para.join(' '))
    para = []
  }
  const inline = (s: string) =>
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/(\*\*|__|~~|`)/g, '')
      .replace(/(^|\s)[*_](\S[^*_]*)[*_](?=\s|$|[，。,.!?])/g, '$1$2')
  let title = ''
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCode = !inCode
      flush()
      continue
    }
    if (inCode) {
      builder.add(line)
      continue
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (h) {
      flush()
      const text = inline(h[2])
      if (!title && h[1].length === 1) title = text
      builder.add(text, h[1].length)
      continue
    }
    if (!line.trim() || /^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      flush()
      continue
    }
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (item) {
      flush()
      para.push(inline(item[1]))
      flush()
      continue
    }
    para.push(inline(line.replace(/^\s*>\s?/, '')))
  }
  flush()
  const meta = titleFromFileName(fileName)
  return {
    title: title || meta.title,
    author: meta.author,
    lang: detectLang(builder.blocks.slice(0, 300).join('\n')),
    blocks: builder.blocks,
    heads: builder.heads,
    toc: [],
  }
}
