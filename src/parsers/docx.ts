// Word 文档（.docx）
import { unzipSync } from 'fflate'
import { BookBuilder, type ParsedBook } from '../core/book'
import { detectLang } from '../core/text'
import { titleFromFileName } from './txt'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DC = 'http://purl.org/dc/elements/1.1/'

function wAttr(el: Element | undefined, name: string): string | null {
  if (!el) return null
  return el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`)
}

function headingStyles(stylesXml: Document | null): Map<string, number> {
  const map = new Map<string, number>()
  if (!stylesXml) return map
  for (const style of Array.from(stylesXml.getElementsByTagNameNS(W, 'style'))) {
    const id = wAttr(style, 'styleId')
    const name = wAttr(style.getElementsByTagNameNS(W, 'name')[0], 'val') ?? ''
    const outline = wAttr(style.getElementsByTagNameNS(W, 'outlineLvl')[0], 'val')
    let level = 0
    const m = name.match(/^heading\s*(\d)$/i) || name.match(/^标题\s*(\d)$/)
    if (m) level = Number(m[1])
    else if (/^(title|标题)$/i.test(name)) level = 1
    else if (outline != null && Number(outline) < 9) level = Number(outline) + 1
    if (id && level) map.set(id, Math.min(6, level))
  }
  return map
}

function hasParagraphAncestor(el: Element): boolean {
  for (let a = el.parentElement; a; a = a.parentElement) {
    if (a.namespaceURI === W && a.localName === 'p') return true
  }
  return false
}

export function parseDocx(buffer: ArrayBuffer, fileName: string): ParsedBook {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: f => /^(word\/(document|styles)\.xml|docProps\/core\.xml)$/.test(f.name),
  })
  if (!files['word/document.xml']) throw new Error('这不是有效的 Word 文档')
  const parser = new DOMParser()
  const decoder = new TextDecoder()
  const parse = (name: string) =>
    files[name] ? parser.parseFromString(decoder.decode(files[name]), 'application/xml') : null
  const doc = parse('word/document.xml')!
  const styles = headingStyles(parse('word/styles.xml'))
  const builder = new BookBuilder()

  const body = doc.getElementsByTagNameNS(W, 'body')[0] ?? doc.documentElement
  for (const p of Array.from(body.getElementsByTagNameNS(W, 'p'))) {
    // 文本框里的段落会包含在外层段落中，跳过以免重复
    if (hasParagraphAncestor(p)) continue
    let text = ''
    for (const el of Array.from(p.getElementsByTagNameNS(W, '*'))) {
      switch (el.localName) {
        case 't':
          text += el.textContent ?? ''
          break
        case 'tab':
          text += ' '
          break
        case 'br':
        case 'cr':
          text += '\n'
          break
        case 'noBreakHyphen':
          text += '-'
          break
      }
    }
    const pPr = p.getElementsByTagNameNS(W, 'pPr')[0]
    const styleId = wAttr(pPr?.getElementsByTagNameNS(W, 'pStyle')[0], 'val')
    const outline = wAttr(pPr?.getElementsByTagNameNS(W, 'outlineLvl')[0], 'val')
    let level = styleId ? styles.get(styleId) : undefined
    if (!level && outline != null && Number(outline) < 9) level = Number(outline) + 1
    for (const line of text.split('\n')) builder.add(line, level)
  }

  const core = parse('docProps/core.xml')
  const meta = titleFromFileName(fileName)
  return {
    title: core?.getElementsByTagNameNS(DC, 'title')[0]?.textContent?.trim() || meta.title,
    author: core?.getElementsByTagNameNS(DC, 'creator')[0]?.textContent?.trim() || meta.author,
    lang: detectLang(builder.blocks.slice(0, 300).join('\n')),
    blocks: builder.blocks,
    heads: builder.heads,
    toc: [],
  }
}
