// HTML / XHTML 网页文件
import { BookBuilder, type ParsedBook } from '../core/book'
import { detectLang } from '../core/text'
import { extractBlocks, parseMarkup } from './dom'
import { decodeText, sniffDeclaredEncoding } from './encoding'
import { titleFromFileName } from './txt'

export function parseHtml(bytes: Uint8Array, fileName: string): ParsedBook {
  const text = decodeText(bytes, sniffDeclaredEncoding(bytes))
  const doc = parseMarkup(text, /\.xhtml?$/i.test(fileName))
  const builder = new BookBuilder()
  extractBlocks(doc.body ?? doc.documentElement, builder)
  const meta = titleFromFileName(fileName)
  const h1 = doc.querySelector('h1')?.textContent?.trim()
  const author = doc.querySelector('meta[name="author" i]')?.getAttribute('content') ?? ''
  return {
    title: doc.title?.trim() || h1 || meta.title,
    author: author || meta.author,
    lang: doc.documentElement.getAttribute('lang') || detectLang(builder.blocks.slice(0, 300).join('\n')),
    blocks: builder.blocks,
    heads: builder.heads,
    notes: builder.notes,
    toc: [],
  }
}
