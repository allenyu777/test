// 文字识别引擎：本机（PaddleOCR，免费、离线、不上传；设备不支持时改用 Tesseract）或云端（OpenAI 兼容的视觉模型）
import type { OcrLang } from '../db'
import { settings } from '../settings'
import { toast } from '../ui/toast'
import { assignParagraphs, groupsToLines, type OcrLine } from './layout'
import type { PaddleBox, PaddleErrorKind, WorkerRequest, WorkerResponse } from './paddle.worker'
import { recognizeTesseract, releaseTesseract } from './tesseract'

/** 一页的识别结果；本机识别同时给出每一行的位置（用来去掉页眉页脚） */
export interface OcrResult {
  text: string
  lines?: OcrLine[]
}

class PaddleError extends Error {
  constructor(
    message: string,
    readonly kind: PaddleErrorKind | 'timeout',
  ) {
    super(message)
  }
}

type Job = {
  id: number
  resolve: (lines: PaddleBox[][]) => void
  reject: (e: Error) => void
  /** 重新计算超时 */
  arm: (ms: number, message: string) => void
}

export interface ModelProgress {
  loaded: number
  total: number
  /** 模型已在本机缓存，只是在加载 */
  cached: boolean
}

let worker: Worker | null = null
let seq = 0
let job: Job | null = null
const progressListeners = new Set<(p: ModelProgress) => void>()

/** 加载识别模型的进度（首次使用要下载约 33 MB） */
export function onModelProgress(fn: (p: ModelProgress) => void): () => void {
  progressListeners.add(fn)
  return () => progressListeners.delete(fn)
}

/** PaddleOCR 用不了的原因（设备不支持、多次出错）；不为空时改用 Tesseract */
let paddleUnavailable: string | null = (() => {
  try {
    return localStorage.getItem('tingshu.ocr.engine') === 'tesseract' ? '已设置使用 Tesseract' : null
  } catch {
    return null
  }
})()
let paddleFailures = 0

/** 当前本机识别用的引擎 */
export function localOcrEngine(): 'paddle' | 'tesseract' {
  return paddleUnavailable ? 'tesseract' : 'paddle'
}

function terminatePaddle(error?: Error) {
  const w = worker
  worker = null
  w?.terminate()
  if (job && error) {
    job.reject(error)
    job = null
  }
}

function paddleWorker(): Worker {
  if (!worker) {
    const w = new Worker(new URL('./paddle.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if (!job || msg.id !== job.id) return
      if (msg.type === 'progress') {
        // 下载中一分钟没有进展才算超时；下载完以后按识别一页的时间算
        if (msg.loaded < msg.total) job.arm(60_000, '下载识别模型超时，请检查网络后点「继续识别」')
        else job.arm(180_000, '这一页识别超时')
        progressListeners.forEach(fn => fn({ loaded: msg.loaded, total: msg.total, cached: msg.cached }))
        return
      }
      const current = job
      job = null
      if (msg.type === 'result') current.resolve(msg.lines)
      else current.reject(new PaddleError(msg.message, msg.kind))
    }
    w.onerror = event => {
      event.preventDefault()
      // 后台线程崩溃（多半是内存不够）
      if (worker === w) terminatePaddle(new PaddleError('本机识别引擎出错', 'failed'))
    }
    worker = w
  }
  return worker
}

function recognizePaddle(bitmap: ImageBitmap): Promise<PaddleBox[][]> {
  const w = paddleWorker()
  const id = ++seq
  return new Promise<PaddleBox[][]>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = <T,>(fn: (v: T) => void) => (v: T) => {
      clearTimeout(timer)
      fn(v)
    }
    job = {
      id,
      resolve: done(resolve),
      reject: done(reject),
      arm: (ms, message) => {
        clearTimeout(timer)
        // 卡住了：结束后台线程，下次重新创建
        timer = setTimeout(() => {
          if (job?.id === id) terminatePaddle(new PaddleError(message, 'timeout'))
        }, ms)
      },
    }
    job.arm(180_000, '这一页识别超时')
    w.postMessage({ id, type: 'recognize', bitmap, base: document.baseURI } satisfies WorkerRequest, [bitmap])
  })
}

/** 释放本机识别占用的内存 */
export async function releaseLocalOcr() {
  terminatePaddle(new Error('识别已停止'))
  await releaseTesseract()
}

// 本机识别一次只做一页（导入时的首页和后台队列可能同时请求）
let chain: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task)
  chain = run.catch(() => {})
  return run
}

async function recognizeLocal(canvas: HTMLCanvasElement, lang: OcrLang): Promise<OcrResult> {
  return serialize(async () => {
    if (!paddleUnavailable) {
      try {
        const groups = await recognizePaddle(await createImageBitmap(canvas))
        paddleFailures = 0
        return { text: '', lines: assignParagraphs(groupsToLines(groups)) }
      } catch (e) {
        if (!(e instanceof PaddleError) || e.kind === 'download') throw e
        // 出错后后台线程可能已经坏了，换一个新的
        terminatePaddle()
        if (e.kind === 'unsupported') paddleUnavailable = e.message
        else if (++paddleFailures >= 2) paddleUnavailable = `识别引擎多次出错（${e.message}）`
        else throw e
        console.warn('改用 Tesseract 识别：', paddleUnavailable)
        toast('这台设备运行不了新的识别引擎，已改用兼容模式（准确率会低一些）', 'info', { duration: 6000 })
      }
    }
    return { text: '', lines: await recognizeTesseract(canvas, lang) }
  })
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
