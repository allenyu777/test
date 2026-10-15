// 本机文字识别（PaddleOCR）在后台线程里运行，识别时界面不卡
import { ort, wasmUrl } from './ort-env'
import { PaddleOcrService } from 'ppu-paddle-ocr/web'
import type { PaddleOptions } from 'ppu-paddle-ocr/web'

/** 识别出的一个文字框（同一行可能有几个） */
export interface PaddleBox {
  text: string
  x: number
  y: number
  w: number
  h: number
}

export type WorkerRequest = { id: number; type: 'recognize'; bitmap: ImageBitmap; base: string }
/**
 * 出错的种类：
 * unsupported 设备运行不了（改用备用引擎）；download 模型下载失败（联网后重试）；failed 识别过程出错（换一个新的后台线程重试）
 */
export type PaddleErrorKind = 'unsupported' | 'download' | 'failed'
export type WorkerResponse =
  | { id: number; type: 'progress'; loaded: number; total: number; cached: boolean }
  | { id: number; type: 'result'; lines: PaddleBox[][] }
  | { id: number; type: 'error'; message: string; kind: PaddleErrorKind }

// 首次需要下载的总大小（运行文件约 14 MB + 模型约 18 MB）；有的服务器压缩传输时不给出准确大小
const DOWNLOAD_BYTES = 32_700_000

const MODELS = {
  detection: 'paddle/PP-OCRv6_tiny_det.onnx',
  recognition: 'paddle/PP-OCRv5_mobile_rec_infer.onnx',
  dictionary: 'paddle/ppocrv5_dict.txt',
}

class PaddleError extends Error {
  constructor(
    message: string,
    readonly kind: PaddleErrorKind,
  ) {
    super(message)
  }
}

// WebAssembly SIMD 检测（iOS 16.4 起支持）
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])

/** 这台设备缺少的功能（没有缺少返回 null）；在下载模型之前检查，免得白下载 */
function missingFeature(): string | null {
  try {
    if (typeof OffscreenCanvas === 'undefined' || !new OffscreenCanvas(1, 1).getContext('2d')) return '后台绘图（OffscreenCanvas）'
    if (!WebAssembly.validate(SIMD_PROBE)) return 'WebAssembly SIMD'
    // ONNX Runtime 总是使用共享内存
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })
    return null
  } catch {
    return 'WebAssembly 共享内存'
  }
}

// ppu-paddle-ocr 识别出错时只打印错误、返回空结果，会被当成空白页。记下这些错误，按识别失败处理
let swallowed: string | null = null
const consoleError = console.error.bind(console)
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? '')
  if (/^Error during|^Text detection failed|^Output tensor/.test(first)) swallowed ??= args.map(String).join(' ')
  consoleError(...args)
}

let service: Promise<PaddleOcrService> | null = null

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer)

async function isCached(urls: string[]): Promise<boolean> {
  try {
    const hits = await Promise.all(urls.map(url => caches.match(url)))
    return hits.every(Boolean)
  } catch {
    return false
  }
}

/** 读取运行文件和模型并报告进度（第一次从网上下载，之后由 Service Worker 从本机缓存读取） */
async function download(urls: string[], onProgress: (loaded: number, total: number, cached: boolean) => void): Promise<ArrayBuffer[]> {
  const cached = await isCached(urls)
  const total = DOWNLOAD_BYTES
  let loaded = 0
  try {
    return await Promise.all(
      urls.map(async url => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(String(res.status))
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
          onProgress(Math.min(loaded, total - 1), total, cached)
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
  } catch {
    throw new PaddleError('识别模型下载失败，请联网后点「继续识别」', 'download')
  }
}

async function init(base: string, id: number): Promise<PaddleOcrService> {
  const missing = missingFeature()
  if (missing) throw new PaddleError(`这台设备不支持${missing}`, 'unsupported')
  let cached = false
  const [wasm, detection, recognition, dictionary] = await download(
    [wasmUrl, MODELS.detection, MODELS.recognition, MODELS.dictionary].map(u => new URL(u, base).href),
    (loaded, total, fromCache) => {
      cached = fromCache
      post({ id, type: 'progress', loaded, total, cached: fromCache })
    },
  )
  // 读取完成（实际大小可能和估计的不同），之后按识别一页的时间算超时
  post({ id, type: 'progress', loaded: DOWNLOAD_BYTES, total: DOWNLOAD_BYTES, cached })
  try {
    // 运行文件已经读取好了，直接交给 ONNX Runtime，不用再下载一次
    ort.env.wasm.wasmBinary = wasm
    const svc = new PaddleOcrService({
      model: { detection, recognition, charactersDictionary: dictionary },
      session: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
      // 检测时把页面缩到最长边 960 像素：准确率不变，内存少很多（识别时仍用原图裁出的文字行）
      detection: { maxSideLength: 960 } as PaddleOptions['detection'],
      // 一次识别一行：在手机上更省内存，速度反而更快
      recognition: { recBatchSize: 1 } as PaddleOptions['recognition'],
    })
    await svc.initialize()
    return svc
  } catch (e) {
    throw new PaddleError(`识别引擎无法启动：${e instanceof Error ? e.message : String(e)}`, 'unsupported')
  }
}

async function recognize({ id, bitmap, base }: WorkerRequest): Promise<PaddleBox[][]> {
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
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PaddleError('内存不足，无法处理这一页', 'failed')
    ctx.drawImage(bitmap, 0, 0)
    swallowed = null
    const result = await svc.recognize(canvas, { noCache: true })
    if (swallowed) throw new PaddleError(`识别出错：${swallowed}`, 'failed')
    return result.lines.map(group =>
      (Array.isArray(group) ? group : [group])
        .filter(item => item.text.trim())
        .map(item => ({ text: item.text, x: item.box.x, y: item.box.y, w: item.box.width, h: item.box.height })),
    )
  } finally {
    bitmap.close()
  }
}

// 一次只识别一页
let chain: Promise<unknown> = Promise.resolve()

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  chain = chain.then(async () => {
    try {
      post({ id: request.id, type: 'result', lines: await recognize(request) })
    } catch (e) {
      const kind: PaddleErrorKind = e instanceof PaddleError ? e.kind : 'failed'
      post({ id: request.id, type: 'error', kind, message: e instanceof Error ? e.message : String(e) })
    }
  })
}
