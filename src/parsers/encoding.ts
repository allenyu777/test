// 文本编码识别：UTF-8 / UTF-16 / GBK(GB18030) / Big5 / Windows-1252

const COMMON =
  '的一是了不在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日意无力它与长把机' +
  '這個們來為國說時會對於著過發後裡種經麼學現當沒動還進樣開從實無與長機'
const COMMON_SET = new Set(COMMON)
const REPLACEMENT = String.fromCharCode(0xfffd)

function tryDecode(bytes: Uint8Array, label: string, fatal = false): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(bytes)
  } catch {
    return null
  }
}

function score(text: string): number {
  let s = 0
  for (const ch of text) {
    if (COMMON_SET.has(ch)) s += 1
    else if (ch === REPLACEMENT) s -= 3
  }
  return s
}

function looksUtf16(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(bytes.length, 4096) & ~1
  if (n < 8) return null
  let evenZero = 0
  let oddZero = 0
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) evenZero++
    if (bytes[i + 1] === 0) oddZero++
  }
  const half = n / 2
  if (oddZero / half > 0.3 && evenZero / half < 0.05) return 'utf-16le'
  if (evenZero / half > 0.3 && oddZero / half < 0.05) return 'utf-16be'
  return null
}

/** 识别并解码文本文件 */
export function decodeText(input: ArrayBuffer | Uint8Array, hint?: string | null): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return tryDecode(bytes.subarray(3), 'utf-8') ?? ''
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return tryDecode(bytes.subarray(2), 'utf-16le') ?? ''
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return tryDecode(bytes.subarray(2), 'utf-16be') ?? ''

  const utf8 = tryDecode(bytes, 'utf-8', true)
  if (utf8 !== null) return utf8

  if (hint) {
    const hinted = tryDecode(bytes, hint)
    if (hinted !== null && !/^utf-?8$/i.test(hint)) return hinted
  }

  const utf16 = looksUtf16(bytes)
  if (utf16) return tryDecode(bytes, utf16) ?? ''

  // 基本是 UTF-8，只有个别坏字节或结尾被截断：按 UTF-8 宽松解码
  const loose = tryDecode(bytes, 'utf-8') ?? ''
  let bad = 0
  let multi = 0
  for (const ch of loose) {
    if (ch === REPLACEMENT) bad++
    else if (ch.charCodeAt(0) > 0x7f) multi++
  }
  if (multi > 0 && bad <= Math.max(4, multi / 200)) return loose

  const sample = bytes.subarray(0, 64 * 1024)
  const candidates = ['gb18030', 'big5']
    .map(label => ({ label, text: tryDecode(sample, label) }))
    .filter((c): c is { label: string; text: string } => c.text !== null)
    .map(c => ({ ...c, score: score(c.text) }))
    .sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (best && best.score > 5) return tryDecode(bytes, best.label) ?? ''
  return tryDecode(bytes, 'windows-1252') ?? tryDecode(bytes, 'utf-8') ?? ''
}

/** 从 HTML/XML 头部读取声明的编码 */
export function sniffDeclaredEncoding(bytes: Uint8Array): string | null {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
  const m =
    head.match(/<\?xml[^>]*encoding\s*=\s*["']([\w.-]+)["']/i) ||
    head.match(/<meta[^>]*charset\s*=\s*["']?([\w.-]+)/i)
  return m ? m[1].toLowerCase() : null
}
