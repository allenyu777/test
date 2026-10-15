// 文字识别引擎：本机（PaddleOCR，免费、离线、不上传）或云端（OpenAI 兼容的视觉模型）
import type { OcrLang } from '../db'
import { settings } from '../settings'
import { assignParagraphs, type OcrLine } from './layout'
import type { PaddleLine, WorkerRequest, WorkerResponse } from './paddle.worker'

/** 一页的识别结果；本机识别同时给出每一行的位置（用来去掉页眉页脚） */
export interface OcrResult {
  text: string
  lines?: OcrLine[]
}

type Pending = {
  resolve: (lines: PaddleLine[]) => void
  reject: (e: Error) => void
  onProgress?: (loaded: number, total: number) => void
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()
const progressListeners = new Set<(loaded: number, total: number) => void>()

/** 首次识别时下载识别模型的进度（约 30 MB） */
export function onModelProgress(fn: (loaded: number, total: number) => void): () => void {
  progressListeners.add(fn)
  return () => progressListeners.delete(fn)
}

function failAll(error: Error) {
  for (const p of pending.values()) p.reject(error)
  pending.clear()
}

function localWorker(): Worker {
  if (!worker) {
    const w = new Worker(new URL('./paddle.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      const job = pending.get(msg.id)
      if (msg.type === 'progress') {
        job?.onProgress?.(msg.loaded, msg.total)
        progressListeners.forEach(fn => fn(msg.loaded, msg.total))
        return
      }
      if (!job) return
      pending.delete(msg.id)
      if (msg.type === 'result') job.resolve(msg.lines)
      else job.reject(new Error(msg.message))
    }
    w.onerror = event => {
      event.preventDefault()
      // 后台线程崩溃（多半是内存不够）：下次重新创建
      if (worker === w) worker = null
      w.terminate()
      failAll(new Error('本机识别引擎出错，稍后会重试'))
    }
    worker = w
  }
  return worker
}

/** 释放本机识别占用的内存 */
export async function releaseLocalOcr() {
  const w = worker
  worker = null
  w?.terminate()
  failAll(new Error('识别已停止'))
}

async function recognizeLocal(canvas: HTMLCanvasElement): Promise<OcrResult> {
  const bitmap = await createImageBitmap(canvas)
  const id = ++seq
  const w = localWorker()
  let timer: ReturnType<typeof setTimeout> | undefined
  // 首次要下载模型：一段时间没有任何进展才算超时
  const arm = (ms: number, message: string) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (!pending.has(id)) return
      pending.get(id)!.reject(new Error(message))
      pending.delete(id)
      // 识别卡住：释放引擎，下次重新创建
      releaseLocalOcr()
    }, ms)
  }
  try {
    const lines = await new Promise<PaddleLine[]>((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject,
        onProgress: (loaded, total) => arm(loaded < total ? 60_000 : 180_000, loaded < total ? '下载识别模型超时，请检查网络后点「继续识别」' : '这一页识别超时'),
      })
      arm(180_000, '这一页识别超时')
      w.postMessage({ id, type: 'recognize', bitmap, base: document.baseURI } satisfies WorkerRequest, [bitmap])
    })
    return { text: '', lines: assignParagraphs(lines) }
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
  return engine === 'cloud' ? { text: await recognizeCloud(canvas, lang) } : recognizeLocal(canvas)
}
