// 测试用的电子书生成工具
import { strToU8, zipSync } from 'fflate'

export function makeEpub(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = { mimetype: strToU8('application/epub+zip') }
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content)
  return zipSync(entries)
}

export function makeZip(files: Record<string, string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content)
  return zipSync(entries)
}

/** PalmDOC "压缩"：只用字面量转义，足够验证解压流程 */
function palmdocLiteral(bytes: Uint8Array): Uint8Array {
  const out: number[] = []
  for (const b of bytes) {
    if (b === 0 || (b >= 0x09 && b <= 0x7f)) out.push(b)
    else out.push(1, b)
  }
  return Uint8Array.from(out)
}

/**
 * 生成一个最小的 MOBI6 文件。
 * html 中可以用 filepos="@name" 引用 id="@name" 标记的位置（标记会被移除）。
 */
export function makeMobi(opts: { title: string; author: string; html: string }): Uint8Array {
  const enc = new TextEncoder()
  // 计算 filepos 字节偏移
  let html = opts.html
  const targets = new Map<string, number>()
  const markerRe = /<a id="@(\w+)"><\/a>/
  for (;;) {
    const m = html.match(markerRe)
    if (!m) break
    targets.set(m[1], -1)
    const before = html.slice(0, m.index)
    html = before + html.slice(m.index! + m[0].length)
    targets.set(m[1], enc.encode(before.replace(/filepos="@\w+"/g, 'filepos=0000000000')).length)
  }
  html = html.replace(/filepos="@(\w+)"/g, (_, name) => `filepos=${String(targets.get(name)).padStart(10, '0')}`)
  const text = enc.encode(html)
  const records: Uint8Array[] = []
  for (let i = 0; i < text.length; i += 4096) records.push(palmdocLiteral(text.subarray(i, i + 4096)))

  const exthItems: [number, Uint8Array][] = [
    [100, enc.encode(opts.author)],
    [503, enc.encode(opts.title)],
    [524, enc.encode('en')],
  ]
  let exthLen = 12 + exthItems.reduce((s, [, d]) => s + 8 + d.length, 0)
  const exthPad = (4 - (exthLen % 4)) % 4
  exthLen += exthPad
  const exth = new Uint8Array(exthLen)
  const ev = new DataView(exth.buffer)
  exth.set(enc.encode('EXTH'), 0)
  ev.setUint32(4, exthLen)
  ev.setUint32(8, exthItems.length)
  let off = 12
  for (const [type, data] of exthItems) {
    ev.setUint32(off, type)
    ev.setUint32(off + 4, 8 + data.length)
    exth.set(data, off + 8)
    off += 8 + data.length
  }

  const titleBytes = enc.encode(opts.title)
  const mobiLen = 232
  const titleOffset = 16 + mobiLen + exthLen
  const rec0 = new Uint8Array(titleOffset + titleBytes.length + 4)
  const v = new DataView(rec0.buffer)
  v.setUint16(0, 2) // PalmDOC 压缩
  v.setUint32(4, text.length)
  v.setUint16(8, records.length)
  v.setUint16(10, 4096)
  v.setUint16(12, 0)
  rec0.set(enc.encode('MOBI'), 16)
  v.setUint32(20, mobiLen)
  v.setUint32(24, 2)
  v.setUint32(28, 65001)
  v.setUint32(32, 4242)
  v.setUint32(36, 6)
  v.setUint32(84, titleOffset)
  v.setUint32(88, titleBytes.length)
  v.setUint32(108, records.length + 1)
  v.setUint32(128, 0x40)
  v.setUint32(240, 0)
  v.setUint32(244, 0xffffffff)
  rec0.set(exth, 16 + mobiLen)
  rec0.set(titleBytes, titleOffset)

  const all = [rec0, ...records]
  const headerLen = 78 + all.length * 8 + 2
  let total = headerLen
  const offsets = all.map(r => {
    const o = total
    total += r.length
    return o
  })
  const out = new Uint8Array(total)
  const pv = new DataView(out.buffer)
  out.set(enc.encode(opts.title.slice(0, 31).replace(/[^\x20-\x7e]/g, '_')), 0)
  out.set(enc.encode('BOOKMOBI'), 60)
  pv.setUint16(76, all.length)
  all.forEach((r, i) => {
    pv.setUint32(78 + i * 8, offsets[i])
    pv.setUint32(78 + i * 8 + 4, i * 2)
    out.set(r, offsets[i])
  })
  return out
}

export function fileFrom(bytes: Uint8Array | string, name: string): File {
  return new File([bytes as BlobPart], name)
}
