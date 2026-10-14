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
const NOTE_TYPES = /\b(noteref|footnote|endnote|rearnote|doc-noteref|doc-footnote|doc-endnote|doc-backlink)\b/
const NOTE_MARK = /^\s*[[［(（【]?\s*(\d{1,3}|[a-z]|[*†‡§]+|注\s*\d*|[①-⑳])\s*[\]］)）】]?\s*$/i

/** 脚注引用、脚注正文等不朗读 */
function isNote(el: Element, tag: string): boolean {
  const type = `${el.getAttribute('epub:type') ?? ''} ${el.getAttributeNS?.(OPS_NS, 'type') ?? ''} ${el.getAttribute('role') ?? ''}`
  if (NOTE_TYPES.test(type)) return true
  const cls = el.getAttribute('class') ?? ''
  if (/duokan-footnote|footnote-content|^footnotes?$/i.test(cls)) return true
  if ((tag === 'sup' || (tag === 'a' && el.closest?.('sup'))) && NOTE_MARK.test(el.textContent ?? '')) return true
  return false
}

/**
 * 遍历文档，把块级元素转换成段落写入 builder。
 * marks 中的元素会被记录为它所在（或之后第一个）段落的序号，用于目录定位。
 */
export function extractBlocks(root: Node, builder: BookBuilder, marks?: Map<Element, number>): void {
  let buf = ''
  let head = 0
  let pre = 0

  const flush = () => {
    if (buf) {
      builder.add(buf, head || undefined)
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
    if (SKIP_TAGS.has(tag) || isNote(el, tag)) {
      if (marks?.has(el)) marks.set(el, builder.length)
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
