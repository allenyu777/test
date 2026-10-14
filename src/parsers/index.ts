// 根据文件内容/扩展名选择解析器
import { unzipSync } from 'fflate'
import type { ParsedBook } from '../core/book'
import { decodeText } from './encoding'
import type { Progress } from './foliate'
import { parseMarkdown, parseTxt } from './txt'

export const ACCEPT = [
  '.epub', '.mobi', '.azw3', '.azw', '.kf8', '.prc', '.pdf', '.txt', '.fb2', '.fbz', '.docx',
  '.html', '.htm', '.xhtml', '.md', '.markdown',
].join(',')

export const FORMAT_LABELS = 'EPUB、MOBI、AZW3、PDF、TXT、FB2、DOCX、HTML、Markdown'

export type BookFormat = 'epub' | 'mobi' | 'pdf' | 'txt' | 'fb2' | 'docx' | 'html' | 'md'

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)))

export function sniffFormat(bytes: Uint8Array, fileName: string): BookFormat | 'zip' {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf'
  if (ascii(bytes, 60, 68) === 'BOOKMOBI') return 'mobi'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  if (/<FictionBook/i.test(head)) return 'fb2'
  if (['mobi', 'azw', 'azw3', 'kf8', 'prc'].includes(ext)) return 'mobi'
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html'
  if (['md', 'markdown'].includes(ext)) return 'md'
  if (ext === 'fb2') return 'fb2'
  if (/^\s*<!doctype html|^\s*<html/i.test(head)) return 'html'
  return 'txt'
}

export async function parseFile(file: File, onProgress?: Progress): Promise<ParsedBook & { format: BookFormat }> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const name = file.name
  const fallbackTitle = name.replace(/\.[^.]+$/, '')
  let format = sniffFormat(bytes, name)

  if (format === 'zip') {
    const names = new Set<string>()
    unzipSync(bytes, {
      filter: f => {
        names.add(f.name)
        return false
      },
    })
    if (names.has('META-INF/container.xml')) format = 'epub'
    else if (names.has('word/document.xml')) format = 'docx'
    else if ([...names].some(n => /\.fb2$/i.test(n))) {
      const { parseFbz } = await import('./foliate')
      return { ...(await parseFbz(buffer, fallbackTitle, onProgress)), format: 'fb2' }
    } else throw new Error('无法识别这个压缩文件的格式')
  }

  switch (format) {
    case 'epub': {
      const { parseEpub } = await import('./foliate')
      return { ...(await parseEpub(buffer, fallbackTitle, onProgress)), format }
    }
    case 'mobi': {
      const { parseMobi } = await import('./foliate')
      return { ...(await parseMobi(file, fallbackTitle, onProgress)), format }
    }
    case 'fb2': {
      const { parseFb2 } = await import('./foliate')
      return { ...(await parseFb2(file, fallbackTitle, onProgress)), format }
    }
    case 'pdf': {
      const { parsePdf } = await import('./pdf')
      return { ...(await parsePdf(buffer, name, onProgress)), format }
    }
    case 'docx': {
      const { parseDocx } = await import('./docx')
      return { ...parseDocx(buffer, name), format }
    }
    case 'html': {
      const { parseHtml } = await import('./html')
      return { ...parseHtml(bytes, name), format }
    }
    case 'md':
      return { ...parseMarkdown(decodeText(bytes), name), format }
    default:
      if (bytes.length && bytes.subarray(0, 4096).filter(b => b === 0).length > 64 && !/\.txt$/i.test(name)) {
        throw new Error('不支持这种文件格式')
      }
      return { ...parseTxt(decodeText(bytes), name), format: 'txt' }
  }
}
