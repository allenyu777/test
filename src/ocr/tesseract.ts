// 备用的本机识别引擎 Tesseract：设备运行不了 PaddleOCR 时使用（准确率较低，但老设备也能用）
import type { OcrLang } from '../db'
import type { OcrLine } from './layout'

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>

const workers = new Map<OcrLang, Promise<TesseractWorker>>()

function assetBase(): string {
  return new URL('tesseract/', document.baseURI).href
}

function localWorker(lang: OcrLang): Promise<TesseractWorker> {
  let worker = workers.get(lang)
  if (!worker) {
    // tesseract.js 在识别数据下载失败时不会结束等待，这里自己加上出错处理和超时
    worker = new Promise<TesseractWorker>((resolve, reject) => {
      let settled = false
      const fail = (e: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(e instanceof Error ? e : new Error('本机识别引擎加载失败，请联网后点「继续识别」'))
      }
      const timer = setTimeout(() => fail(new Error('下载识别数据超时，请检查网络后点「继续识别」')), 120_000)
      import('tesseract.js')
        .then(({ createWorker }) =>
          createWorker(lang.split('+'), 1 /* 只用 LSTM 模型 */, {
            workerPath: assetBase() + 'worker.min.js',
            corePath: assetBase() + 'core',
            langPath: assetBase() + 'lang',
            workerBlobURL: false,
            gzip: true,
            // 识别数据缓存在本机，之后离线也能用
            cacheMethod: 'write',
            errorHandler: () => fail(new Error('识别数据下载失败，请联网后点「继续识别」')),
          }),
        )
        .then(
          w => {
            if (settled) {
              w.terminate().catch(() => {})
              return
            }
            settled = true
            clearTimeout(timer)
            resolve(w)
          },
          fail,
        )
    })
    const current = worker
    current.catch(() => {
      if (workers.get(lang) === current) workers.delete(lang)
    })
    workers.set(lang, current)
  }
  return worker
}

export async function releaseTesseract() {
  const list = [...workers.values()]
  workers.clear()
  for (const w of list) {
    try {
      await (await w).terminate()
    } catch {
      // 已经结束
    }
  }
}

/** 识别一页，返回每一行的文字和位置（同一段落的行 para 相同） */
export async function recognizeTesseract(canvas: HTMLCanvasElement, lang: OcrLang): Promise<OcrLine[]> {
  const worker = await localWorker(lang)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // 识别卡住：释放引擎，下次重新创建
      releaseTesseract()
      reject(new Error('这一页识别超时'))
    }, 180_000)
  })
  try {
    const { data } = await Promise.race([worker.recognize(canvas, {}, { text: true, blocks: true }), timeout])
    const lines: OcrLine[] = []
    let para = 0
    for (const block of data.blocks ?? []) {
      for (const p of block.paragraphs) {
        for (const l of p.lines) lines.push({ text: l.text, para, ...l.bbox })
        para++
      }
    }
    return lines
  } finally {
    clearTimeout(timer)
  }
}
