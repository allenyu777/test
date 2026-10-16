// 从 HTML/XHTML 文档中提取段落（EPUB、MOBI、FB2、HTML 共用）
import type { BookBuilder } from '../core/book'

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'br', 'caption', 'center', 'dd', 'details', 'dialog',
  'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hgroup', 'hr', 'html', 'legend', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

const SKIP_TAGS = new Set([
  'head', 'script', 'style', 'title', 'noscript', 'template', 'rt', 'rp', 'svg', 'math', 'iframe', 'object',
  'video', 'audio', 'button', 'input', 'select', 'textarea', 'img', 'image', 'link', 'meta',
])

const OPS_NS = 'http://www.idpf.org/2007/ops'
const NOTE_BODY_TYPES = /\b(footnotes?|endnotes?|rearnotes?|doc-footnote|doc-endnotes?)\b/
const NOTE_REF_TYPES = /\b(noteref|doc-noteref)\b/
const NOTE_MARK = /^\s*[[［(（【]?\s*(\d{1,3}|[a-z]|[*†‡§]+|注\s*\d*|[①-⑳])\s*[\]］)）】]?\s*$/i
const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹'

/**
 * 脚注相关的元素：ref 正文里的注释编号（显示成上标数字）、body 脚注正文（显示成小字）、
 * skip 返回原文的链接等（不显示）。朗读时都跳过。
 */
function noteKind(el: Element, tag: string): 'ref' | 'body' | 'skip' | null {
  const type = `${el.getAttribute('epub:type') ?? ''} ${el.getAttributeNS?.(OPS_NS, 'type') ?? ''} ${el.getAttribute('role') ?? ''}`
  const cls = el.getAttribute('class') ?? ''
  if (/\bdoc-backlink\b/.test(type)) return 'skip'
  if (NOTE_BODY_TYPES.test(type) || /duokan-footnote-(content|item)|footnote-content|^footnotes?$/i.test(cls)) return 'body'
  if (NOTE_REF_TYPES.test(type) || /\bduokan-footnote\b/i.test(cls)) return 'ref'
  if ((tag === 'sup' || (tag === 'a' && el.closest?.('sup'))) && NOTE_MARK.test(el.textContent ?? '')) return 'ref'
  return null
}

/** 注释编号：数字显示成上标（朗读时跳过），其它（图片、字母、星号）不显示 */
function refText(el: Element): string {
  const digits = (el.textContent ?? '').replace(/\D/g, '')
  return digits.length >= 1 && digits.length <= 3 ? digits.replace(/\d/g, d => SUPERSCRIPT_DIGITS[+d]) : ''
}

/**
 * 遍历文档，把块级元素转换成段落写入 builder。
 * marks 中的元素会被记录为它所在（或之后第一个）段落的序号，用于目录定位。
 */
export function extractBlocks(root: Node, builder: BookBuilder, marks?: Map<Element, number>): void {
  let buf = ''
  let head = 0
  let pre = 0
  let note = 0

  const flush = () => {
    if (buf) {
      builder.add(buf, head || undefined, note > 0)
      buf = ''
    }
  }

  const walk = (node: Node) => {
    const type = node.nodeType
    if (type === 3 || type === 4) {
      const data = (node as CharacterData).data
      if (pre && data.includes('\n')) {
        const lines = data.split('\n')
        lines.forEach((line, i) => {
          if (i > 0) flush()
          buf += line
        })
      } else buf += data
      return
    }
    if (type === 9 || type === 11) {
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c)
      return
    }
    if (type !== 1) return
    const el = node as Element
    const tag = (el.localName || el.nodeName).toLowerCase().replace(/^.*:/, '')
    const kind = noteKind(el, tag)
    if (SKIP_TAGS.has(tag) || kind === 'skip' || kind === 'ref') {
      if (marks?.has(el)) marks.set(el, builder.length)
      if (kind === 'ref') buf += refText(el)
      return
    }
    if (kind === 'body') {
      flush()
      if (marks?.has(el)) marks.set(el, builder.length)
      note++
      for (let c = el.firstChild; c; c = c.nextSibling) walk(c)
      flush()
      note--
      return
    }
    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock) flush()
    if (marks?.has(el)) marks.set(el, builder.length)
    if (tag === 'br' || tag === 'hr') return
    const prevHead = head
    if (/^h[1-6]$/.test(tag)) head = Number(tag[1])
    if (tag === 'pre') pre++
    for (let c = el.firstChild; c; c = c.nextSibling) walk(c)
    if (tag === 'pre') pre--
    if (isBlock) flush()
    head = prevHead
  }

  walk(root)
  flush()
}

/** 解析 XHTML，失败时退回 HTML 解析 */
export function parseMarkup(text: string, preferXml = true): Document {
  const parser = new DOMParser()
  if (preferXml) {
    const doc = parser.parseFromString(text, 'application/xhtml+xml')
    if (!doc.getElementsByTagName('parsererror').length && doc.documentElement) return doc
  }
  return parser.parseFromString(text, 'text/html')
}

export function hasParserError(doc: Document): boolean {
  return doc.getElementsByTagName('parsererror').length > 0
}
