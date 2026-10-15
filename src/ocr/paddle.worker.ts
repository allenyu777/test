// 本机文字识别（PaddleOCR）在后台线程里运行，识别时界面不卡
import { ort, wasmUrl } from './ort-env'
import { PaddleOcrService } from 'ppu-paddle-ocr/web'
import type { PaddleOptions } from 'ppu-paddle-ocr/web'

export interface PaddleLine {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export type WorkerRequest = { id: number; type: 'recognize'; bitmap: ImageBitmap; base: string }
export type WorkerResponse =
  | { id: number; type: 'progress'; loaded: number; total: number }
  | { id: number; type: 'result'; lines: PaddleLine[] }
  | { id: number; type: 'error'; message: string }

// 首次需要下载的总大小（运行文件约 14 MB + 模型约 18 MB）；有的服务器压缩传输时不给出准确大小
const DOWNLOAD_BYTES = 32_700_000

const MODELS = {
  detection: 'paddle/PP-OCRv6_tiny_det.onnx',
  recognition: 'paddle/PP-OCRv5_mobile_rec_infer.onnx',
  dictionary: 'paddle/ppocrv5_dict.txt',
}

let service: Promise<PaddleOcrService> | null = null

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

/** 下载模型文件并报告进度（之后由 Service Worker 缓存，离线也能用） */
async function download(urls: string[], onProgress: (loaded: number, total: number) => void): Promise<ArrayBuffer[]> {
  const responses = await Promise.all(
    urls.map(async url => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`识别模型下载失败（${res.status}）`)
      return res
    }),
  )
  const total = DOWNLOAD_BYTES
  let loaded = 0
  return Promise.all(
    responses.map(async res => {
      if (!res.body) return res.arrayBuffer()
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        size += value.length
        loaded += value.length
        onProgress(Math.min(loaded, total - 1), total)
      }
      const out = new Uint8Array(size)
      let offset = 0
      for (const c of chunks) {
        out.set(c, offset)
        offset += c.length
      }
      return out.buffer
    }),
  )
}

async function init(base: string, id: number): Promise<PaddleOcrService> {
  const [wasm, detection, recognition, dictionary] = await download(
    [wasmUrl, MODELS.detection, MODELS.recognition, MODELS.dictionary].map(u => new URL(u, base).href),
    (loaded, total) => post({ id, type: 'progress', loaded, total }),
  )
  // 下载完成（实际大小可能和估计的不同），之后按识别一页的时间算超时
  post({ id, type: 'progress', loaded: DOWNLOAD_BYTES, total: DOWNLOAD_BYTES })
  // 运行文件已经下载好了，直接交给 ONNX Runtime，不用再下载一次
  ort.env.wasm.wasmBinary = wasm
  const svc = new PaddleOcrService({
    model: { detection, recognition, charactersDictionary: dictionary },
    session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
    // 一次识别一行：在手机上更省内存，速度反而更快
    recognition: { recBatchSize: 1 } as PaddleOptions['recognition'],
  })
  await svc.initialize()
  return svc
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, bitmap, base } = event.data
  try {
    service ??= init(base, id)
    let svc: PaddleOcrService
    try {
      svc = await service
    } catch (e) {
      service = null
      throw e
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    bitmap.close()
    const result = await svc.recognize(canvas, { noCache: true })
    const lines: PaddleLine[] = []
    for (const group of result.lines) {
      const items = (Array.isArray(group) ? group : [group]).filter(item => item.text.trim())
      if (!items.length) continue
      lines.push({
        text: items.map(item => item.text).join(' '),
        x0: Math.min(...items.map(i => i.box.x)),
        y0: Math.min(...items.map(i => i.box.y)),
        x1: Math.max(...items.map(i => i.box.x + i.box.width)),
        y1: Math.max(...items.map(i => i.box.y + i.box.height)),
      })
    }
    post({ id, type: 'result', lines })
  } catch (e) {
    bitmap.close?.()
    post({ id, type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
