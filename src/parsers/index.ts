// 根据文件内容/扩展名选择解析器
import { unzipSync } from 'fflate'
import type { ParsedBook } from '../core/book'
import { decodeText, looksUtf16 } from './encoding'
import type { Progress } from './foliate'
import { parseMarkdown, parseTxt } from './txt'

export const ACCEPT = [
  '.epub', '.mobi', '.azw3', '.azw', '.kf8', '.prc', '.pdf', '.txt', '.fb2', '.fbz', '.docx',
  '.html', '.htm', '.xhtml', '.md', '.markdown', '.zip',
].join(',')

export const FORMAT_LABELS = 'EPUB、MOBI、AZW3、PDF、TXT、FB2、DOCX、HTML、Markdown'

export type BookFormat = 'epub' | 'mobi' | 'pdf' | 'txt' | 'fb2' | 'docx' | 'html' | 'md'

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)))

// 常见的不是电子书、或者读不了的文件（iPhone 上导入时不按扩展名过滤，选错了要能提示）
const UNSUPPORTED_EXT = new Set([
  'doc', 'rtf', 'pages', 'key', 'numbers', 'xls', 'xlsx', 'ppt', 'pptx', 'djvu', 'caj', 'kfx', 'cbz', 'cbr',
  'jpg', 'jpeg', 'png', 'gif', 'heic', 'webp', 'mp3', 'm4a', 'm4b', 'aac', 'wav', 'mp4', 'mov',
])

/** 文件开头有好几个 0 字节：二进制文件（UTF-16 文本除外） */
function looksBinary(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 4096)
  let zeros = 0
  for (const b of head) if (b === 0 && ++zeros >= 2) return !looksUtf16(head)
  return false
}

export function sniffFormat(bytes: Uint8Array, fileName: string): BookFormat | 'zip' | 'unsupported' {
  const ext = fileName.includes('.') ? (fileName.split('.').pop()?.toLowerCase() ?? '') : ''
  if (ascii(bytes, 0, 5) === '%PDF-') return 'pdf'
  if (ascii(bytes, 60, 68) === 'BOOKMOBI') return 'mobi'
  if (UNSUPPORTED_EXT.has(ext)) return 'unsupported'
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip'
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  if (/<FictionBook/i.test(head)) return 'fb2'
  if (['mobi', 'azw', 'azw3', 'kf8', 'prc'].includes(ext)) return 'mobi'
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html'
  if (['md', 'markdown'].includes(ext)) return 'md'
  if (ext === 'fb2') return 'fb2'
  if (/^\s*<!doctype html|^\s*<html/i.test(head)) return 'html'
  // 扩展名是 .txt 的按文本读；其它不认识的二进制文件不当文本读（否则会导入一堆乱码）
  if (ext !== 'txt' && looksBinary(bytes)) return 'unsupported'
  return 'txt'
}

/** MOBI / AZW3 的加密方式（0 表示没有加密）；从亚马逊买的书一般有 DRM 加密 */
export function mobiEncryption(bytes: Uint8Array): number {
  if (bytes.length < 82) return 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const record0 = view.getUint32(78)
  if (record0 + 14 > bytes.length) return 0
  return view.getUint16(record0 + 12)
}

export async function parseFile(file: File, onProgress?: Progress): Promise<ParsedBook & { format: BookFormat }> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const name = file.name
  const fallbackTitle = name.replace(/\.[^.]+$/, '')
  let format = sniffFormat(bytes, name)

  if (format === 'unsupported') {
    const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
    throw new Error(`不支持这种文件${ext ? `（${ext}）` : ''}。可以导入的格式：${FORMAT_LABELS}`)
  }

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
      if (mobiEncryption(bytes)) {
        throw new Error('这本 MOBI / AZW3 有 DRM 加密（一般是从亚马逊 Kindle 商店买的书），无法读取。可以换一个没有加密的版本，或者 EPUB 格式')
      }
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
