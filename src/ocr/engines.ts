// 文字识别引擎：本机（Tesseract，离线免费）或云端（OpenAI 兼容的视觉模型）
import type { OcrLang } from '../db'
import { settings } from '../settings'

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>

const workers = new Map<OcrLang, Promise<TesseractWorker>>()

function assetBase(): string {
  return new URL('tesseract/', document.baseURI).href
}

function localWorker(lang: OcrLang): Promise<TesseractWorker> {
  let worker = workers.get(lang)
  if (!worker) {
    worker = import('tesseract.js').then(({ createWorker }) =>
      createWorker(lang.split('+'), 1 /* 只用 LSTM 模型 */, {
        workerPath: assetBase() + 'worker.min.js',
        corePath: assetBase() + 'core',
        langPath: assetBase() + 'lang',
        workerBlobURL: false,
        gzip: true,
        // 识别数据缓存在本机，之后离线也能用
        cacheMethod: 'write',
      }),
    )
    worker.catch(() => workers.delete(lang))
    workers.set(lang, worker)
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

async function recognizeLocal(canvas: HTMLCanvasElement, lang: OcrLang): Promise<string> {
  const worker = await localWorker(lang)
  const { data } = await worker.recognize(canvas)
  return data.text ?? ''
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

export function recognizeCanvas(canvas: HTMLCanvasElement, engine: 'local' | 'cloud', lang: OcrLang): Promise<string> {
  return engine === 'cloud' ? recognizeCloud(canvas, lang) : recognizeLocal(canvas, lang)
}
