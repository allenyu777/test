// 文字识别引擎：本机（Tesseract，离线免费）或云端（OpenAI 兼容的视觉模型）
import type { OcrLang } from '../db'
import { settings } from '../settings'
import type { OcrLine } from './layout'

/** 一页的识别结果；本机识别同时给出每一行的位置（用来去掉页眉页脚） */
export interface OcrResult {
  text: string
  lines?: OcrLine[]
}

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

/** 释放本机识别占用的内存 */
export async function releaseLocalOcr() {
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

async function recognizeLocal(canvas: HTMLCanvasElement, lang: OcrLang): Promise<OcrResult> {
  const worker = await localWorker(lang)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // 识别卡住：释放引擎，下次重新创建
      releaseLocalOcr()
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
    return { text: data.text ?? '', lines: lines.length ? lines : undefined }
  } finally {
    clearTimeout(timer)
  }
}

const LANG_NAMES: Record<OcrLang, string> = {
  chi_sim: '简体中文',
  chi_tra: '繁体中文',
  eng: '英文',
  'chi_sim+eng': '中文和英文',
}

export function cloudOcrReady(): boolean {
  const o = settings.get().openai
  return !!o.baseUrl && !!(o.key || !/api\.openai\.com/.test(o.baseUrl)) && !!o.visionModel
}

async function recognizeCloud(canvas: HTMLCanvasElement, lang: OcrLang): Promise<string> {
  const o = settings.get().openai
  const image = canvas.toDataURL('image/jpeg', 0.82)
  const prompt =
    `这是一页书的扫描图片（${LANG_NAMES[lang]}）。请把页面上的正文逐字转写出来：` +
    '保持原文，不要翻译、不要总结、不要补全、不要添加任何说明；段落之间空一行，同一段内不要换行；' +
    '章节标题单独成段；忽略页眉、页脚和页码。如果页面没有文字，什么都不输出。'
  let res: Response
  try {
    res = await fetch(`${o.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(o.key ? { Authorization: `Bearer ${o.key.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: o.visionModel,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: image, detail: 'high' } },
            ],
          },
        ],
      }),
    })
  } catch {
    throw new Error('云端识别：无法连接，请检查网络')
  }
  if (res.status === 401 || res.status === 403) throw new Error(`云端识别：密钥无效（${res.status}）`)
  if (!res.ok) throw new Error(`云端识别失败（${res.status}）`)
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return json.choices?.[0]?.message?.content ?? ''
}

export async function recognizeCanvas(canvas: HTMLCanvasElement, engine: 'local' | 'cloud', lang: OcrLang): Promise<OcrResult> {
  return engine === 'cloud' ? { text: await recognizeCloud(canvas, lang) } : recognizeLocal(canvas, lang)
}
